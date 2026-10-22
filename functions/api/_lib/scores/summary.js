// Score verification, Phase 7: the daily matchday summary email and the
// Website Health checks for score verification.
import { getScoreSettings, COUNTED_STATES, STATE_LABEL } from './consensus.js';
import { scoreAlert } from './alerts.js';
import { loadLeague, standingsFor } from '../leagueDb.js';
import { ensureAdapterColumns } from './adapters.js';

const lagosDay = ms => new Date(ms + 3600e3).toISOString().slice(0, 10);
const FINAL = new Set(['FULL_TIME', 'AWARDED', 'ABANDONED', 'CANCELLED', 'POSTPONED']);

/** What happened today (Nigerian date): every conference match with its state and sources. */
export async function matchdaySummary(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const day = lagosDay(now);
  const start = new Date(Date.parse(`${day}T00:00:00+01:00`)).toISOString(), end = new Date(Date.parse(`${day}T23:59:59+01:00`)).toISOString();
  const rows = (await db.prepare(`SELECT f.id, f.kickoff_at, h.name AS home, a.name AS away, s.state, s.home_goals, s.away_goals, s.status, s.sources_json, s.explanation
    FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id LEFT JOIN score_state s ON s.fixture_id = f.id
    WHERE f.kickoff_at BETWEEN ? AND ? ORDER BY f.kickoff_at, f.match_no`).bind(start, end).all()).results;
  const matches = rows.map(r => ({ ...r, state: r.state || 'NONE', sources: JSON.parse(r.sources_json || '[]').length }));
  const lastKickoff = matches.length ? Math.max(...matches.map(m => Date.parse(m.kickoff_at))) : null;
  const done = matches.length > 0 && matches.every(m => COUNTED_STATES.includes(m.state) && FINAL.has(m.status));
  return { day, matches, lastKickoff, done };
}

/**
 * Sends the summary once per matchday: when every match of the day has a
 * confirmed final result, or at the latest 4 hours after the last kick-off.
 */
export async function maybeDailySummary(env, { now = Date.now(), settings = null } = {}) {
  const s = settings || await getScoreSettings(env);
  if (s.daily_summary !== '1') return null;
  const sum = await matchdaySummary(env, { now });
  if (!sum.matches.length) return null;
  if (!sum.done && now < sum.lastKickoff + 4 * 3600e3) return null;
  const word = m => (m.home_goals != null ? `${m.home} ${m.home_goals}–${m.away_goals} ${m.away}` : `${m.home} v ${m.away}`);
  const open = sum.matches.filter(m => !(COUNTED_STATES.includes(m.state) && FINAL.has(m.status)));
  const lines = [
    `Matchday summary for ${sum.day}: ${sum.matches.length} conference match${sum.matches.length === 1 ? '' : 'es'}, ${sum.matches.length - open.length} with a confirmed final result.`,
    ...sum.matches.map(m => `• ${word(m)}: ${STATE_LABEL[m.state] || m.state}${m.status ? ` (${String(m.status).replace('_', ' ').toLowerCase()})` : ''}, ${m.sources} source${m.sources === 1 ? '' : 's'}.`),
  ];
  if (open.length) lines.push(`Still to sort out: ${open.map(m => `${m.home} v ${m.away} (${(STATE_LABEL[m.state] || m.state).toLowerCase()})`).join('; ')}. Open Matchday › Other Games.`);
  const league = await loadLeague(env).catch(() => null);
  if (league) {
    const t = standingsFor(league);
    const top = t.rows.slice(0, 3).map(r => `${r.pos}. ${r.team.name} ${r.points} pts`).join(', ');
    const lobi = t.rows.find(r => r.team.is_lobi);
    lines.push(`Table: ${top}.${lobi ? ` Lobi Stars: ${lobi.pos}${['th', 'st', 'nd', 'rd'][lobi.pos % 10 > 3 || [11, 12, 13].includes(lobi.pos % 100) ? 0 : lobi.pos % 10]} with ${lobi.points} points.` : ''}`);
  }
  const sent = await scoreAlert(env, { key: `summary:${sum.day}`, superAdmins: true, subject: `Matchday summary ${sum.day}${open.length ? `: ${open.length} still open` : ''}`, link: '/admin/scores/', lines });
  return { day: sum.day, open: open.length, sent };
}

/** Website Health results for score verification (healthChecks.js, Matchday category). */
export async function scoreHealth(env, result, now = Date.now()) {
  const db = env.DB;
  const out = [];
  await ensureAdapterColumns(env);
  const s = await getScoreSettings(env);
  const last = s._last_tick ? Date.parse(s._last_tick) : 0;
  out.push(result('scores_run', !last ? 'WARNING' : now - last > 10 * 60e3 ? 'FAIL' : 'PASS', {
    problem: !last ? 'The every-minute score check has not run yet.' : now - last > 10 * 60e3 ? `The every-minute score check last ran ${Math.round((now - last) / 60e3)} minutes ago.` : 'The every-minute score check is running.' }));
  const auto = (await db.prepare(`SELECT * FROM score_sources WHERE type IN ('LICENSED_API', 'FUTURE_LICENSED') AND enabled = 1`).all()).results;
  const broken = auto.filter(x => x.last_error && (!x.last_success_at || String(x.last_checked_at) > String(x.last_success_at)));
  out.push(result('score_sources', broken.length ? 'FAIL' : 'PASS', {
    problem: broken.length ? `Not working: ${broken.map(x => `${x.label} (${x.last_error})`).join('; ')}.` : auto.length ? 'Automatic score sources are working.' : 'No automatic score source is switched on (manual sources only).' }));
  const conflicts = (await db.prepare(`SELECT COUNT(*) AS n FROM score_state WHERE state = 'CONFLICT' AND conflict_since < ?`).bind(new Date(now - 30 * 60e3).toISOString()).first()).n || 0;
  const waiting = (await db.prepare(`SELECT COUNT(*) AS n FROM score_reports WHERE needs_review = 1 AND received_at < ?`).bind(new Date(now - 2 * 3600e3).toISOString()).first()).n || 0;
  out.push(result('score_backlog', conflicts || waiting ? 'WARNING' : 'PASS', {
    problem: conflicts || waiting ? [conflicts && `${conflicts} score conflict${conflicts === 1 ? '' : 's'} open for over 30 minutes`, waiting && `${waiting} score report${waiting === 1 ? '' : 's'} waiting for review for over 2 hours`].filter(Boolean).join('; ') + '.' : 'No old score conflicts or reports waiting.' }));
  return out;
}
