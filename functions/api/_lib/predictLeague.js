// Season Prediction League, built on Predict & Win entries.
//
// The per-game rules don't change (home games only, opens 24h before
// kick-off, closes at kick-off, ₦10,000 to the earliest exact score). On top
// of that, every settled prediction earns season points:
//   exact score = 3 points, correct result (win/draw/loss) = 1 point.
// Ranking: points, then more exact scores, then the earliest average
// submission time (how soon after predictions opened, on average, the fan
// sent their predictions). Disqualified entries, club staff/player accounts
// and erased accounts are left out.
import { ensurePredictSchema } from './predict.js';
import { ensureTable } from './matchCentre.js';
import { ensureFanSchema } from './fans.js';
import { seasonOf } from './stats.js';
import { PREDICTION_OPENS_HOURS_BEFORE, POINTS_EXACT, POINTS_RESULT } from './predictSettings.js';

export { POINTS_EXACT, POINTS_RESULT };

const sign = n => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Points for one prediction against the final score. */
export function predictionPoints(ph, pa, h, a) {
  if (ph === h && pa === a) return POINTS_EXACT;
  return sign(ph - pa) === sign(h - a) ? POINTS_RESULT : 0;
}

/** "Terna A." -- first name and surname initial only. */
export function leagueName(first, last) {
  return [String(first || '').trim(), last ? `${String(last).trim().charAt(0).toUpperCase()}.` : ''].filter(Boolean).join(' ') || 'Fan';
}

/**
 * The league table for a season.
 * Returns { season, seasons, games, rows: [{ rank, memberId, name, points, exact, results, predictions, avgSeconds }] }.
 */
export async function seasonLeague(db, { season = '', currentSeason = '', startMonth = 8 } = {}) {
  await ensureTable(db);
  await ensureFanSchema(db);
  await ensurePredictSchema(db);
  // Settled home games (a prediction_results row exists once the final score is in).
  const { results: settled } = await db.prepare(
    `SELECT r.event_id, r.home_score, r.away_score, e.event_date FROM prediction_results r JOIN events e ON e.id = r.event_id`
  ).all();
  const seasons = [...new Set([currentSeason, ...settled.map(g => seasonOf(g.event_date, startMonth))].filter(Boolean))].sort().reverse();
  const chosen = seasons.includes(season) ? season : (currentSeason || seasons[0] || seasonOf(new Date().toISOString(), startMonth));
  const games = new Map(settled.filter(g => seasonOf(g.event_date, startMonth) === chosen).map(g => [g.event_id, g]));
  if (!games.size) return { season: chosen, seasons, games: 0, rows: [] };

  // Filtered in code (D1 allows at most 100 values per query).
  const { results: entries } = await db.prepare(
    `SELECT p.event_id, p.member_id, p.home_goals, p.away_goals, p.created_at, p.disqualified,
            m.first_name, m.last_name, COALESCE(m.is_staff, 0) AS is_staff
     FROM predictions p JOIN members m ON m.id = p.member_id`
  ).all();

  const table = new Map();
  for (const e of entries) {
    const g = games.get(e.event_id);
    if (!g || e.disqualified || e.is_staff) continue;
    const row = table.get(e.member_id) || { memberId: e.member_id, name: leagueName(e.first_name, e.last_name), points: 0, exact: 0, results: 0, predictions: 0, totalSeconds: 0 };
    const pts = predictionPoints(e.home_goals, e.away_goals, g.home_score, g.away_score);
    row.points += pts;
    if (pts === POINTS_EXACT) row.exact++; else if (pts === POINTS_RESULT) row.results++;
    row.predictions++;
    const opened = new Date(g.event_date).getTime() - PREDICTION_OPENS_HOURS_BEFORE * 3600_000;
    row.totalSeconds += Math.max(0, (new Date(e.created_at).getTime() - opened) / 1000);
    table.set(e.member_id, row);
  }
  const rows = [...table.values()]
    .map(({ totalSeconds, ...r }) => ({ ...r, avgSeconds: Math.round(totalSeconds / r.predictions) }))
    .sort((a, b) => b.points - a.points || b.exact - a.exact || a.avgSeconds - b.avgSeconds || a.name.localeCompare(b.name))
    .map((r, i) => ({ rank: i + 1, ...r }));
  return { season: chosen, seasons, games: games.size, rows };
}
