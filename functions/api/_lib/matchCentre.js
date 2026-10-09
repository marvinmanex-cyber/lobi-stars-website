// Match Centre data (preview, line-ups, live timeline, report, stats,
// gallery, score) for a match in the events table. Edited from
// /admin/match-centre; read by /api/matches and /matches/<slug>.
import { matchSlug } from './matchSlug.js';

export const STATUSES = ['scheduled', 'live', 'half-time', 'full-time', 'postponed', 'cancelled'];
export const TIMELINE_TYPES = ['goal', 'own-goal', 'penalty', 'yellow', 'red', 'sub', 'note'];
export const STAT_KEYS = ['possession', 'shots', 'shotsOnTarget', 'corners', 'fouls', 'yellowCards', 'redCards'];

export async function ensureTable(db) {
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
}

const json = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

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
    programme_url: event.programme_url || null,
    status: c.status || 'scheduled',
    home_score: c.home_score ?? null,
    away_score: c.away_score ?? null,
    preview: c.preview || '',
    report: c.report || '',
    lineups: json(c.lineups_json, { home: { starting: [], subs: [] }, away: { starting: [], subs: [] } }),
    timeline: json(c.timeline_json, []),
    stats: json(c.stats_json, {}),
    gallery: json(c.gallery_json, []),
    updated_at: c.updated_at || null,
  };
}

/** Lighter shape for lists (no long text). */
export function toSummary(event, centre) {
  const p = toPublic(event, centre);
  return {
    id: p.id, slug: p.slug, home_team: p.home_team, away_team: p.away_team, competition: p.competition,
    event_date: p.event_date, venue: p.venue, status: p.status, home_score: p.home_score, away_score: p.away_score,
  };
}

export async function listMatches(db) {
  await ensureTable(db);
  const { results } = await db.prepare(
    `SELECT e.*, m.status, m.home_score, m.away_score, m.updated_at
     FROM events e LEFT JOIN match_centre m ON m.event_id = e.id
     WHERE e.active = 1
     ORDER BY e.event_date ASC`
  ).all();
  return results;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.max(0, Math.min(99, Math.round(Number(v)))));
const names = list => (Array.isArray(list) ? list : []).map(n => str(n, 80)).filter(Boolean).slice(0, 30);

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
    const h = int(pair[0]), a = int(pair[1]);
    if (h !== null || a !== null) stats[k] = [h ?? 0, a ?? 0];
  }
  const gallery = (Array.isArray(b.gallery) ? b.gallery : []).slice(0, 40)
    .map(g => ({ url: str(g?.url, 300), caption: str(g?.caption, 160) }))
    .filter(g => /^(https:\/\/|\/)/.test(g.url));

  return {
    value: {
      status,
      home_score: int(b.home_score),
      away_score: int(b.away_score),
      preview: str(b.preview, 20000),
      report: str(b.report, 40000),
      lineups_json: JSON.stringify(lineups),
      timeline_json: JSON.stringify(timeline),
      stats_json: JSON.stringify(stats),
      gallery_json: JSON.stringify(gallery),
    },
  };
}
