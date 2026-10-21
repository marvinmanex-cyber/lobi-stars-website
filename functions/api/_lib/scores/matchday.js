// Score verification, Phase 2: the staff "Other Games" screen. One card per
// conference match of a round, with every report received, an agreement
// indicator, quick staff entry, "Mark as official result" (OFFICIAL_NNL, with a
// note) and a VERIFIED staff decision that overrides all sources (with a
// reason). Decisions are stored and logged; the table only starts using them
// in Phase 4/5 (consensus engine and table engine), so nothing here changes the
// public table yet.
import { ensureScoreSchema, addReport, latestPerSource, independenceKey, SOURCE_TYPES, REPORT_STATUSES } from './model.js';
import { getCompetition, logLeague } from '../leagueDb.js';
import { logoFile } from '../logoFiles.js';

let ready = false;
export async function ensureDecisions(env) {
  await ensureScoreSchema(env);
  if (ready) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS score_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER NOT NULL, kind TEXT NOT NULL,
    home_goals INTEGER, away_goals INTEGER, status TEXT NOT NULL, reason TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_score_decisions_fixture ON score_decisions (fixture_id, active)`).run();
  ready = true;
}

const sameResult = (a, b) => a.home_goals === b.home_goals && a.away_goals === b.away_goals && a.status === b.status;
/**
 * The agreement indicator from the latest report of each independent source:
 * none / single (🟡 1 source) / agreed (🟢 two or more agree, none differ) / conflict (🔴).
 * (Phase 4 adds the live-play grace window and turns this into confirmed results.)
 */
export function agreement(latest) {
  if (!latest.length) return { state: 'none' };
  if (latest.length === 1) return { state: 'single', result: latest[0] };
  const first = latest[0];
  if (latest.every(r => sameResult(r, first))) return { state: 'agreed', result: first, sources: latest.length };
  return { state: 'conflict' };
}
/** The decided result: the newest active OFFICIAL beats VERIFIED; null when none. */
export function decidedResult(decisions) {
  const active = decisions.filter(d => d.active);
  return active.filter(d => d.kind === 'OFFICIAL').sort(newest)[0] || active.filter(d => d.kind === 'VERIFIED').sort(newest)[0] || null;
}
const newest = (a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id;

/** The round to show: the one with a match today, else the next round, else the last one played. */
export function pickRound(fixtures, now = Date.now()) {
  const day = 864e5;
  const withKo = fixtures.filter(f => f.kickoff_at && f.matchday);
  const today = withKo.find(f => Math.abs(Date.parse(f.kickoff_at) - now) < day);
  if (today) return today.matchday;
  const next = withKo.filter(f => Date.parse(f.kickoff_at) > now).sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at))[0];
  if (next) return next.matchday;
  return withKo.sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at))[0]?.matchday || 1;
}

export async function matchdayView(env, { round = null, now = Date.now() } = {}) {
  await ensureDecisions(env);
  const db = env.DB;
  const comp = await getCompetition(db, null);
  if (!comp) return { error: 'No competition set up.' };
  const fixtures = (await db.prepare(`SELECT * FROM league_fixtures WHERE competition_id = ? ORDER BY kickoff_at, match_no`).bind(comp.id).all()).results;
  const rounds = [...new Set(fixtures.map(f => f.matchday).filter(Boolean))].sort((a, b) => a - b);
  const md = rounds.includes(Number(round)) ? Number(round) : pickRound(fixtures, now);
  const list = fixtures.filter(f => f.matchday === md);
  const teams = new Map((await db.prepare(`SELECT * FROM league_teams`).all()).results.map(t => [t.id, t]));
  const venues = new Map((await db.prepare(`SELECT * FROM league_venues`).all()).results.map(v => [v.id, v.name]));
  const ids = list.map(f => f.id);
  const q = ids.map(() => '?').join(',') || 'NULL';
  const reports = ids.length ? (await db.prepare(`SELECT * FROM score_reports WHERE fixture_id IN (${q}) ORDER BY received_at DESC, id DESC`).bind(...ids).all()).results : [];
  const decisions = ids.length ? (await db.prepare(`SELECT * FROM score_decisions WHERE fixture_id IN (${q}) ORDER BY created_at DESC, id DESC`).bind(...ids).all()).results : [];
  const team = id => { const t = teams.get(id); return t ? { id: t.id, name: t.name, short: t.short_name, crest: logoFile(t.crest_url), isLobi: !!t.is_lobi } : null; };
  const cards = list.map(f => {
    const rs = reports.filter(r => r.fixture_id === f.id), counted = rs.filter(r => !r.needs_review);
    const latest = latestPerSource(counted);
    const ag = agreement(latest), dec = decidedResult(decisions.filter(d => d.fixture_id === f.id));
    const confirmed = dec ? { home_goals: dec.home_goals, away_goals: dec.away_goals, status: dec.status, by: dec.kind === 'OFFICIAL' ? 'Official NNL' : 'Verified by staff', reason: dec.reason, at: dec.created_at }
      : ag.state === 'agreed' ? { home_goals: ag.result.home_goals, away_goals: ag.result.away_goals, status: ag.result.status, by: `${ag.sources} sources agree` } : null;
    return {
      id: f.id, matchNo: f.match_no, round: f.matchday, kickoff: f.kickoff_at, venue: venues.get(f.venue_id) || '', home: team(f.home_team_id), away: team(f.away_team_id),
      leagueStatus: f.status, leagueScore: f.home_goals === null ? null : `${f.home_goals}-${f.away_goals}`,
      agreement: ag.state, confirmed,
      reports: rs.slice(0, 30).map(r => ({ id: r.id, source: SOURCE_TYPES[r.source_type]?.label || r.source_type, type: r.source_type, who: r.source_label || '', home_goals: r.home_goals, away_goals: r.away_goals,
        status: r.status, minute: r.minute, at: r.received_at, review: !!r.needs_review, reason: r.review_reason, latest: latest.some(l => l.id === r.id), independentAs: independenceKey(r) })),
      decisions: decisions.filter(d => d.fixture_id === f.id).slice(0, 10),
    };
  });
  return { competition: { id: comp.id, name: comp.short_name || comp.name }, rounds, round: md, cards, statuses: REPORT_STATUSES };
}

const label = (f, h, a) => `${h?.name || '?'} ${f.home_goals ?? ''}${f.home_goals === null || f.home_goals === undefined ? '' : '–'}${f.away_goals ?? ''} ${a?.name || '?'}`;
async function fixtureNames(env, id) {
  return env.DB.prepare(`SELECT f.*, h.name AS home_name, a.name AS away_name FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id WHERE f.id = ?`).bind(Number(id)).first();
}
const words = (f, hg, ag, status) => `${f.home_name} ${hg ?? '-'}–${ag ?? '-'} ${f.away_name} (${String(status).replace('_', ' ').toLowerCase()})`;

/** Quick staff entry (STAFF_MANUAL report). */
export async function staffEntry(env, admin, b) {
  const f = await fixtureNames(env, b.fixtureId);
  if (!f) return { error: 'Match not found.' };
  const r = await addReport(env, { sourceType: 'STAFF_MANUAL', identity: `staff:${admin.id}`, label: admin.name, fixtureId: f.id, homeGoals: b.homeGoals, awayGoals: b.awayGoals,
    status: b.status, minute: b.minute, raw: { enteredBy: admin.name, via: 'Other Games' }, createdBy: admin.name });
  if (r.error) return r;
  await logLeague(env.DB, admin, 'score.report', 'fixture', f.id, null, { report: `${words(f, b.homeGoals, b.awayGoals, b.status)} entered by ${admin.name}` });
  return r;
}
/** "Mark as official result": an OFFICIAL_NNL report and an OFFICIAL decision (note required). */
export async function officialResult(env, admin, b) {
  await ensureDecisions(env);
  const note = String(b.note || '').trim().slice(0, 300);
  if (note.length < 5) return { error: 'Say where the official result comes from (e.g. "NNL website result, 21 Oct").' };
  const f = await fixtureNames(env, b.fixtureId);
  if (!f) return { error: 'Match not found.' };
  const status = String(b.status || 'FULL_TIME').toUpperCase();
  if (!['FULL_TIME', 'AWARDED', 'POSTPONED', 'ABANDONED', 'CANCELLED'].includes(status)) return { error: 'An official result is full time, awarded, postponed, abandoned or cancelled.' };
  const r = await addReport(env, { sourceType: 'OFFICIAL_NNL', identity: 'official', label: `Official NNL (entered by ${admin.name})`, fixtureId: f.id, homeGoals: b.homeGoals, awayGoals: b.awayGoals,
    status, raw: { note, enteredBy: admin.name }, confidenceNotes: `Official: ${note}`, createdBy: admin.name });
  if (r.error) return r;
  await env.DB.prepare(`INSERT INTO score_decisions (fixture_id, kind, home_goals, away_goals, status, reason, created_by, created_at) VALUES (?, 'OFFICIAL', ?, ?, ?, ?, ?, ?)`)
    .bind(f.id, b.homeGoals === '' || b.homeGoals === undefined ? null : Number(b.homeGoals), b.awayGoals === '' || b.awayGoals === undefined ? null : Number(b.awayGoals), status, note, admin.name, new Date().toISOString()).run();
  await logLeague(env.DB, admin, 'score.official', 'fixture', f.id, null, { result: `Official result ${words(f, b.homeGoals, b.awayGoals, status)} entered by ${admin.name}: ${note}` });
  return { ok: true, reportId: r.id };
}
/** VERIFIED staff decision: overrides all sources (reason required, logged). */
export async function verifiedResult(env, admin, b) {
  await ensureDecisions(env);
  const reason = String(b.reason || '').trim().slice(0, 300);
  if (reason.length < 5) return { error: 'Give the reason for the verified result (e.g. "Sources disagreed; confirmed with both club media officers").' };
  const f = await fixtureNames(env, b.fixtureId);
  if (!f) return { error: 'Match not found.' };
  const status = String(b.status || '').toUpperCase();
  if (!REPORT_STATUSES.includes(status)) return { error: 'Unknown status.' };
  const toInt = v => (v === '' || v === null || v === undefined ? null : Number(v));
  const hg = toInt(b.homeGoals), ag = toInt(b.awayGoals);
  if ([hg, ag].some(v => v !== null && (!Number.isInteger(v) || v < 0 || v > 99))) return { error: 'Goals must be whole numbers from 0 to 99.' };
  if (['FULL_TIME', 'AWARDED', 'LIVE', 'HALF_TIME'].includes(status) && (hg === null || ag === null)) return { error: 'This status needs both scores.' };
  await env.DB.prepare(`INSERT INTO score_decisions (fixture_id, kind, home_goals, away_goals, status, reason, created_by, created_at) VALUES (?, 'VERIFIED', ?, ?, ?, ?, ?, ?)`)
    .bind(f.id, hg, ag, status, reason, admin.name, new Date().toISOString()).run();
  await logLeague(env.DB, admin, 'score.verified', 'fixture', f.id, null, { result: `Verified result ${words(f, hg, ag, status)} set by ${admin.name}: ${reason}` });
  return { ok: true };
}
/** Withdraw a decision (e.g. entered on the wrong match). Kept, marked inactive, logged. */
export async function withdrawDecision(env, admin, id, why) {
  await ensureDecisions(env);
  const d = await env.DB.prepare(`SELECT * FROM score_decisions WHERE id = ? AND active = 1`).bind(Number(id)).first();
  if (!d) return { error: 'Decision not found.' };
  const reason = String(why || '').trim().slice(0, 200);
  if (reason.length < 5) return { error: 'Give the reason for withdrawing it.' };
  await env.DB.prepare(`UPDATE score_decisions SET active = 0 WHERE id = ?`).bind(d.id).run();
  const f = await fixtureNames(env, d.fixture_id);
  await logLeague(env.DB, admin, 'score.withdrawn', 'fixture', d.fixture_id, d, { result: `${d.kind === 'OFFICIAL' ? 'Official' : 'Verified'} result for ${f?.home_name} v ${f?.away_name} withdrawn by ${admin.name}: ${reason}` });
  return { ok: true };
}
export { label };
