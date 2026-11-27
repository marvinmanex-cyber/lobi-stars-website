// Statistics Center data (see statsCentre.js for accounts and the activity log).
//
// Store EVENTS, not totals: one row per action in sx_events. Every figure (score, team stats, a player's
// minutes, goals, assists, cards, season and career totals, form, head-to-head) is worked out here from the
// events and the line-ups, so correcting one event corrects everything.
//
// A match goes draft -> live -> review -> published. Publishing (a statistician with "can publish") checks the
// match (validate()), saves a snapshot for the public pages (published_json) and feeds the rest of the
// website for that fixture: the player stats behind /stats and the player pages (player_match_stats) and the
// score, line-ups, timeline and team stats of the public match page (match_centre). For a published match
// the Statistics Center is the source; Match Centre stays as it was for matches never recorded here.
import { ensureStatsCentreSchema, sxLog, statsActor, newId, clean, oneLine, sxSettings } from './statsCentre.js';
import { ensureTable as ensureMatchCentre, isHomeGame } from './matchCentre.js';
import { savePlayerStats, seasonOf } from './stats.js';
import { matchSlug } from './matchSlug.js';

export const STATUSES = ['draft', 'live', 'review', 'published'];
export const EVENT_TYPES = {
  goal: 'Goal', shot: 'Shot', pass_key: 'Key pass', corner: 'Corner', free_kick: 'Free kick', throw_in: 'Throw-in', penalty: 'Penalty awarded',
  tackle: 'Tackle', interception: 'Interception', clearance: 'Clearance', block: 'Block', aerial_duel: 'Aerial duel',
  gk_save: 'Save', gk_claim: 'Goalkeeper claim', foul_committed: 'Foul', foul_won: 'Foul won', yellow_card: 'Yellow card', red_card: 'Red card',
  offside: 'Offside', substitution: 'Substitution', injury: 'Injury', stoppage: 'Stoppage', var_decision: 'VAR decision',
};
// Phase 1 one-tap buttons on the live screen (the rest can be added in review; Phase 2 adds passes and zones).
export const LIVE_BUTTONS = ['goal', 'shot', 'corner', 'foul_committed', 'yellow_card', 'red_card', 'offside', 'substitution', 'injury', 'gk_save'];
export const PERIODS = { '1H': [0, 45], '2H': [45, 90], ET1: [90, 105], ET2: [105, 120], PEN: [120, 120] };
const PERIOD_ORDER = { '1H': 1, '2H': 2, ET1: 3, ET2: 4, PEN: 5 };
export const OUTCOMES = {
  shot: ['on_target', 'off_target', 'blocked', 'woodwork'],
  penalty: ['scored', 'saved', 'missed'],
  aerial_duel: ['won', 'lost'], tackle: ['won', 'lost'],
  var_decision: ['goal_given', 'goal_disallowed', 'penalty_given', 'penalty_cancelled', 'red_card', 'no_change'],
  substitution: ['tactical', 'injury'],
  injury: ['continued', 'off'],
};
export const BODY_PARTS = ['right_foot', 'left_foot', 'head', 'other'];
export const DETAIL_TYPES = ['open_play', 'penalty', 'free_kick', 'corner', 'own_goal', 'counter', 'set_piece', 'tactical', 'injury', 'second_yellow'];
export const DEFAULT_COMPETITIONS = ['NNL', 'NPFL', 'FA Cup', 'Benue FA Cup', 'Friendly', 'Pre-season'];

const nowIso = () => new Date().toISOString();
const int = (v, min = 0, max = 200) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null; };
const pick = (v, list) => (list.includes(v) ? v : null);
const isLobi = n => /lobi stars/i.test(n || '');

// ── Squad and fixtures (read only here) ──
export async function loadRoster(env, url) {
  try { return (await (await env.ASSETS.fetch(new URL('/data/players.json', url))).json()).filter(p => p && p.slug && !p.isSample); } catch { return []; }
}
export async function siteSettings(env, url) {
  try { return await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json(); } catch { return {}; }
}
export const startMonthOf = site => (/^\d{4}-(\d{2})-\d{2}$/.test(site?.seasonStart || '') ? Number(site.seasonStart.slice(5, 7)) : 8);

/** Fixtures from the club's fixture list (events), newest first, marking those already recorded here. */
export async function listFixtures(db) {
  await ensureStatsCentreSchema(db);
  const { results } = await db.prepare(`SELECT e.id, e.home_team, e.away_team, e.competition, e.event_date, e.venue, e.is_home, x.id AS sx_id, x.status AS sx_status
    FROM events e LEFT JOIN sx_matches x ON x.event_id = e.id AND x.is_deleted = 0 WHERE e.active = 1 ORDER BY e.event_date DESC LIMIT 200`).all();
  return results.map(r => ({ id: r.id, home: r.home_team, away: r.away_team, competition: r.competition, date: r.event_date, venue: r.venue, lobiHome: isHomeGame(r), recorded: r.sx_id || null, recordedStatus: r.sx_status || null }));
}

// ── Matches ──
const matchView = m => m && ({
  id: m.id, eventId: m.event_id, season: m.season, competition: m.competition, matchday: m.matchday, date: m.match_date, kickoff: m.kickoff_time,
  venue: m.venue, home: m.home_team, away: m.away_team, lobiHome: !!m.is_lobi_home, referee: m.referee, assistants: m.assistants, weather: m.weather,
  pitch: m.pitch_condition, attendance: m.attendance, formationHome: m.formation_home, formationAway: m.formation_away, formationHomeFinish: m.formation_home_finish || '', formationAwayFinish: m.formation_away_finish || '', possessionHome: m.possession_home,
  homeScore: m.home_score, awayScore: m.away_score, htHome: m.ht_home_score, htAway: m.ht_away_score, status: m.status, clock: parse(m.clock_json, null),
  length: m.length_minutes, report: m.report_text || '', highlights: m.highlights_url || '', motm: m.motm_slug || '',
  createdBy: m.created_by, updatedBy: m.updated_by, verifiedBy: m.verified_by, verifiedAt: m.verified_at, publishedAt: m.published_at, updatedAt: m.updated_at,
});
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const titleOf = m => `${m.home_team} v ${m.away_team} (${String(m.match_date).slice(0, 10)})`;
const byName = user => `${user.fullName} (${user.loginId})`;

export async function getMatchRow(db, id) {
  await ensureStatsCentreSchema(db);
  return db.prepare(`SELECT * FROM sx_matches WHERE id = ? AND is_deleted = 0`).bind(String(id || '')).first();
}

export async function listMatches(db, { season = '', status = '', competition = '' } = {}) {
  await ensureStatsCentreSchema(db);
  const where = ['is_deleted = 0'], args = [];
  if (season) { where.push('season = ?'); args.push(season); }
  if (STATUSES.includes(status)) { where.push('status = ?'); args.push(status); }
  if (competition) { where.push('competition = ?'); args.push(competition); }
  const { results } = await db.prepare(`SELECT * FROM sx_matches WHERE ${where.join(' AND ')} ORDER BY match_date DESC LIMIT 300`).bind(...args).all();
  return results.map(matchView);
}

export async function seasons(db, current) {
  await ensureStatsCentreSchema(db);
  const { results } = await db.prepare(`SELECT DISTINCT season FROM sx_matches WHERE is_deleted = 0 ORDER BY season DESC`).all();
  return [...new Set([current, ...results.map(r => r.season)].filter(Boolean))].sort().reverse();
}

const SETUP_FIELDS = {
  competition: v => oneLine(v, 60), matchday: v => oneLine(v, 20) || null, venue: v => oneLine(v, 120) || null,
  match_date: v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 25) : undefined),
  kickoff_time: v => (/^\d{2}:\d{2}$/.test(String(v || '')) ? v : null),
  home_team: v => oneLine(v, 80) || undefined, away_team: v => oneLine(v, 80) || undefined,
  is_lobi_home: v => (v ? 1 : 0), referee: v => oneLine(v, 80) || null, assistants: v => oneLine(v, 160) || null,
  weather: v => oneLine(v, 60) || null, pitch_condition: v => oneLine(v, 60) || null, attendance: v => int(v, 0, 100000),
  formation_home: v => (/^[1-5](-[1-5]){1,4}$/.test(String(v || '')) ? v : null), formation_away: v => (/^[1-5](-[1-5]){1,4}$/.test(String(v || '')) ? v : null),
  formation_home_finish: v => (/^[1-5](-[1-5]){1,4}$/.test(String(v || '')) ? v : null), formation_away_finish: v => (/^[1-5](-[1-5]){1,4}$/.test(String(v || '')) ? v : null),
  possession_home: v => (v === '' || v === null || v === undefined ? null : int(v, 0, 100)),
  length_minutes: v => (Number(v) === 120 ? 120 : 90),
  report_text: v => clean(v, 40000) || null, highlights_url: v => (/^https:\/\/\S{6,400}$/.test(String(v || '').trim()) ? String(v).trim() : null),
  motm_slug: v => (/^[a-z0-9-]{2,80}$/.test(String(v || '')) ? v : null),
};
const FIELD_KEYS = { competition: 'competition', matchday: 'matchday', venue: 'venue', date: 'match_date', kickoff: 'kickoff_time', home: 'home_team', away: 'away_team',
  lobiHome: 'is_lobi_home', referee: 'referee', assistants: 'assistants', weather: 'weather', pitch: 'pitch_condition', attendance: 'attendance',
  formationHome: 'formation_home', formationAway: 'formation_away', formationHomeFinish: 'formation_home_finish', formationAwayFinish: 'formation_away_finish', possessionHome: 'possession_home', length: 'length_minutes', report: 'report_text',
  highlights: 'highlights_url', motm: 'motm_slug' };

/** New match: from a fixture (eventId) or typed in (a friendly not in the fixtures). */
export async function createMatch(db, user, b, { startMonth = 8, request = null } = {}) {
  await ensureStatsCentreSchema(db);
  let row;
  if (b.eventId) {
    const e = await db.prepare(`SELECT * FROM events WHERE id = ?`).bind(String(b.eventId)).first();
    if (!e) return { error: 'That fixture was not found.' };
    const had = await db.prepare(`SELECT id FROM sx_matches WHERE event_id = ? AND is_deleted = 0`).bind(e.id).first();
    if (had) return { error: 'This fixture is already being recorded.', id: had.id };
    const ko = new Date(e.event_date);
    row = { event_id: e.id, competition: e.competition || 'NNL', match_date: e.event_date, venue: e.venue, home_team: e.home_team, away_team: e.away_team,
      is_lobi_home: isHomeGame(e) ? 1 : 0, kickoff_time: Number.isFinite(ko.getTime()) ? new Date(ko.getTime() + 3600e3).toISOString().slice(11, 16) : null };
  } else {
    const home = oneLine(b.home, 80), away = oneLine(b.away, 80), date = String(b.date || '');
    if (!home || !away || !/^\d{4}-\d{2}-\d{2}/.test(date)) return { error: 'Enter both teams and the date.' };
    if (!isLobi(home) && !isLobi(away)) return { error: 'One of the teams must be Lobi Stars.' };
    row = { event_id: null, competition: oneLine(b.competition, 60) || 'Friendly', match_date: date, venue: oneLine(b.venue, 120) || null, home_team: home, away_team: away,
      is_lobi_home: isLobi(home) ? 1 : 0, kickoff_time: /^\d{2}:\d{2}$/.test(b.kickoff || '') ? b.kickoff : null };
  }
  const id = newId('sxm'), at = nowIso();
  await db.prepare(`INSERT INTO sx_matches (id, event_id, season, competition, match_date, kickoff_time, venue, home_team, away_team, is_lobi_home, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, row.event_id, seasonOf(row.match_date, startMonth), row.competition, row.match_date, row.kickoff_time, row.venue,
    row.home_team, row.away_team, row.is_lobi_home, byName(user), byName(user), at, at).run();
  await sxLog(db, statsActor(user), 'create_match', { itemType: 'match', itemId: id, itemTitle: titleOf(row), after: row, request });
  return { ok: true, id };
}

export async function saveSetup(db, user, id, b, { startMonth = 8, request = null } = {}) {
  const m = await getMatchRow(db, id);
  if (!m) return { error: 'Match not found.' };
  if (m.status === 'published') return { error: 'This match is published. Reopen it for corrections first.' };
  const sets = {}, before = {};
  for (const [k, col] of Object.entries(FIELD_KEYS)) {
    if (!(k in (b || {}))) continue;
    const v = SETUP_FIELDS[col](b[k]);
    if (v === undefined) return { error: `Check the ${k === 'date' ? 'date' : k === 'home' || k === 'away' ? 'team names' : k}.` };
    if (v !== m[col]) { sets[col] = v; before[col] = m[col]; }
  }
  if (!Object.keys(sets).length) return { ok: true, unchanged: true };
  if (sets.match_date) sets.season = seasonOf(sets.match_date, startMonth);
  sets.updated_by = byName(user); sets.updated_at = nowIso();
  const cols = Object.keys(sets);
  await db.prepare(`UPDATE sx_matches SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map(c => sets[c]), id).run();
  await sxLog(db, statsActor(user), 'edit_match', { itemType: 'match', itemId: id, itemTitle: titleOf(m), before, after: sets, request });
  return { ok: true };
}

// ── Line-ups ──
const lineupView = r => ({ id: r.id, side: r.side, slug: r.player_slug || null, name: r.player_name, number: r.shirt_number, position: r.position || '',
  starter: !!r.is_starter, minutesOverride: r.minutes_override, rating: r.coach_rating, motm: !!r.is_motm });

/** Replaces both line-ups. Lobi Stars players must be in the squad list (by slug); opponents by name and number. */
export async function saveLineups(db, user, id, b, roster, { request = null } = {}) {
  const m = await getMatchRow(db, id);
  if (!m) return { error: 'Match not found.' };
  if (m.status === 'published') return { error: 'This match is published. Reopen it for corrections first.' };
  const bySlug = new Map(roster.map(p => [p.slug, p]));
  const lobiSide = m.is_lobi_home ? 'home' : 'away';
  const rows = [], warnings = [];
  const oppSide = lobiSide === 'home' ? 'away' : 'home';
  for (const side of ['home', 'away']) {
    const seen = new Set(), nums = new Map(), names = new Map();
    for (const [i, p] of (Array.isArray(b?.[side]) ? b[side] : []).slice(0, 30).entries()) {
      let slug = null, name = oneLine(p?.name, 80), number = int(p?.number, 0, 99);
      if (side === lobiSide) {
        const r = bySlug.get(String(p?.slug || ''));
        if (!r) return { error: `${name || 'A player'} is not in the Lobi Stars squad list.` };
        slug = r.slug; name = r.name; if (number === null) number = r.number ?? null;
        if (seen.has(slug)) { warnings.push(`${name} was listed twice (kept once).`); continue; } seen.add(slug);
      } else {
        if (!name) continue;
        const key = `${name.toLowerCase()}#${number}`; if (seen.has(key)) { warnings.push(`${name} was listed twice (kept once).`); continue; } seen.add(key);
        if (names.has(name.toLowerCase())) warnings.push(`${name} appears twice with different numbers.`); names.set(name.toLowerCase(), 1);
      }
      if (number !== null) { if (nums.has(number)) warnings.push(`${side === lobiSide ? 'Lobi Stars' : 'Opponent'}: shirt number ${number} is used by ${nums.get(number)} and ${name}.`); else nums.set(number, name); }
      rows.push({ id: newId('sxl'), side, slug, name, number, position: oneLine(p?.position, 8) || null, starter: p?.starter ? 1 : 0,
        minutes: p?.minutesOverride === '' || p?.minutesOverride === null || p?.minutesOverride === undefined ? null : int(p.minutesOverride, 0, 130),
        rating: p?.rating === '' || p?.rating === null || p?.rating === undefined ? null : Math.max(1, Math.min(10, Math.round(Number(p.rating) * 10) / 10)) || null,
        motm: p?.motm ? 1 : 0, sort: i });
    }
  }
  // Opponent players: saved once per club (registry) and linked, so they are offered next time we play them.
  const oppTeam = oppSide === 'home' ? m.home_team : m.away_team;
  for (const r of rows.filter(x => x.side === oppSide)) r.oppId = await upsertOpponentPlayer(db, user, oppTeam, r, id);
  const before = (await db.prepare(`SELECT side, player_slug, player_name, shirt_number, is_starter FROM sx_lineups WHERE match_id = ?`).bind(id).all()).results;
  await db.batch([
    db.prepare(`DELETE FROM sx_lineups WHERE match_id = ?`).bind(id),
    ...rows.map(r => db.prepare(`INSERT INTO sx_lineups (id, match_id, side, player_slug, player_name, shirt_number, position, is_starter, minutes_override, coach_rating, is_motm, sort, opponent_player_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id, id, r.side, r.slug, r.name, r.number, r.position, r.starter, r.minutes, r.rating, r.motm, r.sort, r.oppId || null)),
    db.prepare(`UPDATE sx_matches SET updated_by = ?, updated_at = ? WHERE id = ?`).bind(byName(user), nowIso(), id),
  ]);
  await sxLog(db, statsActor(user), 'edit_lineups', { itemType: 'match', itemId: id, itemTitle: titleOf(m), before, after: rows.map(r => ({ side: r.side, slug: r.slug, name: r.name, number: r.number, starter: r.starter })), request });
  return { ok: true, warnings: [...new Set(warnings)] };
}

// ── Events ──
const eventView = r => ({ id: r.id, side: r.side, type: r.event_type, slug: r.player_slug || null, name: r.player_name || '', relatedSlug: r.related_slug || null,
  relatedName: r.related_name || '', minute: r.minute, stoppage: r.stoppage_minute, period: r.period, outcome: r.outcome || '', bodyPart: r.body_part || '',
  detail: r.detail_type || '', zone: r.pitch_zone || '', scoreHome: r.score_home_at_time, scoreAway: r.score_away_at_time, notes: r.notes || '',
  createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at, deleted: !!r.is_deleted });
const chrono = (a, b) => (PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period]) || (a.minute - b.minute) || ((a.stoppage || 0) - (b.stoppage || 0)) || String(a.createdAt).localeCompare(String(b.createdAt));

/** Checks one event from the page. Returns { value } or { error }. */
export function parseEvent(e, { lobiSide, bySlug }) {
  const id = String(e?.id || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return { error: 'An event has no valid id.' };
  const type = pick(e?.type, Object.keys(EVENT_TYPES));
  if (!type) return { error: 'Unknown event type.' };
  const side = e?.side === 'away' ? 'away' : e?.side === 'home' ? 'home' : null;
  if (!side) return { error: 'Choose the team.' };
  const period = pick(e?.period, Object.keys(PERIODS));
  if (!period) return { error: 'Choose the half.' };
  const minute = int(e?.minute, 0, 130);
  if (minute === null) return { error: 'Enter the minute.' };
  const stoppage = e?.stoppage === '' || e?.stoppage === null || e?.stoppage === undefined ? null : int(e.stoppage, 0, 30);
  // The player: for Lobi Stars by squad slug; for the opponents by name (and number). An own goal is
  // recorded for the team that BENEFITS, with the player from the other team who put it in.
  const ownGoal = type === 'goal' && e?.detail === 'own_goal';
  const playerSide = ownGoal ? (side === 'home' ? 'away' : 'home') : side;
  const who = (slug, name, sideOf) => {
    if (sideOf === lobiSide && slug) { const p = bySlug.get(String(slug)); if (!p) return { error: 'That player is not in the Lobi Stars squad list.' }; return { slug: p.slug, name: p.name }; }
    return { slug: null, name: oneLine(name, 80) || null };
  };
  const p = who(e?.slug, e?.name, playerSide); if (p.error) return p;
  const relSide = side; // assist and player coming on are always from the same team
  const r = who(e?.relatedSlug, e?.relatedName, relSide); if (r.error) return r;
  const outcomes = OUTCOMES[type];
  return { value: {
    id, side, event_type: type, player_slug: p.slug, player_name: p.name, related_slug: r.slug, related_name: r.name, minute, stoppage_minute: stoppage, period,
    outcome: outcomes ? pick(e?.outcome, outcomes) : null, body_part: type === 'goal' || type === 'shot' ? pick(e?.bodyPart, BODY_PARTS) : null,
    detail_type: pick(e?.detail, DETAIL_TYPES), pitch_zone: /^[A-Za-z0-9_-]{1,12}$/.test(String(e?.zone || '')) ? e.zone : null, notes: oneLine(e?.notes, 300) || null,
  } };
}

/**
 * Saves events from the page (new ones and edits), safe to send twice: an event already saved with the same
 * id is updated, never doubled (the live screen re-sends what it saved while offline).
 * ops: [{ op: 'save', event } | { op: 'delete', id } | { op: 'restore', id }]
 */
export async function applyEvents(db, user, id, ops, roster, { request = null } = {}) {
  const m = await getMatchRow(db, id);
  if (!m) return { error: 'Match not found.' };
  if (m.status === 'published') return { error: 'This match is published. Reopen it for corrections first.' };
  const ctx = { lobiSide: m.is_lobi_home ? 'home' : 'away', bySlug: new Map(roster.map(p => [p.slug, p])) };
  const list = (Array.isArray(ops) ? ops : []).slice(0, 200);
  const results = [], stmts = [], logs = [], at = nowIso(), by = byName(user);
  const ids = list.map(o => String(o?.event?.id || o?.id || '')).filter(Boolean);
  const existing = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { results: rows } = await db.prepare(`SELECT * FROM sx_events WHERE match_id = ? AND id IN (${chunk.map(() => '?').join(',')})`).bind(id, ...chunk).all();
    for (const r of rows) existing.set(r.id, r);
  }
  for (const o of list) {
    if (o?.op === 'delete' || o?.op === 'restore') {
      const old = existing.get(String(o.id || ''));
      if (!old) { results.push({ id: o.id, ok: o.op === 'delete' }); continue; } // deleting what never arrived is fine
      stmts.push(db.prepare(`UPDATE sx_events SET is_deleted = ?, updated_by = ?, updated_at = ? WHERE id = ? AND match_id = ?`).bind(o.op === 'delete' ? 1 : 0, by, at, old.id, id));
      logs.push(['delete_event', old.id, `${EVENT_TYPES[old.event_type]} ${old.minute}'`, eventView(old), null, o.op === 'restore' ? 'restored' : 'removed (kept, can be restored)']);
      results.push({ id: old.id, ok: true });
      continue;
    }
    const p = parseEvent(o?.event, ctx);
    if (p.error) { results.push({ id: o?.event?.id || null, ok: false, error: p.error }); continue; }
    const v = p.value, old = existing.get(v.id);
    if (old) {
      stmts.push(db.prepare(`UPDATE sx_events SET side = ?, event_type = ?, player_slug = ?, player_name = ?, related_slug = ?, related_name = ?, minute = ?, stoppage_minute = ?, period = ?,
        outcome = ?, body_part = ?, detail_type = ?, pitch_zone = ?, notes = ?, updated_by = ?, updated_at = ?, is_deleted = 0 WHERE id = ? AND match_id = ?`)
        .bind(v.side, v.event_type, v.player_slug, v.player_name, v.related_slug, v.related_name, v.minute, v.stoppage_minute, v.period, v.outcome, v.body_part, v.detail_type, v.pitch_zone, v.notes, by, at, v.id, id));
      logs.push(['edit_event', v.id, `${EVENT_TYPES[v.event_type]} ${v.minute}'`, eventView(old), v, null]);
    } else {
      stmts.push(db.prepare(`INSERT INTO sx_events (id, match_id, side, event_type, player_slug, player_name, related_slug, related_name, minute, stoppage_minute, period, outcome, body_part, detail_type, pitch_zone, notes, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(v.id, id, v.side, v.event_type, v.player_slug, v.player_name, v.related_slug, v.related_name, v.minute, v.stoppage_minute, v.period, v.outcome, v.body_part, v.detail_type, v.pitch_zone, v.notes, by, at));
      logs.push(['add_event', v.id, `${EVENT_TYPES[v.event_type]} ${v.minute}'`, null, v, null]);
    }
    const twin = !old && (v.player_slug || v.player_name) && (await db.prepare(`SELECT id FROM sx_events WHERE match_id = ? AND is_deleted = 0 AND event_type = ? AND side = ? AND minute = ? AND COALESCE(player_slug, player_name, '') = COALESCE(?, ?, '') AND id <> ? LIMIT 1`)
      .bind(id, v.event_type, v.side, v.minute, v.player_slug, v.player_name, v.id).first());
    results.push({ id: v.id, ok: true, ...(twin ? { duplicateOf: twin.id } : {}) });
  }
  if (stmts.length) {
    for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
    await recalc(db, id, user);
    const A = statsActor(user);
    for (const [action, eid, title, before, after, details] of logs) await sxLog(db, A, action, { itemType: 'event', itemId: eid, itemTitle: `${title} · ${titleOf(m)}`, before, after, details, request });
  }
  return { ok: true, results };
}

/** Score, half-time score and "score at the time" on every event, worked out again from the goal events. */
export async function recalc(db, id, user = null) {
  const { results } = await db.prepare(`SELECT * FROM sx_events WHERE match_id = ? AND is_deleted = 0`).bind(id).all();
  const evs = results.map(r => ({ ...r, createdAt: r.created_at, stoppage: r.stoppage_minute })).sort(chrono);
  let h = 0, a = 0, htH = null, htA = null;
  const stmts = [];
  for (const e of evs) {
    if (htH === null && PERIOD_ORDER[e.period] >= 2) { htH = h; htA = a; }
    if (e.event_type === 'goal') { if (e.side === 'home') h++; else a++; }
    if (e.score_home_at_time !== h || e.score_away_at_time !== a) stmts.push(db.prepare(`UPDATE sx_events SET score_home_at_time = ?, score_away_at_time = ? WHERE id = ?`).bind(h, a, e.id));
  }
  const m = await db.prepare(`SELECT clock_json FROM sx_matches WHERE id = ?`).bind(id).first();
  const clock = parse(m?.clock_json, null);
  if (htH === null && clock && ['HT', '2H', 'ET1', 'ET2', 'PEN', 'FT'].includes(clock.period)) { htH = h; htA = a; }
  stmts.push(db.prepare(`UPDATE sx_matches SET home_score = ?, away_score = ?, ht_home_score = ?, ht_away_score = ?, updated_at = ?${user ? ', updated_by = ?' : ''} WHERE id = ?`)
    .bind(h, a, htH, htA, nowIso(), ...(user ? [byName(user)] : []), id));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return { home: h, away: a };
}

// ── The live clock ──
// clock_json: { period: '1H'|'HT'|'2H'|'ET1'|'ET2'|'PEN'|'FT', startedAt (ms), pausedAt (ms|null), pausedMs }
// The minute shown = the period's first minute + time played in the period (pauses left out).
export async function setClock(db, user, id, { action, at }, { request = null } = {}) {
  const m = await getMatchRow(db, id);
  if (!m) return { error: 'Match not found.' };
  if (m.status === 'published') return { error: 'This match is published.' };
  const t = Number.isFinite(Number(at)) && Math.abs(Number(at) - Date.now()) < 6 * 3600e3 ? Number(at) : Date.now(); // the tap time (offline taps arrive later)
  const c = parse(m.clock_json, null) || { period: null, startedAt: null, pausedAt: null, pausedMs: 0 };
  const start = period => ({ period, startedAt: t, pausedAt: null, pausedMs: 0 });
  let next;
  switch (action) {
    case 'start_1h': next = start('1H'); break;
    case 'half_time': next = { period: 'HT', startedAt: null, pausedAt: null, pausedMs: 0 }; break;
    case 'start_2h': next = start('2H'); break;
    case 'start_et1': next = start('ET1'); break;
    case 'start_et2': next = start('ET2'); break;
    case 'penalties': next = { period: 'PEN', startedAt: null, pausedAt: null, pausedMs: 0 }; break;
    case 'full_time': next = { period: 'FT', startedAt: null, pausedAt: null, pausedMs: 0 }; break;
    case 'pause': if (!c.startedAt || c.pausedAt) return { ok: true, clock: c }; next = { ...c, pausedAt: t }; break;
    case 'resume': if (!c.pausedAt) return { ok: true, clock: c }; next = { ...c, pausedAt: null, pausedMs: (c.pausedMs || 0) + (t - c.pausedAt) }; break;
    default: return { error: 'Unknown clock action.' };
  }
  const status = action === 'full_time' ? 'review' : m.status === 'draft' ? 'live' : m.status;
  await db.prepare(`UPDATE sx_matches SET clock_json = ?, status = ?, length_minutes = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(next), status, ['start_et1', 'start_et2', 'penalties'].includes(action) ? 120 : m.length_minutes, byName(user), nowIso(), id).run();
  if (['half_time', 'full_time', 'start_2h'].includes(action)) await recalc(db, id, user);
  await sxLog(db, statsActor(user), 'clock', { itemType: 'match', itemId: id, itemTitle: titleOf(m), details: action.replace(/_/g, ' '), request });
  return { ok: true, clock: next, status };
}

// ── Working out the numbers ──
const playerKey = (side, slug, name) => (slug ? `s:${slug}` : `${side}:${String(name || '').toLowerCase()}`);

/** Everything about one match worked out from its line-ups and events. */
export function derive(match, lineups, events) {
  const L = match.length || 90;
  const evs = events.filter(e => !e.deleted).sort(chrono);
  const at = e => Math.min(L, e.minute + 0); // minute an event happened (stoppage time counts as the period's last minute)
  const players = new Map();
  const ensure = (side, slug, name, extra = {}) => {
    const k = playerKey(side, slug, name);
    if (!players.has(k)) players.set(k, { key: k, side, slug: slug || null, name: name || '', number: null, position: '', starter: false, on: null, off: null, minutes: 0,
      goals: 0, ownGoals: 0, assists: 0, shots: 0, shotsOnTarget: 0, foulsCommitted: 0, foulsWon: 0, yellow: 0, red: 0, offsides: 0, saves: 0, corners: 0, keyPasses: 0,
      tackles: 0, interceptions: 0, rating: null, motm: false, minutesOverride: null, inLineup: false, ...extra });
    return players.get(k);
  };
  for (const l of lineups) {
    const p = ensure(l.side, l.slug, l.name);
    Object.assign(p, { number: l.number, position: l.position, starter: l.starter, inLineup: true, rating: l.rating, motm: l.motm, minutesOverride: l.minutesOverride, on: l.starter ? 0 : null });
  }
  const team = side => ({ goals: 0, shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, yellow: 0, red: 0, offsides: 0, saves: 0, freeKicks: 0, throwIns: 0, penalties: 0, keyPasses: 0, tackles: 0, interceptions: 0, side });
  const T = { home: team('home'), away: team('away') };
  const other = s => (s === 'home' ? 'away' : 'home');
  for (const e of evs) {
    const t = T[e.side];
    const p = e.slug || e.name ? ensure(e.type === 'goal' && e.detail === 'own_goal' ? other(e.side) : e.side, e.slug, e.name) : null;
    switch (e.type) {
      case 'goal':
        t.goals++;
        if (e.detail === 'own_goal') { if (p) p.ownGoals++; break; }
        t.shots++; t.shotsOnTarget++;
        if (p) { p.goals++; p.shots++; p.shotsOnTarget++; }
        if (e.relatedSlug || e.relatedName) ensure(e.side, e.relatedSlug, e.relatedName).assists++;
        break;
      case 'shot': t.shots++; if (e.outcome === 'on_target') t.shotsOnTarget++; if (p) { p.shots++; if (e.outcome === 'on_target') p.shotsOnTarget++; } break;
      case 'corner': t.corners++; if (p) p.corners++; break;
      case 'foul_committed': t.fouls++; if (p) p.foulsCommitted++; break;
      case 'foul_won': if (p) p.foulsWon++; break;
      case 'yellow_card': t.yellow++; if (p) p.yellow++; break;
      case 'red_card': t.red++; if (p) { p.red++; if (p.off === null) p.off = at(e); } break;
      case 'offside': t.offsides++; if (p) p.offsides++; break;
      case 'gk_save': t.saves++; if (p) p.saves++; break;
      case 'free_kick': t.freeKicks++; break;
      case 'throw_in': t.throwIns++; break;
      case 'penalty': t.penalties++; break;
      case 'pass_key': t.keyPasses++; if (p) p.keyPasses++; break;
      case 'tackle': t.tackles++; if (p) p.tackles++; break;
      case 'interception': t.interceptions++; if (p) p.interceptions++; break;
      case 'substitution': {
        if (p && p.off === null) p.off = at(e);
        if (e.relatedSlug || e.relatedName) { const q = ensure(e.side, e.relatedSlug, e.relatedName); if (q.on === null) q.on = at(e); }
        break;
      }
      default: break;
    }
  }
  for (const p of players.values()) {
    p.minutes = p.minutesOverride !== null && p.minutesOverride !== undefined ? p.minutesOverride : p.on === null ? 0 : Math.max(0, (p.off ?? L) - p.on);
    p.played = p.minutes > 0 || p.starter || p.on !== null;
  }
  const list = [...players.values()].sort((a, b) => (a.side === b.side ? 0 : a.side === 'home' ? -1 : 1) || (b.starter - a.starter) || ((a.number ?? 99) - (b.number ?? 99)));
  return { team: T, players: list, score: { home: T.home.goals, away: T.away.goals } };
}

/** Checks before publishing: errors stop it, warnings are shown. */
export function validate(match, lineups, events) {
  const errors = [], warnings = [], L = match.length || 90;
  const evs = events.filter(e => !e.deleted).sort(chrono);
  const lobiSide = match.lobiHome ? 'home' : 'away';
  const d = derive(match, lineups, events);
  if (d.score.home !== match.homeScore || d.score.away !== match.awayScore) errors.push(`The score (${match.homeScore}–${match.awayScore}) does not match the goal events (${d.score.home}–${d.score.away}). Open the match again to recount.`);
  for (const side of ['home', 'away']) {
    const n = lineups.filter(l => l.side === side && l.starter).length;
    const name = side === 'home' ? match.home : match.away;
    if (side === lobiSide && n !== 11) errors.push(`${name}: ${n} starters (there must be 11).`);
    if (side !== lobiSide && n && n !== 11) warnings.push(`${name}: ${n} starters entered (usually 11).`);
    if (side !== lobiSide && !n) warnings.push(`${name}: no line-up entered (their players will show without names).`);
  }
  const onPitch = { home: new Set(), away: new Set() }, used = { home: 0, away: 0 }, cameOn = new Set(), sentOff = new Set();
  for (const l of lineups) if (l.starter) onPitch[l.side].add(playerKey(l.side, l.slug, l.name));
  for (const e of evs) {
    const [lo, hi] = PERIODS[e.period];
    const label = `${EVENT_TYPES[e.type]} at ${e.minute}'${e.stoppage ? `+${e.stoppage}` : ''}`;
    if (e.period !== 'PEN' && (e.minute < lo || e.minute > hi)) errors.push(`${label}: the minute is outside the ${e.period === '1H' ? 'first half' : e.period === '2H' ? 'second half' : 'extra-time period'} (${lo}–${hi}).`);
    if (e.minute > L + (e.period === 'PEN' ? 0 : 0) && e.period !== 'PEN') errors.push(`${label}: after full time (${L} minutes).`);
    const k = e.slug || e.name ? playerKey(e.type === 'goal' && e.detail === 'own_goal' ? (e.side === 'home' ? 'away' : 'home') : e.side, e.slug, e.name) : null;
    if (k && sentOff.has(k)) errors.push(`${label}: ${e.name} was already sent off.`);
    if (e.type === 'goal' && e.side === lobiSide && !e.slug && e.detail !== 'own_goal') errors.push(`${label}: choose the Lobi Stars scorer.`);
    if (e.type === 'red_card' && k) { sentOff.add(k); onPitch[e.side].delete(k); }
    if (e.type === 'substitution') {
      used[e.side]++;
      const off = k, on = e.relatedSlug || e.relatedName ? playerKey(e.side, e.relatedSlug, e.relatedName) : null;
      if (!off || !on) { errors.push(`${label}: choose the player going off and the player coming on.`); continue; }
      if (lineups.some(l => l.side === e.side)) {
        if (!onPitch[e.side].has(off)) errors.push(`${label}: ${e.name} was not on the pitch.`);
        if (onPitch[e.side].has(on) || cameOn.has(on)) errors.push(`${label}: ${e.relatedName} was already on the pitch.`);
      }
      onPitch[e.side].delete(off); onPitch[e.side].add(on); cameOn.add(on);
    }
  }
  for (const side of ['home', 'away']) if (used[side] > 5) warnings.push(`${side === 'home' ? match.home : match.away}: ${used[side]} substitutions (the league allows 5).`);
  if (!match.clock || match.clock.period !== 'FT') warnings.push('Full time was not pressed on the live screen (fine if the match was entered afterwards).');
  if (!evs.length) warnings.push('No events recorded.');
  return { errors, warnings, ok: !errors.length };
}

/** One match with everything the staff screens need. */
export async function getMatch(db, id) {
  const m = await getMatchRow(db, id);
  if (!m) return null;
  const lineups = (await db.prepare(`SELECT * FROM sx_lineups WHERE match_id = ? ORDER BY side, is_starter DESC, sort`).bind(id).all()).results.map(lineupView);
  const allEvents = (await db.prepare(`SELECT * FROM sx_events WHERE match_id = ?`).bind(id).all()).results.map(eventView);
  const match = matchView(m);
  const events = allEvents.filter(e => !e.deleted).sort(chrono);
  return { match, lineups, events, deleted: allEvents.filter(e => e.deleted), derived: derive(match, lineups, events), check: validate(match, lineups, events) };
}

// ── Publishing ──
const TIMELINE = { goal: 'goal', yellow_card: 'yellow', red_card: 'red', substitution: 'sub' };
export async function publish(db, user, id, { request = null } = {}) {
  if (!user.canPublish) return { error: 'Only a senior statistician can publish. Ask a Super Admin to allow it on your account.' };
  const full = await getMatch(db, id);
  if (!full) return { error: 'Match not found.' };
  await recalc(db, id);
  const fresh = await getMatch(db, id);
  if (!fresh.check.ok) return { error: 'Fix the problems in the checklist first.', check: fresh.check };
  const { match, lineups, events, derived } = fresh;
  const at = nowIso(), by = byName(user);
  const snapshot = { match: { ...match, status: 'published', verifiedBy: by, verifiedAt: at, publishedAt: at, clock: undefined }, lineups, events, derived };
  await db.prepare(`UPDATE sx_matches SET status = 'published', verified_by = ?, verified_at = ?, published_at = ?, published_json = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
    .bind(by, at, at, JSON.stringify(snapshot), by, at, id).run();
  if (match.eventId) await feedWebsite(db, match, lineups, events, derived);
  await sxLog(db, statsActor(user), 'publish', { itemType: 'match', itemId: id, itemTitle: `${match.home} ${match.homeScore}–${match.awayScore} ${match.away}`, after: { score: derived.score, events: events.length, warnings: fresh.check.warnings }, request });
  return { ok: true };
}

/** For a fixture: the player stats behind /stats and the player pages, and the public match page's score, line-ups, timeline and team stats. */
async function feedWebsite(db, match, lineups, events, derived) {
  const lobiSide = match.lobiHome ? 'home' : 'away';
  const rows = derived.players.filter(p => p.side === lobiSide && p.slug && (p.played || p.goals || p.assists || p.yellow || p.red))
    .map(p => ({ player: p.slug, played: p.played ? 1 : 0, started: p.starter ? 1 : 0, goals: p.goals, assists: p.assists, yellow: Math.min(2, p.yellow), red: Math.min(1, p.red), minutes: Math.min(130, p.minutes) }));
  await savePlayerStats(db, match.eventId, rows);
  await ensureMatchCentre(db);
  const names = (side, starter) => lineups.filter(l => l.side === side && l.starter === starter).map(l => (l.number !== null && l.number !== undefined ? `${l.number}. ${l.name}` : l.name));
  const lu = { home: { starting: names('home', true), subs: names('home', false) }, away: { starting: names('away', true), subs: names('away', false) } };
  const timeline = events.filter(e => TIMELINE[e.type] && !(e.type === 'substitution' && !e.relatedName)).slice(0, 80).map(e => ({
    minute: `${e.minute}${e.stoppage ? `+${e.stoppage}` : ''}'`,
    type: e.type === 'goal' ? (e.detail === 'own_goal' ? 'own-goal' : e.detail === 'penalty' ? 'penalty' : 'goal') : TIMELINE[e.type],
    team: e.side, player: e.type === 'substitution' ? `${e.relatedName} on for ${e.name}` : e.name || '',
    detail: e.type === 'goal' && e.relatedName && e.detail !== 'own_goal' ? `Assist: ${e.relatedName}` : '',
  }));
  const T = derived.team;
  const stats = { shots: [T.home.shots, T.away.shots], shotsOnTarget: [T.home.shotsOnTarget, T.away.shotsOnTarget], corners: [T.home.corners, T.away.corners],
    fouls: [T.home.fouls, T.away.fouls], yellowCards: [T.home.yellow, T.away.yellow], redCards: [T.home.red, T.away.red] };
  if (match.possessionHome !== null && match.possessionHome !== undefined) stats.possession = [match.possessionHome, 100 - match.possessionHome];
  const lobiLu = lineups.filter(l => l.side === lobiSide && l.slug).map(l => ({ slug: l.slug, name: l.name, number: l.number, position: l.position, photo: null }));
  const squad = { starting: lobiLu.filter((_, i) => lineups.filter(l => l.side === lobiSide && l.slug)[i].starter), bench: lobiLu.filter((_, i) => !lineups.filter(l => l.side === lobiSide && l.slug)[i].starter) };
  const had = await db.prepare(`SELECT event_id, status, report FROM match_centre WHERE event_id = ?`).bind(match.eventId).first();
  const report = match.report || had?.report || '';
  if (had) {
    await db.prepare(`UPDATE match_centre SET status = CASE WHEN status IN ('postponed', 'cancelled') THEN status ELSE 'full-time' END, home_score = ?, away_score = ?, lineups_json = ?, timeline_json = ?, stats_json = ?, squad_json = ?, report = ?, updated_at = datetime('now') WHERE event_id = ?`)
      .bind(derived.score.home, derived.score.away, JSON.stringify(lu), JSON.stringify(timeline), JSON.stringify(stats), JSON.stringify(squad), report, match.eventId).run();
  } else {
    await db.prepare(`INSERT INTO match_centre (event_id, status, home_score, away_score, lineups_json, timeline_json, stats_json, squad_json, report) VALUES (?, 'full-time', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(match.eventId, derived.score.home, derived.score.away, JSON.stringify(lu), JSON.stringify(timeline), JSON.stringify(stats), JSON.stringify(squad), report).run();
  }
}

/** Opens a published match for corrections. The public pages keep showing the published version until it is published again. */
export async function reopen(db, user, id, { request = null } = {}) {
  if (!user.canPublish) return { error: 'Only a senior statistician can reopen a published match.' };
  const m = await getMatchRow(db, id);
  if (!m) return { error: 'Match not found.' };
  if (m.status !== 'published') return { ok: true };
  await db.prepare(`UPDATE sx_matches SET status = 'review', updated_by = ?, updated_at = ? WHERE id = ?`).bind(byName(user), nowIso(), id).run();
  await sxLog(db, statsActor(user), 'reopen', { itemType: 'match', itemId: id, itemTitle: titleOf(m), details: 'Reopened for corrections (the published version stays on the website until it is published again)', request });
  return { ok: true };
}

export async function setStatus(db, user, id, status, { request = null } = {}) {
  const m = await getMatchRow(db, id);
  if (!m) return { error: 'Match not found.' };
  if (!['draft', 'live', 'review'].includes(status)) return { error: 'Use Verify and Publish to publish.' };
  if (m.status === 'published') return { error: 'This match is published. Reopen it for corrections first.' };
  await db.prepare(`UPDATE sx_matches SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(status, byName(user), nowIso(), id).run();
  await sxLog(db, statsActor(user), 'status', { itemType: 'match', itemId: id, itemTitle: titleOf(m), before: { status: m.status }, after: { status }, request });
  return { ok: true };
}

/** Removes a match from the lists (kept, never deleted). Published matches must be reopened first. */
export async function removeMatch(db, user, id, { request = null } = {}) {
  const m = await getMatchRow(db, id);
  if (!m) return { error: 'Match not found.' };
  if (m.status === 'published') return { error: 'A published match cannot be removed. Reopen it first.' };
  await db.prepare(`UPDATE sx_matches SET is_deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?`).bind(byName(user), nowIso(), id).run();
  await sxLog(db, statsActor(user), 'remove_match', { itemType: 'match', itemId: id, itemTitle: titleOf(m), details: 'Removed from the lists (kept in the database)', request });
  return { ok: true };
}

// ── Season figures (published matches only) ──
/** The published snapshots of a season (or every season when season is ''). */
export async function publishedMatches(db, season = '') {
  await ensureStatsCentreSchema(db);
  const { results } = await db.prepare(`SELECT id, event_id, published_json FROM sx_matches WHERE status IN ('published', 'review') AND published_json IS NOT NULL AND is_deleted = 0${season ? ' AND season = ?' : ''} ORDER BY match_date ASC`)
    .bind(...(season ? [season] : [])).all();
  return results.map(r => ({ ...parse(r.published_json, null), id: r.id, eventId: r.event_id })).filter(x => x && x.match);
}

const resultOf = (m, lobiHome) => { const f = lobiHome ? m.homeScore : m.awayScore, a = lobiHome ? m.awayScore : m.homeScore; return { gf: f, ga: a, r: f > a ? 'W' : f < a ? 'L' : 'D' }; };

/** Player totals across matches (season or career), Lobi Stars players only. */
export function playerTotals(snapshots) {
  const by = new Map();
  for (const s of snapshots) {
    const lobiSide = s.match.lobiHome ? 'home' : 'away';
    const { ga } = resultOf(s.match, s.match.lobiHome);
    for (const p of s.derived.players) {
      if (p.side !== lobiSide || !p.slug) continue;
      const t = by.get(p.slug) || { slug: p.slug, name: p.name, apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, yellow: 0, red: 0, saves: 0, cleanSheets: 0, motm: 0, matches: [] };
      if (p.played) { t.apps++; if (p.starter) t.starts++; }
      t.minutes += p.minutes; t.goals += p.goals; t.assists += p.assists; t.shots += p.shots; t.shotsOnTarget += p.shotsOnTarget; t.yellow += p.yellow; t.red += p.red; t.saves += p.saves;
      if (p.motm) t.motm++;
      if (ga === 0 && p.played && /^GK/i.test(p.position || '') && p.minutes >= 60) t.cleanSheets++;
      if (p.played || p.goals || p.assists) t.matches.push({ id: s.id, date: s.match.date, opponent: lobiSide === 'home' ? s.match.away : s.match.home, home: lobiSide === 'home',
        score: `${s.match.homeScore}–${s.match.awayScore}`, minutes: p.minutes, goals: p.goals, assists: p.assists, yellow: p.yellow, red: p.red, started: p.starter });
      by.set(p.slug, t);
    }
  }
  return [...by.values()].sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.minutes - a.minutes);
}

/** Team figures across matches: record, goals, form, home/away, head-to-head, discipline. */
export function teamTotals(snapshots) {
  const rec = () => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cleanSheets: 0 });
  const all = rec(), home = rec(), away = rec(), h2h = new Map();
  let yellow = 0, red = 0, shots = 0, shotsOnTarget = 0, corners = 0;
  const form = [];
  for (const s of snapshots) {
    const lobiHome = s.match.lobiHome, { gf, ga, r } = resultOf(s.match, lobiHome);
    const opp = lobiHome ? s.match.away : s.match.home;
    for (const x of [all, lobiHome ? home : away]) { x.p++; x[r === 'W' ? 'w' : r === 'D' ? 'd' : 'l']++; x.gf += gf; x.ga += ga; if (!ga) x.cleanSheets++; }
    const h = h2h.get(opp) || { opponent: opp, ...rec() };
    h.p++; h[r === 'W' ? 'w' : r === 'D' ? 'd' : 'l']++; h.gf += gf; h.ga += ga; h2h.set(opp, h);
    const t = s.derived.team[lobiHome ? 'home' : 'away'];
    yellow += t.yellow; red += t.red; shots += t.shots; shotsOnTarget += t.shotsOnTarget; corners += t.corners;
    form.push({ r, id: s.id, opponent: opp, score: `${s.match.homeScore}–${s.match.awayScore}`, date: s.match.date });
  }
  return { all, home, away, form: form.slice(-5).reverse(), recent: form.slice(-10).reverse(), h2h: [...h2h.values()].sort((a, b) => b.p - a.p || a.opponent.localeCompare(b.opponent)),
    discipline: { yellow, red }, attack: { shots, shotsOnTarget, corners } };
}

export async function dashboard(db, season) {
  const snaps = await publishedMatches(db, season);
  const players = playerTotals(snaps), team = teamTotals(snaps);
  const top = (k) => players.filter(p => p[k] > 0).sort((a, b) => b[k] - a[k])[0] || null;
  const open = (await db.prepare(`SELECT * FROM sx_matches WHERE is_deleted = 0 AND status <> 'published' ORDER BY match_date DESC LIMIT 20`).all()).results.map(matchView);
  return { season, team, topScorer: top('goals'), topAssister: top('assists'), recent: team.recent, open };
}

// ── Exports ──
const csvCell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export const toCsv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export async function eventsCsv(db, { matchId = '', season = '' } = {}) {
  await ensureStatsCentreSchema(db);
  const where = ['e.is_deleted = 0', 'm.is_deleted = 0'], args = [];
  if (matchId) { where.push('m.id = ?'); args.push(matchId); }
  if (season) { where.push('m.season = ?'); args.push(season); }
  const { results } = await db.prepare(`SELECT m.season, m.match_date, m.home_team, m.away_team, m.status, e.* FROM sx_events e JOIN sx_matches m ON m.id = e.match_id WHERE ${where.join(' AND ')} ORDER BY m.match_date, e.period, e.minute, e.stoppage_minute, e.created_at`).bind(...args).all();
  return toCsv([['Season', 'Date', 'Home', 'Away', 'Match status', 'Period', 'Minute', 'Stoppage', 'Team', 'Event', 'Player', 'Assist / player on', 'Outcome', 'Body part', 'Type', 'Score at the time', 'Notes', 'Entered by', 'Entered at', 'Changed by', 'Changed at'],
    ...results.map(r => [r.season, String(r.match_date).slice(0, 10), r.home_team, r.away_team, r.status, r.period, r.minute, r.stoppage_minute ?? '', r.side === 'home' ? r.home_team : r.away_team,
      EVENT_TYPES[r.event_type] || r.event_type, r.player_name || '', r.related_name || '', r.outcome || '', r.body_part || '', r.detail_type || '', `${r.score_home_at_time ?? ''}–${r.score_away_at_time ?? ''}`,
      r.notes || '', r.created_by || '', r.created_at, r.updated_by || '', r.updated_at || ''])]);
}
export async function matchesCsv(db, { season = '' } = {}) {
  const list = await listMatches(db, { season });
  return toCsv([['Season', 'Date', 'Competition', 'Matchday', 'Home', 'Away', 'Score', 'Half-time', 'Venue', 'Attendance', 'Referee', 'Status', 'Verified by', 'Published at'],
    ...list.map(m => [m.season, String(m.date).slice(0, 10), m.competition, m.matchday || '', m.home, m.away, `${m.homeScore}–${m.awayScore}`, m.htHome === null ? '' : `${m.htHome}–${m.htAway}`,
      m.venue || '', m.attendance ?? '', m.referee || '', m.status, m.verifiedBy || '', m.publishedAt || ''])]);
}

// ── Settings ──
export async function settingsView(db) {
  const s = await sxSettings(db);
  const list = (k, d) => { try { const v = JSON.parse(s[k] || 'null'); return Array.isArray(v) && v.length ? v : d; } catch { return d; } };
  return { competitions: list('competitions', DEFAULT_COMPETITIONS), labels: { ...EVENT_TYPES, ...(() => { try { return JSON.parse(s.labels || '{}'); } catch { return {}; } })() } };
}

// ── Public (published only) ──
/** The public match stats page data, by the fixture's slug or the match id. */
export async function publicMatch(db, key) {
  await ensureStatsCentreSchema(db);
  const { results } = await db.prepare(`SELECT x.id, x.published_json, e.id AS eid, e.home_team, e.away_team, e.event_date FROM sx_matches x LEFT JOIN events e ON e.id = x.event_id
    WHERE x.published_json IS NOT NULL AND x.is_deleted = 0 AND x.status IN ('published', 'review')`).all();
  for (const r of results) {
    const slug = r.eid ? matchSlug({ id: r.eid, home_team: r.home_team, away_team: r.away_team, event_date: r.event_date }) : r.id;
    if (slug === String(key).toLowerCase() || r.id === key) return { ...parse(r.published_json, null), id: r.id, slug, matchUrl: r.eid ? `/matches/${slug}/` : null };
  }
  return null;
}
export async function publicSlugs(db, limit = 40) {
  await ensureStatsCentreSchema(db);
  const { results } = await db.prepare(`SELECT x.id, x.match_date, x.home_team AS h, x.away_team AS a, x.home_score AS hs, x.away_score AS as_, x.published_json, e.id AS eid, e.home_team, e.away_team, e.event_date FROM sx_matches x LEFT JOIN events e ON e.id = x.event_id
    WHERE x.published_json IS NOT NULL AND x.is_deleted = 0 AND x.status IN ('published', 'review') ORDER BY x.match_date DESC LIMIT ?`).bind(limit).all();
  return results.map(r => { const m = parse(r.published_json, {}).match || {}; return { id: r.id, slug: r.eid ? matchSlug({ id: r.eid, home_team: r.home_team, away_team: r.away_team, event_date: r.event_date }) : r.id,
    date: m.date, home: m.home, away: m.away, homeScore: m.homeScore, awayScore: m.awayScore, competition: m.competition }; });
}

/** A player's published Statistics Center matches (for the player pages), newest first, with the public match-stats link. */
export async function playerMatchLog(db, slugs, season) {
  const snaps = await publishedMatches(db, season);
  if (!snaps.length) return [];
  const links = new Map((await publicSlugs(db, 500)).map(r => [r.id, r.slug]));
  const want = new Set(slugs);
  return playerTotals(snaps).filter(p => want.has(p.slug)).flatMap(p => p.matches)
    .map(m => ({ date: m.date, opponent: m.opponent, home: m.home, score: m.score, minutes: m.minutes, goals: m.goals, assists: m.assists, yellow: m.yellow, red: m.red, started: m.started, url: links.has(m.id) ? `/stats/matches/${links.get(m.id)}/` : null }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * The line-up the Media Centre's Matchday Desk prepared for the same fixture (newest first: a published one, then a
 * draft), or the line-up already on the match page, so the Statistics Center can fill its picker without retyping.
 * Read only: nothing is written to the Media Centre. Returns null when there is none.
 */
export async function mediaLineup(db, matchId) {
  const m = await getMatchRow(db, matchId);
  if (!m || !m.event_id) return null;
  const pick = (list, by) => (Array.isArray(list) ? list : []).map(p => ({ slug: p?.slug || null, name: p?.name || '', number: p?.number ?? null, position: p?.position || '' })).filter(p => p.slug || p.name);
  try {
    const r = await db.prepare(`SELECT status, data_json, live_json, updated_at, updated_by_name FROM mc_items WHERE kind = 'lineup' AND ref = ? AND status NOT IN ('rejected')
      ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'submitted' THEN 2 ELSE 3 END, updated_at DESC LIMIT 1`).bind(m.event_id).first();
    if (r) {
      const v = parse(r.status === 'published' && r.live_json ? r.live_json : r.data_json, {});
      const out = { source: 'media', status: r.status, by: r.updated_by_name || '', at: r.updated_at, formation: v.formation || '', starting: pick(v.starting), subs: pick(v.subs) };
      if (out.starting.length || out.subs.length) return out;
    }
  } catch { /* no Media Centre tables yet */ }
  try {
    const c = await db.prepare(`SELECT squad_json, updated_at FROM match_centre WHERE event_id = ?`).bind(m.event_id).first();
    const sq = parse(c?.squad_json, null);
    if (sq && (sq.starting?.length || sq.bench?.length)) return { source: 'match', status: 'published', by: '', at: c.updated_at, formation: '', starting: pick(sq.starting), subs: pick(sq.bench) };
  } catch { /* none */ }
  return null;
}

// ── Opponent squad registry (Add-on 2) ──
export const teamKey = name => ` ${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `.replace(/ (fc|f c|football club) /g, ' ').replace(/\s+/g, ' ').trim();
/** Saves (or refreshes) an opponent player in the club's registry; returns its id. One row per club + name + number. */
async function upsertOpponentPlayer(db, user, teamName, r, matchId) {
  const tk = teamKey(teamName), nk = String(r.name).toLowerCase().trim(), at = nowIso();
  const had = await db.prepare(`SELECT id FROM sx_opponent_players WHERE team_key = ? AND name_key = ? AND IFNULL(shirt_number, -1) = IFNULL(?, -1) AND is_deleted = 0`).bind(tk, nk, r.number).first();
  if (had) {
    await db.prepare(`UPDATE sx_opponent_players SET last_seen_match_id = ?, usual_position = COALESCE(?, usual_position), is_active = 1, updated_by = ?, updated_at = ? WHERE id = ?`).bind(matchId, r.position || null, byName(user), at, had.id).run();
    return had.id;
  }
  const id = newId('sxo');
  await db.prepare(`INSERT INTO sx_opponent_players (id, team_key, team_name, name, name_key, shirt_number, usual_position, last_seen_match_id, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, tk, teamName, r.name, nk, r.number, r.position || null, matchId, byName(user), at, byName(user), at).run();
  return id;
}
/** The saved players of a club (most recently seen first). */
export async function opponentPlayers(db, teamName) {
  await ensureStatsCentreSchema(db);
  const { results } = await db.prepare(`SELECT p.id, p.name, p.shirt_number, p.usual_position, p.last_seen_match_id, m.match_date FROM sx_opponent_players p LEFT JOIN sx_matches m ON m.id = p.last_seen_match_id
    WHERE p.team_key = ? AND p.is_deleted = 0 AND p.is_active = 1 ORDER BY m.match_date DESC, p.shirt_number LIMIT 80`).bind(teamKey(teamName)).all();
  return results.map(r => ({ id: r.id, name: r.name, number: r.shirt_number, position: r.usual_position || '', lastSeen: r.match_date || null }));
}
/** The opponent line-up from our last match against the same club (to copy and edit). */
export async function lastOpponentLineup(db, matchId) {
  const m = await getMatchRow(db, matchId);
  if (!m) return null;
  const opp = m.is_lobi_home ? m.away_team : m.home_team, tk = teamKey(opp);
  const { results } = await db.prepare(`SELECT id, home_team, away_team, is_lobi_home, match_date FROM sx_matches WHERE is_deleted = 0 AND id <> ? ORDER BY match_date DESC LIMIT 200`).bind(m.id).all();
  for (const x of results) {
    if (teamKey(x.is_lobi_home ? x.away_team : x.home_team) !== tk) continue;
    const side = x.is_lobi_home ? 'away' : 'home';
    const lu = (await db.prepare(`SELECT player_name, shirt_number, position, is_starter FROM sx_lineups WHERE match_id = ? AND side = ? ORDER BY is_starter DESC, sort`).bind(x.id, side).all()).results;
    if (lu.length) return { from: { id: x.id, date: x.match_date }, players: lu.map(l => ({ name: l.player_name, number: l.shirt_number, position: l.position || '', starter: !!l.is_starter })) };
  }
  return null;
}

// ── Recycle bin (Add-on 2): removed matches, events and analyses, kept and restorable ──
export async function recycleBin(db) {
  await ensureStatsCentreSchema(db);
  const matches = (await db.prepare(`SELECT id, home_team, away_team, match_date, updated_by, updated_at FROM sx_matches WHERE is_deleted = 1 ORDER BY updated_at DESC LIMIT 100`).all()).results
    .map(r => ({ type: 'match', id: r.id, name: `${r.home_team} v ${r.away_team} (${String(r.match_date).slice(0, 10)})`, by: r.updated_by, at: r.updated_at }));
  const events = (await db.prepare(`SELECT e.id, e.event_type, e.minute, e.player_name, e.updated_by, e.updated_at, m.home_team, m.away_team FROM sx_events e JOIN sx_matches m ON m.id = e.match_id WHERE e.is_deleted = 1 AND m.is_deleted = 0 ORDER BY e.updated_at DESC LIMIT 200`).all()).results
    .map(r => ({ type: 'event', id: r.id, name: `${EVENT_TYPES[r.event_type] || r.event_type} ${r.minute}'${r.player_name ? ` · ${r.player_name}` : ''} (${r.home_team} v ${r.away_team})`, by: r.updated_by, at: r.updated_at }));
  let analyses = [];
  try {
    analyses = (await db.prepare(`SELECT a.id, a.updated_by, a.updated_at, m.home_team, m.away_team FROM sx_bst_analyses a JOIN sx_matches m ON m.id = a.match_id WHERE a.is_deleted = 1 ORDER BY a.updated_at DESC LIMIT 100`).all()).results
      .map(r => ({ type: 'analysis', id: r.id, name: `Analysis: ${r.home_team} v ${r.away_team}`, by: r.updated_by, at: r.updated_at }));
  } catch { /* no analyses yet */ }
  const left = at => Math.max(0, 30 - Math.floor((Date.now() - Date.parse(at || 0)) / 864e5));
  return [...matches, ...analyses, ...events].map(x => ({ ...x, daysLeft: left(x.at) }));
}
export async function restoreItem(db, user, { type, id }, { request = null } = {}) {
  await ensureStatsCentreSchema(db);
  const table = { match: 'sx_matches', event: 'sx_events', analysis: 'sx_bst_analyses' }[type];
  if (!table) return { error: 'Unknown item.' };
  if (type === 'analysis') {
    const a = await db.prepare(`SELECT match_id FROM sx_bst_analyses WHERE id = ?`).bind(String(id)).first();
    if (a && await db.prepare(`SELECT id FROM sx_bst_analyses WHERE match_id = ? AND is_deleted = 0`).bind(a.match_id).first()) return { error: 'That match already has another analysis.' };
  }
  const r = await db.prepare(`UPDATE ${table} SET is_deleted = 0, updated_by = ?, updated_at = ? WHERE id = ? AND is_deleted = 1`).bind(byName(user), nowIso(), String(id)).run();
  if (!r.meta?.changes) return { error: 'Not found in the recycle bin.' };
  if (type === 'event') { const e = await db.prepare(`SELECT match_id FROM sx_events WHERE id = ?`).bind(String(id)).first(); if (e) await recalc(db, e.match_id, user); }
  await sxLog(db, statsActor(user), 'restore', { itemType: type, itemId: id, details: 'Restored from the recycle bin', request });
  return { ok: true };
}
export async function removeAnalysis(db, user, id, { request = null } = {}) {
  const a = await db.prepare(`SELECT id, status FROM sx_bst_analyses WHERE id = ? AND is_deleted = 0`).bind(String(id)).first();
  if (!a) return { error: 'Analysis not found.' };
  if (a.status === 'final' && !user.admin) return { error: 'A Final analysis can only be removed by a Super Admin.' };
  await db.prepare(`UPDATE sx_bst_analyses SET is_deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?`).bind(byName(user), nowIso(), a.id).run();
  await sxLog(db, statsActor(user), 'remove_analysis', { itemType: 'bst', itemId: a.id, details: 'Moved to the recycle bin', request });
  return { ok: true };
}

/** Everything recorded for a season, for safekeeping (staff only): matches, line-ups, events and analyses. */
export async function seasonExport(db, season) {
  await ensureStatsCentreSchema(db);
  const matches = (await db.prepare(`SELECT * FROM sx_matches WHERE season = ? AND is_deleted = 0 ORDER BY match_date`).bind(season).all()).results.map(r => { const { published_json, clock_json, ...rest } = r; return rest; });
  const ids = matches.map(m => m.id);
  const pick = async (sql) => { const out = []; for (let i = 0; i < ids.length; i += 50) { const c = ids.slice(i, i + 50); out.push(...(await db.prepare(sql.replace('(?)', `(${c.map(() => '?').join(',')})`)).bind(...c).all()).results); } return out; };
  const data = { season, exportedAt: nowIso(), matches, lineups: await pick(`SELECT * FROM sx_lineups WHERE match_id IN (?)`), events: await pick(`SELECT * FROM sx_events WHERE match_id IN (?) AND is_deleted = 0`) };
  try {
    data.analyses = await pick(`SELECT * FROM sx_bst_analyses WHERE match_id IN (?) AND is_deleted = 0`);
    const aIds = data.analyses.map(a => a.id); data.analysisCells = [];
    for (let i = 0; i < aIds.length; i += 50) { const c = aIds.slice(i, i + 50); data.analysisCells.push(...(await db.prepare(`SELECT * FROM sx_bst_cells WHERE analysis_id IN (${c.map(() => '?').join(',')})`).bind(...c).all()).results); }
  } catch { data.analyses = []; data.analysisCells = []; }
  return data;
}
