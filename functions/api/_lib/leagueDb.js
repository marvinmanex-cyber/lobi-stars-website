// The league in the database: tables (made on first use, like the rest of the
// site; the same SQL is in migrations/0002_league.sql), the first-use seed of
// the official NNL Conference D season, loading for pages and APIs, the audit
// log, and the link with Matches & Fixtures (events):
//  - Every league fixture involving Lobi Stars has a linked events row, so
//    tickets, match pages, commentary, Predict & Win and alerts keep working.
//    League › Fixtures is where its teams, date, time and venue are changed;
//    syncEvent() copies them to the events row.
//  - For linked fixtures the SCORE lives in match_centre (Live Match Control
//    and League › Results both write it), and loadLeague() reads it from there.
import { COMPETITION, TEAMS, FIXTURES } from './league/seed.js';
import { computeStandings, isCounted } from './league/standings.js';
import { ensureTable } from './matchCentre.js';
import { randomId } from './crypto.js';

export const LEAGUE_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS league_competitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    season TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'league',
    has_table INTEGER NOT NULL DEFAULT 1,
    points_win INTEGER NOT NULL DEFAULT 3,
    points_draw INTEGER NOT NULL DEFAULT 1,
    points_loss INTEGER NOT NULL DEFAULT 0,
    tiebreak_order TEXT NOT NULL DEFAULT '["points","goal_difference","goals_for","wins","h2h_points","h2h_goal_difference","h2h_goals_for"]',
    zones TEXT NOT NULL DEFAULT '[]',
    awarded_home_goals INTEGER NOT NULL DEFAULT 3,
    awarded_away_goals INTEGER NOT NULL DEFAULT 0,
    include_live INTEGER NOT NULL DEFAULT 0,
    start_date TEXT, end_date TEXT,
    break_start TEXT, break_end TEXT, break_label TEXT,
    is_current INTEGER NOT NULL DEFAULT 0,
    rules_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS league_venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    city TEXT)`,
  `CREATE TABLE IF NOT EXISTS league_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    crest_url TEXT,
    colour TEXT,
    home_venue_id INTEGER REFERENCES league_venues(id),
    is_lobi INTEGER NOT NULL DEFAULT 0,
    aliases TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS league_competition_teams (
    competition_id INTEGER NOT NULL REFERENCES league_competitions(id),
    team_id INTEGER NOT NULL REFERENCES league_teams(id),
    PRIMARY KEY (competition_id, team_id))`,
  `CREATE TABLE IF NOT EXISTS league_fixtures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id INTEGER NOT NULL REFERENCES league_competitions(id),
    match_no INTEGER NOT NULL,
    matchday INTEGER,
    round INTEGER,
    home_team_id INTEGER NOT NULL REFERENCES league_teams(id),
    away_team_id INTEGER NOT NULL REFERENCES league_teams(id),
    venue_id INTEGER REFERENCES league_venues(id),
    kickoff_at TEXT,
    original_kickoff_at TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    home_goals INTEGER,
    away_goals INTEGER,
    result_type TEXT NOT NULL DEFAULT 'normal',
    attendance INTEGER,
    referee TEXT,
    report_url TEXT,
    note TEXT,
    postponed_reason TEXT,
    is_published INTEGER NOT NULL DEFAULT 1,
    event_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT,
    UNIQUE (competition_id, match_no),
    CHECK (home_team_id <> away_team_id))`,
  `CREATE INDEX IF NOT EXISTS idx_league_fixtures_md ON league_fixtures (competition_id, matchday)`,
  `CREATE INDEX IF NOT EXISTS idx_league_fixtures_kickoff ON league_fixtures (kickoff_at)`,
  `CREATE INDEX IF NOT EXISTS idx_league_fixtures_status ON league_fixtures (status)`,
  `CREATE INDEX IF NOT EXISTS idx_league_fixtures_home ON league_fixtures (home_team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_league_fixtures_away ON league_fixtures (away_team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_league_fixtures_event ON league_fixtures (event_id)`,
  `CREATE TABLE IF NOT EXISTS league_table_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    points_delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT, created_at TEXT DEFAULT (datetime('now')),
    voided_by TEXT, voided_at TEXT, void_reason TEXT)`,
  `CREATE TABLE IF NOT EXISTS league_tie_overrides (
    competition_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    rank_hint INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_by TEXT, created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (competition_id, team_id))`,
  `CREATE TABLE IF NOT EXISTS league_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_email TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    before_json TEXT, after_json TEXT,
    created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_league_audit_created ON league_audit_log (created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_league_audit_entity ON league_audit_log (entity, entity_id)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`,
];

export const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The SQL that seeds the official season (used by the migration builder and the first-use seed). */
export function seedStatements() {
  const q = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const c = COMPETITION;
  const out = [
    `INSERT OR IGNORE INTO league_competitions (slug, name, short_name, season, type, has_table, is_current, start_date, end_date, break_start, break_end, break_label)
     VALUES (${[c.slug, c.name, c.short_name, c.season, c.type, c.has_table, c.is_current, c.start_date, c.end_date, c.break_start, c.break_end, c.break_label].map(q).join(', ')})`,
  ];
  for (const t of TEAMS) out.push(`INSERT OR IGNORE INTO league_venues (name, city) VALUES (${q(t.venue)}, NULL)`);
  for (const t of TEAMS) {
    out.push(`INSERT OR IGNORE INTO league_teams (code, name, short_name, slug, crest_url, colour, home_venue_id, is_lobi, aliases)
      VALUES (${[t.code, t.name, t.short_name, slugify(t.name), t.crest_url, t.colour].map(q).join(', ')}, (SELECT id FROM league_venues WHERE name = ${q(t.venue)}), ${t.is_lobi ? 1 : 0}, ${q(JSON.stringify(t.aliases))})`);
    out.push(`INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id)
      VALUES ((SELECT id FROM league_competitions WHERE slug = ${q(c.slug)}), (SELECT id FROM league_teams WHERE code = ${q(t.code)}))`);
  }
  for (const f of FIXTURES) {
    out.push(`INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
      VALUES ((SELECT id FROM league_competitions WHERE slug = ${q(c.slug)}), ${f.match_no}, ${f.matchday}, ${f.round},
        (SELECT id FROM league_teams WHERE code = ${q(f.home)}), (SELECT id FROM league_teams WHERE code = ${q(f.away)}),
        (SELECT home_venue_id FROM league_teams WHERE code = ${q(f.home)}), ${q(f.kickoff_at)}, ${q(f.original_kickoff_at)}, 'scheduled', 1, 'seed')`);
  }
  return out;
}

let ready = false;
export async function ensureLeagueSchema(env) {
  const db = env.DB;
  if (ready) return;
  await db.batch(LEAGUE_TABLES_SQL.map(s => db.prepare(s)));
  // Older copies of the table (from the migration file) may lack the link column.
  const { results: cols } = await db.prepare(`PRAGMA table_info(league_fixtures)`).all();
  if (!cols.some(c => c.name === 'event_id')) await db.prepare(`ALTER TABLE league_fixtures ADD COLUMN event_id TEXT`).run();
  const { results: ccols } = await db.prepare(`PRAGMA table_info(league_competitions)`).all();
  if (!ccols.some(c => c.name === 'rules_updated_at')) await db.prepare(`ALTER TABLE league_competitions ADD COLUMN rules_updated_at TEXT`).run();
  const seeded = await db.prepare(`SELECT id FROM league_competitions WHERE slug = ?`).bind(COMPETITION.slug).first();
  if (!seeded) {
    await db.batch(seedStatements().map(s => db.prepare(s)));
    await logLeague(db, { email: 'system' }, 'season.seed', 'competition', COMPETITION.slug, null, { fixtures: FIXTURES.length, teams: TEAMS.length });
  }
  ready = true;
  // Lobi Stars fixtures get their Matches & Fixtures entries (tickets, match pages, ...).
  await linkLobiFixtures(env);
}

/** Records a change: who, what, before and after. */
export async function logLeague(db, staff, action, entity, entityId, before, after) {
  const who = staff?.email || staff?.name || 'staff';
  await db.prepare(`INSERT INTO league_audit_log (staff_email, action, entity, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(String(who).slice(0, 120), action, entity, entityId == null ? null : String(entityId), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)).run();
}

/** Sensitive actions: only the emails in settings.league_admin_emails, when that list exists. */
export async function canDoSensitive(db, admin) {
  try {
    const r = await db.prepare(`SELECT value FROM settings WHERE key = 'league_admin_emails'`).first();
    if (!r) return true;
    const list = JSON.parse(r.value || '[]');
    if (!Array.isArray(list)) return true;
    if (admin?.role === 'owner') return true;
    return list.map(s => String(s).toLowerCase()).includes(String(admin?.email || '').toLowerCase());
  } catch { return true; }
}

// ── Loading ──

export async function getCompetition(db, slug) {
  if (slug) return db.prepare(`SELECT * FROM league_competitions WHERE slug = ?`).bind(slug).first();
  return (await db.prepare(`SELECT * FROM league_competitions WHERE is_current = 1 ORDER BY id DESC LIMIT 1`).first())
    || db.prepare(`SELECT * FROM league_competitions ORDER BY id DESC LIMIT 1`).first();
}

const CENTRE_TO_LEAGUE = { scheduled: 'scheduled', live: 'live', 'half-time': 'half_time', 'full-time': 'full_time', postponed: 'postponed', cancelled: 'cancelled' };
export const LEAGUE_TO_CENTRE = { scheduled: 'scheduled', live: 'live', half_time: 'half-time', full_time: 'full-time', awarded: 'full-time', postponed: 'postponed', cancelled: 'cancelled', abandoned: 'cancelled' };
const LEAGUE_ONLY = ['postponed', 'cancelled', 'abandoned', 'awarded'];

/** Linked fixtures take their live status and score from Match Centre. */
async function overlayCentre(db, fixtures) {
  const linked = fixtures.filter(f => f.event_id);
  if (!linked.length) return fixtures;
  await ensureTable(db);
  const { results } = await db.prepare(`SELECT * FROM match_centre WHERE event_id IN (${linked.map(() => '?').join(',')})`).bind(...linked.map(f => f.event_id)).all();
  // Matches left "live" 2h15m after kick-off are closed, as on the match pages.
  const { autoCloseOverdue } = await import('./matchCentre.js');
  await autoCloseOverdue(db, results);
  const byEvent = new Map(results.map(r => [r.event_id, r]));
  for (const f of linked) {
    const c = byEvent.get(f.event_id);
    if (!c || LEAGUE_ONLY.includes(f.status)) continue;
    const st = CENTRE_TO_LEAGUE[c.status];
    if (!st || LEAGUE_ONLY.includes(st)) continue;
    f.status = st;
    f.home_goals = Number.isInteger(c.home_score) ? c.home_score : (st === 'scheduled' ? null : f.home_goals);
    f.away_goals = Number.isInteger(c.away_score) ? c.away_score : (st === 'scheduled' ? null : f.away_goals);
    if (st === 'scheduled') { f.home_goals = null; f.away_goals = null; }
    if (c.updated_at && (!f.updated_at || c.updated_at > f.updated_at)) f.updated_at = c.updated_at;
  }
  return fixtures;
}

const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/**
 * Everything about one competition: { competition, teams, venues, fixtures,
 * adjustments, overrides }. Fixtures carry home, away, venue objects.
 */
export async function loadLeague(env, { slug = null, publishedOnly = true } = {}) {
  const db = env.DB;
  await ensureLeagueSchema(env);
  const competition = await getCompetition(db, slug);
  if (!competition) return null;
  const [teamsR, venuesR, fixturesR, adjR, ovR] = await Promise.all([
    db.prepare(`SELECT t.* FROM league_teams t JOIN league_competition_teams ct ON ct.team_id = t.id WHERE ct.competition_id = ? ORDER BY t.name`).bind(competition.id).all(),
    db.prepare(`SELECT * FROM league_venues ORDER BY name`).all(),
    db.prepare(`SELECT * FROM league_fixtures WHERE competition_id = ? ${publishedOnly ? 'AND is_published = 1' : ''} ORDER BY COALESCE(kickoff_at, original_kickoff_at), match_no`).bind(competition.id).all(),
    db.prepare(`SELECT * FROM league_table_adjustments WHERE competition_id = ? ORDER BY id`).bind(competition.id).all(),
    db.prepare(`SELECT * FROM league_tie_overrides WHERE competition_id = ?`).bind(competition.id).all(),
  ]);
  const allTeams = (await db.prepare(`SELECT * FROM league_teams`).all()).results;
  const teamById = new Map(allTeams.map(t => [t.id, { ...t, aliases: parse(t.aliases, []) }]));
  const venueById = new Map(venuesR.results.map(v => [v.id, v]));
  const fixtures = await overlayCentre(db, fixturesR.results.map(f => ({ ...f })));
  for (const f of fixtures) { f.home = teamById.get(f.home_team_id); f.away = teamById.get(f.away_team_id); f.venue = venueById.get(f.venue_id) || null; f.competition = competition; }
  return {
    competition: { ...competition, zones: parse(competition.zones, []), tiebreak: parse(competition.tiebreak_order, []) },
    teams: teamsR.results.map(t => teamById.get(t.id)), allTeams: [...teamById.values()], venues: venuesR.results,
    fixtures, adjustments: adjR.results, overrides: ovR.results,
  };
}

export async function listCompetitions(db) {
  return (await db.prepare(`SELECT * FROM league_competitions ORDER BY is_current DESC, id DESC`).all()).results;
}

/** The computed table for a loaded league. */
export function standingsFor(league, { scope = 'overall', upTo = null } = {}) {
  return computeStandings({
    teams: league.teams, fixtures: league.fixtures, adjustments: league.adjustments.filter(a => a.is_active === 1),
    tieOverrides: league.overrides, rules: league.competition, upToMatchday: upTo, scope,
  });
}

/** Latest change to anything that affects the table. */
export function tableUpdatedAt(league) {
  const ts = [league.competition.rules_updated_at, ...league.fixtures.filter(f => isCounted(f, league.competition)).map(f => f.updated_at),
    ...league.adjustments.flatMap(a => [a.created_at, a.voided_at])].filter(Boolean).map(s => (/Z$|T/.test(s) ? s : s.replace(' ', 'T') + 'Z'));
  return ts.sort().pop() || null;
}

// ── Link with Matches & Fixtures (events) ──

/**
 * Creates or updates the events row of a Lobi Stars fixture so tickets, match
 * pages, commentary and Predict & Win follow League › Fixtures. Prices and
 * other ticket settings are never touched here.
 */
export async function syncEvent(env, fixtureId) {
  const db = env.DB;
  const f = await db.prepare(`SELECT f.*, c.short_name AS comp_name, h.name AS home_name, h.is_lobi AS home_lobi, a.name AS away_name, a.is_lobi AS away_lobi, v.name AS venue_name
    FROM league_fixtures f JOIN league_competitions c ON c.id = f.competition_id JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id
    LEFT JOIN league_venues v ON v.id = f.venue_id WHERE f.id = ?`).bind(fixtureId).first();
  if (!f || !(f.home_lobi || f.away_lobi)) return null;
  await ensureTable(db);
  const date = f.kickoff_at || f.original_kickoff_at;
  if (!date) return null;
  const active = f.is_published ? 1 : 0;
  const venue = f.venue_name || 'To be confirmed';
  let eventId = f.event_id;
  if (eventId && !(await db.prepare(`SELECT id FROM events WHERE id = ?`).bind(eventId).first())) eventId = null;
  if (!eventId) {
    eventId = randomId('evt', 10);
    await db.prepare(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active, is_home)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`).bind(eventId, f.home_name, f.away_name, f.comp_name, date, venue, active, f.home_lobi ? 1 : 0).run();
    await db.prepare(`UPDATE league_fixtures SET event_id = ? WHERE id = ?`).bind(eventId, f.id).run();
  } else {
    await db.prepare(`UPDATE events SET home_team = ?, away_team = ?, competition = ?, event_date = ?, venue = ?, active = ?, is_home = ? WHERE id = ?`)
      .bind(f.home_name, f.away_name, f.comp_name, date, venue, active, f.home_lobi ? 1 : 0, eventId).run();
  }
  // Statuses only the league knows (postponed, cancelled, ...) are shown on the match page too.
  if (['postponed', 'cancelled', 'abandoned'].includes(f.status) || f.status === 'awarded') {
    await writeCentre(db, eventId, f.status, f.home_goals, f.away_goals);
  } else if (f.status === 'scheduled') {
    // Rescheduled: the match page goes back to "upcoming".
    await db.prepare(`UPDATE match_centre SET status = 'scheduled', home_score = NULL, away_score = NULL, updated_at = datetime('now') WHERE event_id = ? AND status IN ('postponed', 'cancelled')`).bind(eventId).run();
  }
  return eventId;
}

/** Writes a league status and score to Match Centre (match pages, alerts, MOTM read it). */
export async function writeCentre(db, eventId, status, homeGoals, awayGoals) {
  if (!eventId) return;
  await ensureTable(db);
  const st = LEAGUE_TO_CENTRE[status] || 'scheduled';
  const now = nowIso();
  await db.prepare(`INSERT INTO match_centre (event_id, status, home_score, away_score, kickoff_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(event_id) DO UPDATE SET status = excluded.status, home_score = excluded.home_score, away_score = excluded.away_score,
      kickoff_at = CASE WHEN excluded.status IN ('live','half-time','full-time') THEN COALESCE(match_centre.kickoff_at, excluded.kickoff_at) ELSE match_centre.kickoff_at END,
      ended_at = CASE WHEN excluded.status = 'full-time' THEN COALESCE(match_centre.ended_at, excluded.ended_at) ELSE NULL END,
      updated_at = datetime('now')`)
    .bind(eventId, st, homeGoals ?? null, awayGoals ?? null, ['live', 'half-time', 'full-time'].includes(st) ? now : null, st === 'full-time' ? now : null).run();
}

let linked = false;
async function linkLobiFixtures(env) {
  if (linked) return;
  linked = true;
  const db = env.DB;
  try {
    const { results } = await db.prepare(`SELECT f.id FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id
      WHERE f.event_id IS NULL AND (h.is_lobi = 1 OR a.is_lobi = 1)`).all();
    if (!results.length) return;
    await ensureTable(db);
    for (const r of results) await syncEvent(env, r.id);
    // The trial "Lobi Stars FC vs Kada Warriors FC, Fri 23 Oct 2026" match is not in the
    // official fixture list: hide it, unless tickets were sold for it.
    const old = await db.prepare(`SELECT e.id, (SELECT COUNT(*) FROM orders o WHERE o.event_id = e.id) AS orders FROM events e
      WHERE e.home_team = 'Lobi Stars FC' AND e.away_team = 'Kada Warriors FC' AND substr(e.event_date, 1, 10) = '2026-10-23' AND e.active = 1
        AND e.id NOT IN (SELECT event_id FROM league_fixtures WHERE event_id IS NOT NULL)`).all();
    for (const e of old.results) {
      if (e.orders > 0) { await logLeague(db, { email: 'system' }, 'event.keep', 'event', e.id, null, { reason: 'Not in the official fixture list but has ticket orders: left in place.' }); continue; }
      await db.prepare(`UPDATE events SET active = 0 WHERE id = ?`).bind(e.id).run();
      await logLeague(db, { email: 'system' }, 'event.hide', 'event', e.id, { active: 1 }, { active: 0, reason: 'Not in the official NNL Conference D fixture list.' });
    }
  } catch (err) {
    linked = false;
    console.error('[league] link', err);
  }
}

/** For Matches & Fixtures: is this event managed by League › Fixtures? */
export async function leagueFixtureForEvent(db, eventId) {
  try { return await db.prepare(`SELECT id, competition_id, match_no FROM league_fixtures WHERE event_id = ?`).bind(eventId).first(); } catch { return null; }
}

/** Public JSON shape of a fixture. */
export function fixtureJson(f, siteOrigin = '') {
  const team = t => (t ? { id: t.id, code: t.code, name: t.name, shortName: t.short_name, slug: t.slug, crest: t.crest_url || `/api/league/crest/${t.code}`, colour: t.colour, isLobi: !!t.is_lobi } : null);
  return {
    id: f.id, matchNo: f.match_no, matchday: f.matchday, round: f.round, competition: f.competition?.short_name,
    home: team(f.home), away: team(f.away), venue: f.venue?.name || null,
    kickoff: f.kickoff_at, originalKickoff: f.original_kickoff_at && f.original_kickoff_at !== f.kickoff_at ? f.original_kickoff_at : null,
    status: f.status, homeGoals: f.home_goals, awayGoals: f.away_goals, resultType: f.result_type,
    attendance: f.attendance, referee: f.referee, reportUrl: f.report_url, note: f.note, postponedReason: f.postponed_reason,
    matchUrl: f.event_id ? `${siteOrigin}/matches/${matchSlugFor(f)}/` : null,
    updatedAt: f.updated_at,
  };
}
const slugPart = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function matchSlugFor(f) {
  const d = new Date(Date.parse(f.kickoff_at || f.original_kickoff_at) + 3600e3).toISOString().slice(0, 10);
  return `${d}-${slugPart(f.home?.name)}-vs-${slugPart(f.away?.name)}`;
}

export { TEAMS as SEED_TEAMS, FIXTURES as SEED_FIXTURES, COMPETITION as SEED_COMPETITION };
