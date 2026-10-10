// Season statistics for /stats. Player numbers come from what staff enter per
// match in Admin -> Match Centre (played, started, goals, assists, cards);
// team numbers come from match results; clean sheets are worked out (a
// goalkeeper who played in a game where Lobi Stars conceded nothing); Man of
// the Match wins come from the fan vote. Nothing is invented: empty
// leaderboards simply aren't shown.
import { listMatches } from './matchCentre.js';

let ready = false;
export async function ensureStatsSchema(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS player_match_stats (
    event_id TEXT NOT NULL,
    player_slug TEXT NOT NULL,
    played INTEGER NOT NULL DEFAULT 0,
    started INTEGER NOT NULL DEFAULT 0,
    goals INTEGER NOT NULL DEFAULT 0,
    assists INTEGER NOT NULL DEFAULT 0,
    yellow INTEGER NOT NULL DEFAULT 0,
    red INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (event_id, player_slug)
  )`).run();
  ready = true;
}

const int = (v, max = 30) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

/** Validates the admin's player stats against the squad list. Rows with nothing in them are dropped. */
export function parsePlayerStats(input, roster) {
  const known = new Set((roster || []).map(p => p.slug));
  const out = new Map();
  for (const r of Array.isArray(input) ? input : []) {
    const slug = String(r?.player || '');
    if (!known.has(slug)) continue;
    const row = { player: slug, played: r.played ? 1 : 0, started: r.started ? 1 : 0, goals: int(r.goals), assists: int(r.assists), yellow: int(r.yellow, 2), red: int(r.red, 1) };
    if (row.started) row.played = 1;
    if (row.played || row.goals || row.assists || row.yellow || row.red) out.set(slug, row);
  }
  return [...out.values()];
}

export async function savePlayerStats(db, eventId, rows) {
  await ensureStatsSchema(db);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`DELETE FROM player_match_stats WHERE event_id = ?`).bind(eventId),
    ...rows.map(r => db.prepare(
      `INSERT INTO player_match_stats (event_id, player_slug, played, started, goals, assists, yellow, red, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(eventId, r.player, r.played, r.started, r.goals, r.assists, r.yellow, r.red, now)),
  ]);
}

export async function loadPlayerStats(db, eventId) {
  await ensureStatsSchema(db);
  const { results } = await db.prepare(`SELECT * FROM player_match_stats WHERE event_id = ?`).bind(eventId).all();
  return results.map(r => ({ player: r.player_slug, played: !!r.played, started: !!r.started, goals: r.goals, assists: r.assists, yellow: r.yellow, red: r.red }));
}

/** "2026/27" for a date, with seasons starting in `startMonth` (1-12, default August). */
export function seasonOf(iso, startMonth = 8) {
  const d = new Date(new Date(iso).getTime() + 3_600_000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const start = m >= startMonth ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

const isLobi = n => /lobi stars/i.test(n || '');
const hasScore = m => m.home_score !== null && m.home_score !== undefined && m.away_score !== null && m.away_score !== undefined;

/**
 * Everything /stats shows for one season.
 * roster: [{ slug, name, number, position, photo, isSample }]
 */
export async function seasonStats(db, roster, { season, currentSeason, startMonth = 8 } = {}) {
  await ensureStatsSchema(db);
  const rows = (await listMatches(db)).filter(m => isLobi(m.home_team) || isLobi(m.away_team));
  const seasons = [...new Set([currentSeason, ...rows.map(m => seasonOf(m.event_date, startMonth))].filter(Boolean))].sort().reverse();
  const chosen = seasons.includes(season) ? season : (currentSeason || seasons[0] || seasonOf(new Date().toISOString(), startMonth));
  const inSeason = rows.filter(m => seasonOf(m.event_date, startMonth) === chosen).sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
  const finished = inSeason.filter(m => m.status === 'full-time' && hasScore(m));

  // ── Team ──
  const rec = () => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  const team = { all: rec(), home: rec(), away: rec(), unbeaten: 0, form: [] };
  let run = 0;
  const concededNone = new Set();
  for (const m of finished) {
    const home = isLobi(m.home_team);
    const gf = home ? m.home_score : m.away_score, ga = home ? m.away_score : m.home_score;
    const res = gf > ga ? 'w' : gf === ga ? 'd' : 'l';
    for (const r of [team.all, home ? team.home : team.away]) { r.p++; r[res]++; r.gf += gf; r.ga += ga; }
    run = res === 'l' ? 0 : run + 1;
    team.unbeaten = Math.max(team.unbeaten, run);
    team.form.push(res.toUpperCase());
    if (ga === 0) concededNone.add(m.id);
  }
  team.form = team.form.slice(-5);

  // ── Players ──
  // Filtered in code (D1 allows at most 100 values per query, and these tables stay small).
  const ids = new Set(inSeason.map(m => m.id));
  const stats = ids.size ? (await db.prepare(`SELECT * FROM player_match_stats`).all()).results.filter(r => ids.has(r.event_id)) : [];
  const people = new Map(roster.filter(p => !p.isSample).map(p => [p.slug, p]));
  const agg = new Map();
  const get = slug => { if (!agg.has(slug)) agg.set(slug, { apps: 0, starts: 0, goals: 0, assists: 0, yellow: 0, red: 0, cleanSheets: 0, motm: 0 }); return agg.get(slug); };
  for (const s of stats) {
    const p = people.get(s.player_slug);
    if (!p) continue;
    const a = get(s.player_slug);
    a.apps += s.played; a.starts += s.started; a.goals += s.goals; a.assists += s.assists; a.yellow += s.yellow; a.red += s.red;
    if (p.position === 'GK' && s.played && concededNone.has(s.event_id)) a.cleanSheets++;
  }

  // Man of the Match wins (joint winners each count).
  const hasVotes = await db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'motm_votes'`).first();
  if (hasVotes && finished.length) {
    const fids = new Set(finished.map(m => m.id));
    const results = (await db.prepare(
      `SELECT event_id, player_slug, COUNT(*) AS votes FROM motm_votes GROUP BY event_id, player_slug`
    ).all()).results.filter(r => fids.has(r.event_id));
    const byEvent = new Map();
    for (const r of results) { const l = byEvent.get(r.event_id) || []; l.push(r); byEvent.set(r.event_id, l); }
    for (const list of byEvent.values()) {
      const top = Math.max(...list.map(r => r.votes));
      for (const r of list) if (r.votes === top && people.has(r.player_slug)) get(r.player_slug).motm++;
    }
  }

  const board = (key, label, unit) => ({
    key, label, unit,
    rows: [...agg.entries()].filter(([, a]) => a[key] > 0)
      .map(([slug, a]) => ({ slug, name: people.get(slug).name, number: people.get(slug).number, position: people.get(slug).position, photo: people.get(slug).photo || null, value: a[key] }))
      .sort((x, y) => y.value - x.value || String(x.name).localeCompare(String(y.name)))
      .slice(0, 10),
  });
  const boards = [
    board('goals', 'Top Scorers', 'goals'),
    board('assists', 'Assists', 'assists'),
    board('cleanSheets', 'Clean Sheets', 'clean sheets'),
    board('apps', 'Appearances', 'apps'),
    board('motm', 'Man of the Match', 'awards'),
    board('yellow', 'Yellow Cards', 'yellow'),
    board('red', 'Red Cards', 'red'),
  ].filter(b => b.rows.length);

  return { season: chosen, seasons, team, played: finished.length, boards };
}
