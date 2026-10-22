// Score verification, Phase 4: the consensus engine. For each match it takes
// the latest report of every independent source and decides the state:
//   OFFICIAL / VERIFIED  a staff decision (official NNL result, or verified
//                        override): always wins;
//   CONFIRMED            two or more independent sources agree;
//   UNCONFIRMED          only one source so far (not shown publicly unless the
//                        "show unconfirmed scores" setting is on; never counts);
//   PENDING              sources disagree, within the grace window (live play:
//                        one source is often a minute behind);
//   CONFLICT             sources still disagree after the grace window: the
//                        Data Officer and Super Admins are alerted;
//   NONE                 no reports.
// Only CONFIRMED / VERIFIED / OFFICIAL results are written into the league
// fixture and count in the table (league_fixtures.verification). Every change is
// written to League History in plain English.
import { ensureScoreSchema, addReport, latestPerSource, SOURCE_TYPES, TO_LEAGUE_STATUS } from './model.js';
import { ensureDecisions, decidedResult } from './matchday.js';
import { getCompetition, logLeague, loadLeague, standingsFor } from '../leagueDb.js';
import { isCounted } from '../league/standings.js';
import { afterFixtureChange } from '../leagueAdmin.js';
import { scoreAlert } from './alerts.js';
import { pollSources } from './adapters.js';

export const COUNTED_STATES = ['CONFIRMED', 'VERIFIED', 'OFFICIAL'];
export const STATE_LABEL = { OFFICIAL: 'Official result', VERIFIED: 'Verified by staff', CONFIRMED: 'Confirmed (sources agree)', UNCONFIRMED: 'Unconfirmed (one source)',
  PENDING: 'Sources disagree (waiting a moment)', CONFLICT: 'Sources disagree', NONE: 'No reports yet' };
const TERMINAL = new Set(['FULL_TIME', 'POSTPONED', 'ABANDONED', 'AWARDED', 'CANCELLED']);
const FINISHED = new Set(['FULL_TIME', 'AWARDED', 'ABANDONED', 'CANCELLED', 'POSTPONED']);
const SYSTEM = { id: 'system', name: 'Score verification', email: 'score-verification' };

export const SCORE_SETTINGS = {
  grace_minutes: { def: '3', label: 'Grace window before a disagreement is a conflict (minutes)', min: 0, max: 30 },
  missing_after_minutes: { def: '115', label: 'Remind about a missing result this long after kick-off (minutes)', min: 60, max: 600 },
  show_unconfirmed: { def: '0', label: 'Show unconfirmed scores (one source) on the website', bool: true },
  poll_matchday_minutes: { def: '2', label: 'Licensed API: check every … minutes on matchdays', min: 1, max: 60 },
  poll_other_hours: { def: '6', label: 'Licensed API: check every … hours on other days', min: 1, max: 48 },
  daily_summary: { def: '1', label: 'Send the matchday summary email after the last match', bool: true },
};

let ready = false;
export async function ensureConsensusSchema(env) {
  await ensureScoreSchema(env);
  await ensureDecisions(env);
  if (ready) return;
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS score_state (fixture_id INTEGER PRIMARY KEY, state TEXT NOT NULL, home_goals INTEGER, away_goals INTEGER, status TEXT, minute TEXT,
      explanation TEXT, sources_json TEXT, conflict_since TEXT, conflict_key TEXT, applied_key TEXT, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS score_settings (key TEXT PRIMARY KEY, value TEXT, updated_by TEXT, updated_at TEXT)`),
  ]);
  const cols = (await db.prepare(`PRAGMA table_info(league_fixtures)`).all()).results.map(c => c.name);
  if (!cols.includes('verification')) await db.prepare(`ALTER TABLE league_fixtures ADD COLUMN verification TEXT`).run();
  ready = true;
}

export async function getScoreSettings(env) {
  await ensureConsensusSchema(env);
  const rows = (await env.DB.prepare(`SELECT key, value FROM score_settings`).all()).results;
  const out = Object.fromEntries(Object.entries(SCORE_SETTINGS).map(([k, s]) => [k, s.def]));
  for (const r of rows) if (r.key in out || r.key.startsWith('_')) out[r.key] = r.value;
  return out;
}
export async function saveScoreSettings(env, admin, values) {
  await ensureConsensusSchema(env);
  const changed = [];
  for (const [k, s] of Object.entries(SCORE_SETTINGS)) {
    if (!(k in (values || {}))) continue;
    let v = values[k];
    if (s.bool) v = v === true || v === '1' || v === 1 ? '1' : '0';
    else { v = Number(v); if (!Number.isInteger(v) || v < s.min || v > s.max) return { error: `${s.label}: a whole number from ${s.min} to ${s.max}.` }; v = String(v); }
    await env.DB.prepare(`INSERT INTO score_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(k, v, admin.name, new Date().toISOString()).run();
    changed.push(`${s.label}: ${s.bool ? (v === '1' ? 'on' : 'off') : v}`);
  }
  if (changed.length) await logLeague(env.DB, admin, 'score.settings', 'settings', null, null, { result: `${admin.name} changed score settings: ${changed.join('; ')}` });
  return { ok: true };
}
const setInternal = (env, key, value) => env.DB.prepare(`INSERT INTO score_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
  .bind(key, value, new Date().toISOString()).run();

// ── The rule (pure, so it can be tested on its own) ──
const goals = r => `${r.home_goals ?? '-'}-${r.away_goals ?? '-'}`;
const keyOf = r => (TERMINAL.has(r.status) ? `${r.status}:${goals(r)}` : `INPLAY:${goals(r)}`);
const t = r => Date.parse(r.received_at) || 0;
const newestOf = list => list.reduce((a, b) => (t(b) > t(a) ? b : a));
const who = r => r.source_label || SOURCE_TYPES[r.source_type]?.label || r.source_type;

/**
 * latest: the latest counted report of each independent source.
 * Returns { state, result?, agreeing?, differing?, note } where state is
 * NONE / UNCONFIRMED / CONFIRMED / DISAGREE (the caller applies the grace window).
 */
export function decide(latest) {
  const reports = latest.filter(r => r.status !== 'SCHEDULED');
  if (!reports.length) return { state: 'NONE' };
  const groups = new Map();
  for (const r of reports) groups.set(keyOf(r), [...(groups.get(keyOf(r)) || []), r]);
  const result = list => { const n = newestOf(list); return { home_goals: n.home_goals, away_goals: n.away_goals, status: n.status, minute: TERMINAL.has(n.status) ? null : n.minute || null }; };
  const terminal = [...groups.entries()].filter(([k]) => !k.startsWith('INPLAY'));
  if (terminal.length > 1) return { state: 'DISAGREE', differing: reports, note: 'Sources give different final results' };
  if (terminal.length === 1) {
    const [, fin] = terminal[0];
    const finAt = Math.max(...fin.map(t));
    // An in-play report that is newer than the final result and has a different score contradicts it.
    const newerDifferent = reports.filter(r => !TERMINAL.has(r.status) && t(r) > finAt && goals(r) !== goals(fin[0]));
    if (newerDifferent.length) return { state: 'DISAGREE', differing: reports, note: 'A source still reports the match in play with a different score' };
    if (fin.length >= 2) return { state: 'CONFIRMED', result: result(fin), agreeing: fin, note: `${fin.length} sources agree` };
    // One final report; others saying the same score in play confirm the score (not yet the final whistle).
    const sameScore = reports.filter(r => !TERMINAL.has(r.status) && goals(r) === goals(fin[0]));
    if (fin[0].home_goals !== null && sameScore.length) {
      return { state: 'CONFIRMED', result: { ...result(sameScore), status: 'LIVE' }, agreeing: [...fin, ...sameScore], note: 'The score is confirmed; full time is reported by one source so far' };
    }
    return { state: 'UNCONFIRMED', result: result(fin), agreeing: fin, note: 'Only one source so far' };
  }
  // Only in-play reports.
  const ranked = [...groups.values()].sort((a, b) => b.length - a.length || t(newestOf(b)) - t(newestOf(a)));
  const best = ranked[0];
  if (ranked.length === 1) return best.length >= 2 ? { state: 'CONFIRMED', result: result(best), agreeing: best, note: `${best.length} sources agree` } : { state: 'UNCONFIRMED', result: result(best), agreeing: best, note: 'Only one source so far' };
  // A source that hasn't caught up yet (its report is older than the agreeing ones) isn't a disagreement.
  const bestAt = t(newestOf(best)), others = ranked.slice(1).flat();
  if (best.length >= 2 && others.every(r => t(r) < bestAt)) return { state: 'CONFIRMED', result: result(best), agreeing: best, note: `${best.length} sources agree (${others.map(who).join(', ')} not updated yet)` };
  return { state: 'DISAGREE', differing: reports, note: 'Sources give different scores' };
}

// ── Settling one match ──
const words = (f, r) => `${f.home_name} ${r.home_goals ?? '–'}–${r.away_goals ?? '–'} ${f.away_name} (${String(r.status || '').replace('_', ' ').toLowerCase()})`;
async function fixtureRow(db, id) {
  return db.prepare(`SELECT f.*, h.name AS home_name, a.name AS away_name FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id WHERE f.id = ?`).bind(Number(id)).first();
}
async function clearHomeCache(env) {
  try { await caches.default.delete(new Request(`${String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '')}/`)); } catch { /* not cached / not in Workers */ }
}

/** Works out the state of one match, saves it and applies it to the league fixture. */
export async function settleFixture(env, fixtureId, { now = Date.now(), settings = null } = {}) {
  await ensureConsensusSchema(env);
  const db = env.DB;
  const f = await fixtureRow(db, fixtureId);
  if (!f) return null;
  const s = settings || await getScoreSettings(env);
  const prev = await db.prepare(`SELECT * FROM score_state WHERE fixture_id = ?`).bind(f.id).first();
  const decisions = (await db.prepare(`SELECT * FROM score_decisions WHERE fixture_id = ?`).bind(f.id).all()).results;
  const reports = (await db.prepare(`SELECT * FROM score_reports WHERE fixture_id = ? AND needs_review = 0`).bind(f.id).all()).results;
  let latest = latestPerSource(reports);
  let dec = decidedResult(decisions);
  // A verified score during play (not a final result) holds only until newer reports arrive;
  // then it counts as one more source ("Verified by staff") instead of overriding.
  if (dec && dec.kind === 'VERIFIED' && !TERMINAL.has(dec.status) && latest.some(r => t(r) > Date.parse(dec.created_at))) {
    latest = [...latest, { id: `d${dec.id}`, source_type: 'VERIFIED', source_identity: 'decision', source_label: `Verified by ${dec.created_by}`, home_goals: dec.home_goals, away_goals: dec.away_goals, status: dec.status, received_at: dec.created_at }];
    dec = null;
  }
  let state, result = null, explanation, conflictSince = null, conflictKey = null, sources = latest.map(r => ({ id: r.id, who: who(r), type: r.source_type, score: goals(r), status: r.status, minute: r.minute, at: r.received_at }));
  if (dec) {
    state = dec.kind;
    result = { home_goals: dec.home_goals, away_goals: dec.away_goals, status: dec.status, minute: null };
    explanation = `${dec.kind === 'OFFICIAL' ? 'Official result' : 'Verified result'} entered by ${dec.created_by}: ${dec.reason}`;
  } else {
    const d = decide(latest);
    if (d.state === 'DISAGREE') {
      conflictSince = prev?.conflict_since || new Date(now).toISOString();
      conflictKey = d.differing.map(r => `${r.source_type}:${r.source_identity}=${keyOf(r)}`).sort().join('|');
      const graceMs = Number(s.grace_minutes) * 60e3;
      state = now - Date.parse(conflictSince) < graceMs ? 'PENDING' : 'CONFLICT';
      explanation = `${d.note}: ${d.differing.map(r => `${who(r)} says ${goals(r)} ${String(r.status).replace('_', ' ').toLowerCase()}`).join('; ')}`;
    } else {
      state = d.state;
      result = d.result || null;
      explanation = d.state === 'NONE' ? 'No reports yet' : `${d.note}: ${d.agreeing.map(who).join(', ')}`;
    }
  }
  const resultKey = result ? `${state}:${result.status}:${goals(result)}` : state;

  // What the league fixture should show.
  const show = COUNTED_STATES.includes(state) || (state === 'UNCONFIRMED' && s.show_unconfirmed === '1');
  const changes = {};
  if (state === 'PENDING') { /* keep what is there until the grace window ends */ } else {
    const verification = state === 'NONE' ? null : state;
    if ((f.verification ?? null) !== verification) changes.verification = verification;
    if (show && result) {
      const st = TO_LEAGUE_STATUS[result.status];
      const want = { status: st, home_goals: result.home_goals, away_goals: result.away_goals, result_type: result.status === 'AWARDED' ? 'awarded' : 'normal' };
      // Lobi Stars' own matches keep their live score in Live Match Control: only a staff decision changes it.
      const own = !!f.event_id && !['OFFICIAL', 'VERIFIED'].includes(state);
      if (!own) for (const [k, v] of Object.entries(want)) if ((f[k] ?? null) !== (v ?? null)) changes[k] = v;
    }
  }
  if (Object.keys(changes).length) {
    const cols = Object.keys(changes);
    await db.prepare(`UPDATE league_fixtures SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now'), updated_by = 'score-verification' WHERE id = ?`).bind(...cols.map(c => changes[c]), f.id).run();
    if (cols.some(c => ['status', 'home_goals', 'away_goals'].includes(c))) {
      const after = await db.prepare(`SELECT * FROM league_fixtures WHERE id = ?`).bind(f.id).first();
      await afterFixtureChange(env, after, cols);
    }
    await clearHomeCache(env);
  }
  await db.prepare(`INSERT INTO score_state (fixture_id, state, home_goals, away_goals, status, minute, explanation, sources_json, conflict_since, conflict_key, applied_key, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(fixture_id) DO UPDATE SET state = excluded.state, home_goals = excluded.home_goals, away_goals = excluded.away_goals,
    status = excluded.status, minute = excluded.minute, explanation = excluded.explanation, sources_json = excluded.sources_json, conflict_since = excluded.conflict_since,
    conflict_key = excluded.conflict_key, applied_key = excluded.applied_key, updated_at = excluded.updated_at`)
    .bind(f.id, state, result?.home_goals ?? null, result?.away_goals ?? null, result?.status ?? null, result?.minute ?? null, explanation.slice(0, 1000), JSON.stringify(sources),
      conflictSince, conflictKey, resultKey, new Date(now).toISOString()).run();

  // Plain-English history, alerts.
  if (prev?.applied_key !== resultKey && state !== 'PENDING') {
    const line = state === 'CONFLICT' ? `Conflict: ${f.home_name} v ${f.away_name}. ${explanation}`
      : state === 'NONE' ? `${f.home_name} v ${f.away_name}: no result (reports withdrawn or rejected)`
        : `${words(f, result)}: ${STATE_LABEL[state].toLowerCase()}. ${explanation}`;
    await logLeague(db, SYSTEM, `score.${state.toLowerCase()}`, 'fixture', f.id, prev ? { state: prev.state, result: prev.applied_key } : null, { state, result: line });
  }
  if (state === 'CONFLICT' && prev?.conflict_key !== conflictKey) {
    await scoreAlert(env, { key: `conflict:${f.id}:${conflictKey}`, superAdmins: true, subject: `Score conflict: ${f.home_name} v ${f.away_name}`, link: `/admin/scores/?fixture=${f.id}`, lines: [
      `Sources disagree about ${f.home_name} v ${f.away_name}, and still did after ${s.grace_minutes} minutes.`, explanation,
      'The table is not using this match until it is resolved. Open the match to accept one score or enter the correct one.'] });
  }
  if (state === 'OFFICIAL' && prev && COUNTED_STATES.includes(prev.state) && prev.applied_key && prev.applied_key.replace(/^\w+:/, '') !== resultKey.replace(/^\w+:/, '')) {
    await scoreAlert(env, { key: `official-correction:${f.id}:${resultKey}`, superAdmins: true, subject: `Official correction: ${f.home_name} v ${f.away_name}`, link: `/admin/scores/?fixture=${f.id}`, lines: [
      `The official result ${words(f, result)} replaces what the table had before (${String(prev.applied_key).replace(/^\w+:/, '').replace(':', ' ')}).`,
      'The table has been worked out again.', explanation] });
  }
  return { fixtureId: f.id, state, result, explanation, changed: Object.keys(changes) };
}

// ── Sources that feed in from elsewhere on the site ──
const CENTRE_TO_REPORT = { live: 'LIVE', 'second-half': 'LIVE', 'extra-time': 'LIVE', 'half-time': 'HALF_TIME', 'full-time': 'FULL_TIME', postponed: 'POSTPONED', abandoned: 'ABANDONED' };
/** Live Match Control saved a score or status for a Lobi Stars match: one LIVE_MATCH_CONTROL report. */
export async function fromLiveMatchControl(env, eventId, { status, home, away, admin }) {
  try {
    const st = CENTRE_TO_REPORT[status];
    if (!st) return null;
    await ensureScoreSchema(env);
    const f = await env.DB.prepare(`SELECT id FROM league_fixtures WHERE event_id = ?`).bind(String(eventId)).first();
    if (!f) return null;
    const last = await env.DB.prepare(`SELECT home_goals, away_goals, status FROM score_reports WHERE fixture_id = ? AND source_type = 'LIVE_MATCH_CONTROL' ORDER BY id DESC LIMIT 1`).bind(f.id).first();
    if (last && last.status === st && last.home_goals === (home ?? null) && last.away_goals === (away ?? null)) return null; // nothing new
    return await addReport(env, { sourceType: 'LIVE_MATCH_CONTROL', identity: 'live-match-control', label: `Live Match Control${admin?.name ? ` (${admin.name})` : ''}`, fixtureId: f.id,
      homeGoals: home ?? null, awayGoals: away ?? null, status: st, raw: { eventId, status }, createdBy: admin?.name || null });
  } catch (err) { console.error('[scores] live match control', err); return null; }
}

/**
 * League › Results saves: a full-time or awarded result typed there by league
 * staff is a VERIFIED decision ("Entered in League › Results"); a live score is
 * a staff report. Earlier League › Results decisions for the match are replaced.
 */
export async function fromLeagueResults(env, staff, admin, fixture, v) {
  await ensureConsensusSchema(env);
  const db = env.DB;
  const tag = 'Entered in League › Results';
  await db.prepare(`UPDATE score_decisions SET active = 0 WHERE fixture_id = ? AND active = 1 AND kind = 'VERIFIED' AND reason LIKE ?`).bind(fixture.id, `${tag}%`).run();
  const st = String(v.status || '').toUpperCase();
  if (['FULL_TIME', 'AWARDED'].includes(st)) {
    await db.prepare(`INSERT INTO score_decisions (fixture_id, kind, home_goals, away_goals, status, reason, created_by, created_at) VALUES (?, 'VERIFIED', ?, ?, ?, ?, ?, ?)`)
      .bind(fixture.id, v.home_goals, v.away_goals, st, `${tag} by ${staff.name || staff.email}`, staff.name || staff.email, new Date().toISOString()).run();
  } else if (['LIVE', 'HALF_TIME'].includes(st) && admin?.id) {
    await addReport(env, { sourceType: 'STAFF_MANUAL', identity: `staff:${admin.id}`, label: admin.name, fixtureId: fixture.id, homeGoals: v.home_goals, awayGoals: v.away_goals, status: st,
      raw: { via: 'League › Results' }, createdBy: admin.name, noSettle: true });
  }
  return settleFixture(env, fixture.id);
}

// ── Every minute ──
/** Missing results: kick-off + N minutes passed and no confirmed final result. Each alerted once. */
export async function missingResults(env, { now = Date.now(), settings = null, alert = true } = {}) {
  await ensureConsensusSchema(env);
  const s = settings || await getScoreSettings(env);
  const comp = await getCompetition(env.DB, null);
  if (!comp) return [];
  const after = Number(s.missing_after_minutes) * 60e3;
  const rows = (await env.DB.prepare(`SELECT f.id, f.kickoff_at, f.status, h.name AS home_name, a.name AS away_name, st.state, st.status AS st_status FROM league_fixtures f
    JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id LEFT JOIN score_state st ON st.fixture_id = f.id
    WHERE f.competition_id = ? AND f.kickoff_at BETWEEN ? AND ? AND f.status NOT IN ('postponed', 'cancelled')`)
    .bind(comp.id, new Date(now - 3 * 864e5).toISOString(), new Date(now - after).toISOString()).all()).results;
  const missing = rows.filter(r => !(COUNTED_STATES.includes(r.state) && FINISHED.has(r.st_status)));
  if (alert) for (const r of missing) {
    await scoreAlert(env, { key: `missing:${r.id}`, subject: `No confirmed result yet: ${r.home_name} v ${r.away_name}`, link: `/admin/scores/?fixture=${r.id}`, lines: [
      `${r.home_name} v ${r.away_name} kicked off over ${s.missing_after_minutes} minutes ago and there is no confirmed full-time result.`,
      r.state === 'CONFLICT' ? 'The sources disagree.' : r.state === 'UNCONFIRMED' ? 'Only one source has reported so far.' : 'No source has reported the final score.',
      'Please get the result (club officers, the NNL) and enter it in Matchday › Other Games.'] });
  }
  return missing;
}

// ── Table snapshots ──
/**
 * When every match of a round is over (and each played match is confirmed,
 * verified or official), the table after that round is saved. If a later
 * correction changes it, a new version is saved with the reason.
 */
export async function snapshotRounds(env, { now = Date.now() } = {}) {
  const db = env.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS league_table_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, competition_id INTEGER NOT NULL, matchday INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, rows_json TEXT NOT NULL, hash TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL)`).run();
  const league = await loadLeague(env, { publishedOnly: false });
  if (!league || !league.competition.has_table) return [];
  const comp = league.competition;
  const saved = [];
  const mds = [...new Set(league.fixtures.map(f => f.matchday).filter(d => d != null))].sort((a, b) => a - b);
  for (const md of mds) {
    const list = league.fixtures.filter(f => f.matchday === md);
    const over = list.every(f => ['full_time', 'awarded', 'postponed', 'cancelled', 'abandoned'].includes(f.status));
    const settled = list.filter(f => ['full_time', 'awarded'].includes(f.status)).every(f => isCounted(f, { ...comp, include_live: 0 }));
    if (!over || !settled) continue;
    const st = standingsFor(league, { upTo: md });
    const rows = st.rows.map(r => ({ pos: r.pos, teamId: r.team.id, team: r.team.name, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.gf, ga: r.ga, gd: r.gd, points: r.points }));
    const hash = rows.map(r => `${r.teamId}:${r.pos}:${r.points}:${r.gd}:${r.gf}:${r.played}`).join('|');
    const last = await db.prepare(`SELECT version, hash FROM league_table_snapshots WHERE competition_id = ? AND matchday = ? ORDER BY version DESC LIMIT 1`).bind(comp.id, md).first();
    if (last?.hash === hash) continue;
    const version = (last?.version || 0) + 1;
    const reason = last ? 'A result or points adjustment changed after the round was saved' : 'Round complete';
    await db.prepare(`INSERT INTO league_table_snapshots (competition_id, matchday, version, rows_json, hash, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(comp.id, md, version, JSON.stringify(rows), hash, reason, new Date(now).toISOString()).run();
    await logLeague(db, SYSTEM, 'table.snapshot', 'matchday', md, null, { result: `Table after Matchday ${md} saved${version > 1 ? ` (version ${version}: ${reason.toLowerCase()})` : ''}. Leaders: ${rows[0]?.team} (${rows[0]?.points} pts).` });
    saved.push({ matchday: md, version });
  }
  return saved;
}
export async function listSnapshots(env) {
  const db = env.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS league_table_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, competition_id INTEGER NOT NULL, matchday INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, rows_json TEXT NOT NULL, hash TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL)`).run();
  const comp = await getCompetition(db, null);
  if (!comp) return [];
  return (await db.prepare(`SELECT * FROM league_table_snapshots WHERE competition_id = ? ORDER BY matchday DESC, version DESC`).bind(comp.id).all()).results
    .map(r => ({ id: r.id, matchday: r.matchday, version: r.version, reason: r.reason, createdAt: r.created_at, rows: JSON.parse(r.rows_json) }));
}

/** The every-minute run: settle matches around now and any still disagreeing, then the reminders. */
export async function scoresTick(env, { now = Date.now() } = {}) {
  await ensureConsensusSchema(env);
  const s = await getScoreSettings(env);
  await setInternal(env, '_last_tick', new Date(now).toISOString());
  // Automatic licensed sources first (Phase 6), so their reports are settled below.
  const polled = await pollSources(env, s, { now }).catch(err => { console.error('[scores] poll', err); return []; });
  const ids = (await env.DB.prepare(`SELECT f.id FROM league_fixtures f LEFT JOIN score_state st ON st.fixture_id = f.id
    WHERE f.kickoff_at BETWEEN ? AND ? OR st.state IN ('PENDING', 'CONFLICT')`).bind(new Date(now - 8 * 3600e3).toISOString(), new Date(now + 3600e3).toISOString()).all()).results.map(r => r.id);
  const settled = [];
  for (const id of ids) settled.push(await settleFixture(env, id, { now, settings: s }));
  const missing = await missingResults(env, { now, settings: s });
  const snapshots = await snapshotRounds(env, { now }).catch(err => { console.error('[scores] snapshots', err); return []; });
  const summary = await (await import('./summary.js')).maybeDailySummary(env, { now, settings: s }).catch(err => { console.error('[scores] summary', err); return null; });
  return { summary, polled: polled.map(p => ({ type: p.type, ok: p.ok, error: p.error || null })), snapshots: snapshots.length, settled: settled.filter(Boolean).length, conflicts: settled.filter(x => x?.state === 'CONFLICT').length, missing: missing.length };
}
/** Fallback until the cron Worker calls /api/internal/scores-run itself: run when the last run is over 90 seconds old. */
export async function scoresTickIfDue(env, now = Date.now()) {
  const s = await getScoreSettings(env);
  if (s._last_tick && now - Date.parse(s._last_tick) < 90e3) return null;
  return scoresTick(env, { now });
}

/** Bell numbers. */
export async function consensusCounts(env) {
  await ensureConsensusSchema(env);
  const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM score_state WHERE state = 'CONFLICT'`).first();
  const missing = await missingResults(env, { alert: false });
  return { conflicts: c.n || 0, missing: missing.length };
}
