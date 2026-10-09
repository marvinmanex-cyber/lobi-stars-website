// Match Centre data (preview, line-ups, live timeline, report, stats,
// gallery, score, match status, matchday squad) for a match in the events
// table. Edited from /admin/match-centre; read by /api/matches and
// /matches/<slug>.
//
// Match status is always decided on the SERVER (Cloudflare's clock, shown in
// Nigerian time). Never trust the browser's clock for anything that matters.
import { matchSlug } from './matchSlug.js';

export const STATUSES = ['scheduled', 'live', 'half-time', 'full-time', 'postponed', 'cancelled'];
export const LIVE_STATUSES = ['live', 'half-time'];
export const TIMELINE_TYPES = ['goal', 'own-goal', 'penalty', 'yellow', 'red', 'sub', 'note'];
export const STAT_KEYS = ['possession', 'shots', 'shotsOnTarget', 'corners', 'fouls', 'yellowCards', 'redCards'];

/** Safety net: a match left "live" is closed automatically this long after kick-off. */
export const AUTO_CLOSE_MS = (2 * 60 + 15) * 60 * 1000;

let ready = false;
export async function ensureTable(db) {
  if (ready) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS match_centre (
       event_id TEXT PRIMARY KEY REFERENCES events(id),
       status TEXT NOT NULL DEFAULT 'scheduled',
       home_score INTEGER,
       away_score INTEGER,
       preview TEXT,
       report TEXT,
       lineups_json TEXT,
       timeline_json TEXT,
       stats_json TEXT,
       gallery_json TEXT,
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  ).run();
  const addMissing = async (table, cols) => {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
    const have = new Set(results.map(r => r.name));
    for (const [name, type] of cols) {
      if (!have.has(name)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run();
    }
  };
  await addMissing('match_centre', [
    ['kickoff_at', 'TEXT'],     // when staff pressed "Start Match" (ISO, server time)
    ['ended_at', 'TEXT'],       // when staff pressed "End Match" or the match auto-closed
    ['auto_closed', 'INTEGER NOT NULL DEFAULT 0'],
    ['squad_json', 'TEXT'],     // Lobi Stars matchday squad (starting XI + bench) for MOTM voting
  ]);
  // NULL = work it out from the home team name; 1/0 = set explicitly by staff.
  await addMissing('events', [['is_home', 'INTEGER']]);
  ready = true;
}

const json = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/** Is this a Lobi Stars HOME game? (Matchday Live features only run for these.) */
export function isHomeGame(event) {
  if (event.is_home === 1 || event.is_home === 0) return event.is_home === 1;
  return /lobi stars/i.test(event.home_team || '');
}

/**
 * Closes any match that is still live 2h15m after kick-off. Runs whenever
 * match data is read, so it doesn't depend on a scheduled job. Mutates and
 * returns the rows it closed.
 */
export async function autoCloseOverdue(db, rows, now = Date.now()) {
  const closed = [];
  for (const r of rows) {
    if (!LIVE_STATUSES.includes(r.status) || !r.kickoff_at) continue;
    const due = new Date(r.kickoff_at).getTime() + AUTO_CLOSE_MS;
    if (now < due) continue;
    const endedAt = new Date(due).toISOString();
    await db.prepare(
      `UPDATE match_centre SET status = 'full-time', ended_at = ?, auto_closed = 1, updated_at = datetime('now')
       WHERE event_id = ? AND status IN ('live', 'half-time')`
    ).bind(endedAt, r.event_id || r.id).run();
    r.status = 'full-time'; r.ended_at = endedAt; r.auto_closed = 1;
    closed.push(r);
  }
  return closed;
}

/** Loads one match's events + match_centre rows by id, applying the auto-close. */
export async function loadMatch(db, id) {
  await ensureTable(db);
  const event = await db.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
  if (!event) return null;
  const centre = await db.prepare(`SELECT * FROM match_centre WHERE event_id = ?`).bind(id).first();
  if (centre) await autoCloseOverdue(db, [centre]);
  return { event, centre };
}

/** Public shape of a match, combining the events row and its Match Centre row. */
export function toPublic(event, centre) {
  const c = centre || {};
  return {
    id: event.id,
    slug: matchSlug(event),
    home_team: event.home_team,
    away_team: event.away_team,
    competition: event.competition,
    event_date: event.event_date,
    venue: event.venue,
    is_home: isHomeGame(event),
    programme_url: event.programme_url || null,
    status: c.status || 'scheduled',
    home_score: c.home_score ?? null,
    away_score: c.away_score ?? null,
    kickoff_at: c.kickoff_at || null,
    ended_at: c.ended_at || null,
    preview: c.preview || '',
    report: c.report || '',
    lineups: json(c.lineups_json, { home: { starting: [], subs: [] }, away: { starting: [], subs: [] } }),
    timeline: json(c.timeline_json, []),
    stats: json(c.stats_json, {}),
    gallery: json(c.gallery_json, []),
    squad: json(c.squad_json, { starting: [], bench: [] }),
    updated_at: c.updated_at || null,
  };
}

/** Lighter shape for lists (no long text). */
export function toSummary(event, centre) {
  const p = toPublic(event, centre);
  return {
    id: p.id, slug: p.slug, home_team: p.home_team, away_team: p.away_team, competition: p.competition,
    event_date: p.event_date, venue: p.venue, is_home: p.is_home, status: p.status,
    home_score: p.home_score, away_score: p.away_score, kickoff_at: p.kickoff_at,
  };
}

export async function listMatches(db) {
  await ensureTable(db);
  const { results } = await db.prepare(
    `SELECT e.*, m.event_id, m.status, m.home_score, m.away_score, m.kickoff_at, m.ended_at, m.updated_at
     FROM events e LEFT JOIN match_centre m ON m.event_id = e.id
     WHERE e.active = 1
     ORDER BY e.event_date ASC`
  ).all();
  await autoCloseOverdue(db, results.filter(r => r.event_id));
  return results;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const scoreInt = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.max(0, Math.min(99, Math.round(Number(v)))));
const names = list => (Array.isArray(list) ? list : []).map(n => str(n, 80)).filter(Boolean).slice(0, 30);

/**
 * Validates a matchday squad against the published player list
 * (/data/players.json). Stores a snapshot of each player so votes and
 * results still show correctly if a player profile changes later.
 */
export function parseSquad(input, roster) {
  const bySlug = new Map((roster || []).map(p => [p.slug, p]));
  const pick = list => [...new Set((Array.isArray(list) ? list : []).map(s => String(s)))]
    .filter(s => bySlug.has(s)).slice(0, 25)
    .map(s => { const p = bySlug.get(s); return { slug: p.slug, name: p.name, number: p.number, position: p.position, photo: p.photo || null }; });
  const starting = pick(input?.starting);
  const startingSlugs = new Set(starting.map(p => p.slug));
  const bench = pick(input?.bench).filter(p => !startingSlugs.has(p.slug));
  return { starting, bench };
}

/** Validates an admin payload; returns { value } or { error }. */
export function parseCentrePayload(b) {
  b = b || {};
  const status = STATUSES.includes(b.status) ? b.status : 'scheduled';
  const lu = b.lineups || {};
  const lineups = {
    home: { starting: names(lu.home?.starting), subs: names(lu.home?.subs) },
    away: { starting: names(lu.away?.starting), subs: names(lu.away?.subs) },
  };
  const timeline = (Array.isArray(b.timeline) ? b.timeline : []).slice(0, 80).map(e => ({
    minute: str(String(e?.minute ?? ''), 8),
    type: TIMELINE_TYPES.includes(e?.type) ? e.type : 'note',
    team: e?.team === 'away' ? 'away' : e?.team === 'home' ? 'home' : '',
    player: str(e?.player, 80),
    detail: str(e?.detail, 160),
  })).filter(e => e.minute || e.player || e.detail);
  const stats = {};
  for (const k of STAT_KEYS) {
    const pair = Array.isArray(b.stats?.[k]) ? b.stats[k] : [];
    const h = scoreInt(pair[0]), a = scoreInt(pair[1]);
    if (h !== null || a !== null) stats[k] = [h ?? 0, a ?? 0];
  }
  const gallery = (Array.isArray(b.gallery) ? b.gallery : []).slice(0, 40)
    .map(g => ({ url: str(g?.url, 300), caption: str(g?.caption, 160) }))
    .filter(g => /^(https:\/\/|\/)/.test(g.url));

  return {
    value: {
      status,
      home_score: scoreInt(b.home_score),
      away_score: scoreInt(b.away_score),
      preview: str(b.preview, 20000),
      report: str(b.report, 40000),
      lineups_json: JSON.stringify(lineups),
      timeline_json: JSON.stringify(timeline),
      stats_json: JSON.stringify(stats),
      gallery_json: JSON.stringify(gallery),
    },
  };
}
