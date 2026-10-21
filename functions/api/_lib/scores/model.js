// Multi-source score verification, Phase 1: the data model.
// Results for every NNL conference match (not only Lobi Stars) arrive as SCORE
// REPORTS from several approved sources. Reports are only ever ADDED, never
// changed. A later phase compares them (the two-source rule) and only
// confirmed results reach the table. The competition, teams, venues and
// fixtures are the existing league_* tables (leagueDb.js).
//
// LEGAL RULE: nothing here fetches Soccerway, Sofascore, Flashscore or any site
// whose terms forbid automated access. Automatic sources run only through an
// adapter, and an adapter that needs a licence can't run until "licence /
// permission confirmed" is ON with a written note (assertAdapterMayRun /
// assertAllowedFetch).
import { ensureLeagueSchema } from '../leagueDb.js';

export const REPORT_STATUSES = ['SCHEDULED', 'LIVE', 'HALF_TIME', 'FULL_TIME', 'POSTPONED', 'ABANDONED', 'AWARDED', 'CANCELLED'];
/** Report status → the league fixture status used by the table. */
export const TO_LEAGUE_STATUS = { SCHEDULED: 'scheduled', LIVE: 'live', HALF_TIME: 'half_time', FULL_TIME: 'full_time', POSTPONED: 'postponed', ABANDONED: 'abandoned', AWARDED: 'awarded', CANCELLED: 'cancelled' };
/** Statuses that carry a score. */
export const SCORED_STATUSES = new Set(['LIVE', 'HALF_TIME', 'FULL_TIME', 'AWARDED', 'ABANDONED']);

/**
 * The sources. automatic: fetched by the website itself (needs an adapter);
 * needsLicence: may only run when "licence / permission confirmed" is ON with a note.
 */
export const SOURCE_TYPES = {
  STAFF_MANUAL: { label: 'Staff entry', description: 'Scores entered by authorised staff (Website & Data Officer, Super Admins).', priority: 50, enabled: 1, automatic: false, needsLicence: false },
  CLUB_NETWORK: { label: 'Club network', description: 'Other clubs\' media officers: secure form (own link/PIN), the scores email address and, later, WhatsApp. Only approved submitters count.', priority: 40, enabled: 1, automatic: false, needsLicence: false },
  COMMENTARY_ASSIST: { label: 'Commentary Assist', description: 'Scores sent by the commentary partner through the signed Commentary Assist webhook (our match and other games).', priority: 45, enabled: 1, automatic: false, needsLicence: false },
  LIVE_MATCH_CONTROL: { label: 'Live Match Control', description: 'Lobi Stars\' own matches: the score and Kick-off / Full-time entered by staff in Live Match Control.', priority: 55, enabled: 1, automatic: false, needsLicence: false },
  LICENSED_API: { label: 'Licensed data API', description: 'A paid football data API (e.g. API-Football or Sportmonks) used under its licence. Needs the API key (LICENSED_API_KEY). Off until set up.', priority: 30, enabled: 0, automatic: true, needsLicence: true },
  OFFICIAL_NNL: { label: 'Official NNL', description: 'Results taken by staff from official NNL announcements, marked as official. Always wins over other sources.', priority: 100, enabled: 1, automatic: false, needsLicence: false },
  FUTURE_LICENSED: { label: 'Other licensed source (placeholder)', description: 'For a website or feed we get WRITTEN permission or a licence to use. Can\'t run until the licence is confirmed and noted.', priority: 20, enabled: 0, automatic: true, needsLicence: true },
};

// Sites whose terms forbid automated access: never fetched unless a licence is confirmed for that adapter.
export const PROHIBITED_HOSTS = ['soccerway.com', 'sofascore.com', 'flashscore.com', 'flashscore.com.ng', 'livescore.com', 'fotmob.com', 'besoccer.com', 'transfermarkt.com', 'espn.com'];

let ready = false;
export async function ensureScoreSchema(env) {
  const db = env.DB;
  await ensureLeagueSchema(env);
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS score_sources (type TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0, licence_confirmed INTEGER NOT NULL DEFAULT 0, licence_note TEXT, config_json TEXT,
      last_received_at TEXT, last_error TEXT, last_error_at TEXT, updated_at TEXT, updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS score_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER, source_type TEXT NOT NULL, source_identity TEXT NOT NULL,
      source_label TEXT, home_goals INTEGER, away_goals INTEGER, status TEXT NOT NULL, minute TEXT, received_at TEXT NOT NULL, raw_json TEXT, confidence REAL,
      confidence_notes TEXT, needs_review INTEGER NOT NULL DEFAULT 0, review_reason TEXT, home_name TEXT, away_name TEXT, created_by TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_score_reports_fixture ON score_reports (fixture_id, received_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_score_reports_review ON score_reports (needs_review)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS score_unmatched_names (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, normalized TEXT NOT NULL UNIQUE,
      source_type TEXT, source_identity TEXT, sample TEXT, times_seen INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', team_id INTEGER, resolved_by TEXT, resolved_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS score_submitters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, club TEXT, team_id INTEGER, phone TEXT, email TEXT,
      token_hash TEXT UNIQUE, pin_hash TEXT, active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL, revoked_by TEXT, revoked_at TEXT, note TEXT)`),
  ]);
  const now = new Date().toISOString();
  await db.batch(Object.entries(SOURCE_TYPES).map(([type, s]) => db.prepare(`INSERT OR IGNORE INTO score_sources (type, label, description, enabled, priority, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, 'system')`).bind(type, s.label, s.description, s.enabled, s.priority, now)));
  ready = true;
}

// ── Team names ──
/** "Kada Warriors F.C." → "kada warriors": lower case, no "FC", no punctuation or extra spaces. */
export function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(f\s*c|football club|fc)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Every name a team is known by (name, short name, code, aliases), normalised. */
export function namesOf(team) {
  let aliases = [];
  try { aliases = Array.isArray(team.aliases) ? team.aliases : JSON.parse(team.aliases || '[]'); } catch { aliases = []; }
  return [...new Set([team.name, team.short_name, team.code, ...aliases].map(normName).filter(Boolean))];
}
/** The team a name refers to, or null (pure: teams are passed in). */
export function findTeamByName(teams, name) {
  const k = normName(name);
  if (!k) return null;
  const hits = teams.filter(t => namesOf(t).includes(k));
  return hits.length === 1 ? hits[0] : null; // a name that fits two teams is not a match
}
export async function loadTeams(env, competitionId = null) {
  const db = env.DB;
  const sql = competitionId
    ? `SELECT t.* FROM league_teams t JOIN league_competition_teams ct ON ct.team_id = t.id WHERE ct.competition_id = ?`
    : `SELECT * FROM league_teams`;
  return (await (competitionId ? db.prepare(sql).bind(competitionId) : db.prepare(sql)).all()).results;
}
/** Matches a name; an unknown one goes on the "Unmatched names" list (counted, with an example). */
export async function matchTeamName(env, name, { sourceType = null, identity = null, sample = null, teams = null } = {}) {
  const list = teams || await loadTeams(env);
  const team = findTeamByName(list, name);
  if (team) return team;
  const k = normName(name);
  if (!k) return null;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO score_unmatched_names (name, normalized, source_type, source_identity, sample, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (normalized) DO UPDATE SET times_seen = times_seen + 1, last_seen = excluded.last_seen,
      status = CASE WHEN score_unmatched_names.status = 'linked' THEN 'linked' ELSE 'open' END`)
    .bind(String(name).trim().slice(0, 80), k, sourceType, identity, sample ? String(sample).slice(0, 300) : null, now, now).run();
  return null;
}
/** Staff link an unmatched name to a team once: saved as a new alias of that team. */
export async function linkUnmatched(env, id, teamId, staff) {
  const db = env.DB;
  const u = await db.prepare(`SELECT * FROM score_unmatched_names WHERE id = ?`).bind(Number(id)).first();
  if (!u) return { error: 'Name not found.' };
  const team = await db.prepare(`SELECT * FROM league_teams WHERE id = ?`).bind(Number(teamId)).first();
  if (!team) return { error: 'Choose a team.' };
  let aliases = []; try { aliases = JSON.parse(team.aliases || '[]'); } catch { aliases = []; }
  if (!aliases.map(normName).includes(u.normalized)) aliases.push(u.name);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE league_teams SET aliases = ? WHERE id = ?`).bind(JSON.stringify(aliases), team.id),
    db.prepare(`UPDATE score_unmatched_names SET status = 'linked', team_id = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`).bind(team.id, staff?.name || 'staff', now, u.id),
  ]);
  return { ok: true, team: { id: team.id, name: team.name }, alias: u.name };
}
export async function dismissUnmatched(env, id, staff) {
  const r = await env.DB.prepare(`UPDATE score_unmatched_names SET status = 'dismissed', resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'`)
    .bind(staff?.name || 'staff', new Date().toISOString(), Number(id)).run();
  return r.meta?.changes ? { ok: true } : { error: 'Name not found.' };
}

// ── Sources and adapters ──
export async function listSources(env) {
  await ensureScoreSchema(env);
  const { results } = await env.DB.prepare(`SELECT * FROM score_sources ORDER BY priority DESC`).all();
  return results.map(r => ({ ...r, enabled: !!r.enabled, licence_confirmed: !!r.licence_confirmed, automatic: !!SOURCE_TYPES[r.type]?.automatic, needsLicence: !!SOURCE_TYPES[r.type]?.needsLicence }));
}
export const getSource = (env, type) => env.DB.prepare(`SELECT * FROM score_sources WHERE type = ?`).bind(type).first();

/**
 * An automatic source (adapter) may only run when it is switched on and, if it
 * needs a licence, "licence / permission confirmed" is ON with a note.
 * Throws otherwise: nothing is fetched.
 */
export function assertAdapterMayRun(source) {
  const def = SOURCE_TYPES[source?.type];
  if (!def) throw new Error('Unknown source.');
  if (!source.enabled) throw new Error(`${def.label} is switched off.`);
  if (def.needsLicence && !(source.licence_confirmed && String(source.licence_note || '').trim().length >= 10)) {
    throw new Error(`${def.label} can't run: "licence / permission confirmed" must be ON with a note of the licence or written permission.`);
  }
  return true;
}
/** Every automatic fetch goes through here: prohibited sites are refused unless this source's licence is confirmed. */
export function assertAllowedFetch(source, url) {
  assertAdapterMayRun(source);
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { throw new Error('Not a valid address.'); }
  if (new URL(url).protocol !== 'https:') throw new Error('Only https:// addresses can be fetched.');
  const banned = PROHIBITED_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
  if (banned && !source.licence_confirmed) throw new Error(`${host} does not allow automated access. It can only be used with written permission or a licence (confirmed and noted on this source).`);
  return true;
}

// ── Reports ──
/**
 * Who a report counts as, for the two-source rule. Different source types are
 * independent; within a type, different identities are (two club submitters
 * count twice); the same person entering twice counts once; the licensed API,
 * Commentary Assist and official NNL count once however often they report.
 */
export function independenceKey(report) {
  const t = report.source_type;
  if (t === 'LICENSED_API' || t === 'COMMENTARY_ASSIST' || t === 'OFFICIAL_NNL' || t === 'LIVE_MATCH_CONTROL') return t;
  return `${t}:${String(report.source_identity || '').toLowerCase()}`;
}
/** The latest report of each independent source for one match (newest first). */
export function latestPerSource(reports) {
  const seen = new Map();
  for (const r of [...reports].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)) || b.id - a.id)) {
    const k = independenceKey(r);
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()];
}

const int = v => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 99 ? Number(v) : NaN);
/**
 * Stores one report (never changes an existing one). Either fixtureId, or the
 * two team names (matched through aliases to a fixture within ±2 days of the
 * report). Unclear reports are kept but marked "needs review" (not counted).
 * Returns { ok, id, fixtureId, needsReview, reason }.
 */
export async function addReport(env, r) {
  await ensureScoreSchema(env);
  const db = env.DB;
  if (!SOURCE_TYPES[r.sourceType]) return { error: 'Unknown source.' };
  const status = String(r.status || '').toUpperCase();
  if (!REPORT_STATUSES.includes(status)) return { error: 'Unknown status.' };
  const hg = int(r.homeGoals), ag = int(r.awayGoals);
  if (Number.isNaN(hg) || Number.isNaN(ag)) return { error: 'Goals must be whole numbers from 0 to 99.' };
  if (SCORED_STATUSES.has(status) && status !== 'ABANDONED' && (hg === null || ag === null)) return { error: 'This status needs both scores.' };
  const identity = String(r.identity || '').trim().slice(0, 120);
  if (!identity) return { error: 'Missing source identity.' };
  const receivedAt = r.receivedAt || new Date().toISOString();
  let fixtureId = r.fixtureId ? Number(r.fixtureId) : null, needsReview = 0, reason = r.reviewReason || null;
  if (fixtureId) {
    if (!(await db.prepare(`SELECT id FROM league_fixtures WHERE id = ?`).bind(fixtureId).first())) return { error: 'Match not found.' };
  } else {
    const teams = await loadTeams(env);
    const opts = { sourceType: r.sourceType, identity, sample: r.raw ? (typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw)) : null, teams };
    const home = await matchTeamName(env, r.homeName, opts), away = await matchTeamName(env, r.awayName, opts);
    if (!home || !away) { needsReview = 1; reason = `Team name not recognised: ${[!home && r.homeName, !away && r.awayName].filter(Boolean).join(', ')}`; }
    else {
      const t = Date.parse(receivedAt);
      const f = await db.prepare(`SELECT id FROM league_fixtures WHERE home_team_id = ? AND away_team_id = ? AND kickoff_at BETWEEN ? AND ? ORDER BY kickoff_at LIMIT 1`)
        .bind(home.id, away.id, new Date(t - 2 * 864e5).toISOString(), new Date(t + 2 * 864e5).toISOString()).first();
      if (f) fixtureId = f.id; else { needsReview = 1; reason = `No ${home.short_name || home.name} v ${away.short_name || away.name} fixture around this date`; }
    }
  }
  if (r.needsReview) needsReview = 1;
  const res = await db.prepare(`INSERT INTO score_reports (fixture_id, source_type, source_identity, source_label, home_goals, away_goals, status, minute, received_at, raw_json,
      confidence, confidence_notes, needs_review, review_reason, home_name, away_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(fixtureId, r.sourceType, identity, r.label ? String(r.label).slice(0, 120) : null, hg, ag, status, r.minute ? String(r.minute).slice(0, 8) : null, receivedAt,
      r.raw === undefined || r.raw === null ? null : (typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw)).slice(0, 8000),
      typeof r.confidence === 'number' ? r.confidence : null, r.confidenceNotes ? String(r.confidenceNotes).slice(0, 500) : null, needsReview, reason,
      r.homeName ? String(r.homeName).slice(0, 80) : null, r.awayName ? String(r.awayName).slice(0, 80) : null, r.createdBy || null).first();
  await db.prepare(`UPDATE score_sources SET last_received_at = ? WHERE type = ?`).bind(receivedAt, r.sourceType).run();
  return { ok: true, id: res.id, fixtureId, needsReview: !!needsReview, reason };
}
export async function reportsFor(env, fixtureId) {
  await ensureScoreSchema(env);
  return (await env.DB.prepare(`SELECT * FROM score_reports WHERE fixture_id = ? ORDER BY received_at DESC, id DESC`).bind(Number(fixtureId)).all()).results;
}
