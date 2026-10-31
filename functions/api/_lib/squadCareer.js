// Squad careers, worked out from the club's official match records (nothing is
// typed in by hand, so a corrected result or match stat changes everything at
// once):
//  - per season and for the whole Lobi Stars career: appearances, starts,
//    substitute appearances, minutes, goals, assists, clean sheets
//    (goalkeepers), yellow and red cards, Man of the Match wins;
//  - debut and first goal (date and opponent);
//  - awards: Man of the Match (fan vote), Goal / Player of the Month, Player
//    of the Season (closed fan votes), with date and match or month;
//  - milestones: debut, first goal, first assist, first clean sheet, 25/50/100/
//    150/200 appearances, 5/10/25/50/100 goals, first Man of the Match, first
//    award, hat-trick, 10th goal of a season;
//  - upcoming milestones ("1 goal away from 10 for the club"; partner feed only);
//  - a Head or Assistant Coach's record (matches, wins, draws, losses) while in
//    the role.
// Sources: events + match_centre (results), player_match_stats (Live Match
// Control), motm_votes, awards / award_nominees / award_votes.
import { ensureStatsSchema, seasonOf } from './stats.js';
import { ensureTable } from './matchCentre.js';
import { AWARD_TYPES } from './awards.js';

const isLobi = n => /lobi stars/i.test(n || '');
const APPS = [25, 50, 100, 150, 200], GOALS = [5, 10, 25, 50, 100];
const exists = async (db, t) => !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(t).first());

/** Everything needed for any player's career, in a few queries. */
export async function careerData(db, { startMonth = 8 } = {}) {
  await ensureStatsSchema(db); await ensureTable(db);
  const ev = (await db.prepare(`SELECT e.id, e.home_team, e.away_team, e.event_date, e.competition, c.status, c.home_score, c.away_score FROM events e LEFT JOIN match_centre c ON c.event_id = e.id
    WHERE e.home_team LIKE '%Lobi Stars%' OR e.away_team LIKE '%Lobi Stars%'`).all()).results;
  const matches = ev.filter(m => m.status === 'full-time' && m.home_score != null && m.away_score != null).map(m => {
    const home = isLobi(m.home_team), gf = home ? m.home_score : m.away_score, ga = home ? m.away_score : m.home_score;
    return { id: m.id, date: m.event_date, season: seasonOf(m.event_date, startMonth), opponent: home ? m.away_team : m.home_team, home, gf, ga, result: gf > ga ? 'W' : gf === ga ? 'D' : 'L', competition: m.competition || '' };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const byId = new Map(matches.map(m => [m.id, m]));
  const stats = (await db.prepare(`SELECT * FROM player_match_stats`).all()).results.filter(s => byId.has(s.event_id));
  // Man of the Match: the most votes in each finished match (joint winners each count).
  const motm = new Map();
  if (await exists(db, 'motm_votes')) {
    const rows = (await db.prepare(`SELECT event_id, player_slug, COUNT(*) AS votes FROM motm_votes GROUP BY event_id, player_slug`).all()).results.filter(r => byId.has(r.event_id));
    const per = new Map();
    for (const r of rows) per.set(r.event_id, [...(per.get(r.event_id) || []), r]);
    for (const [id, list] of per) { const top = Math.max(...list.map(r => r.votes)); motm.set(id, list.filter(r => r.votes === top).map(r => r.player_slug)); }
  }
  // Closed fan-vote awards and their winners.
  const awards = [];
  if (await exists(db, 'awards')) {
    const closed = (await db.prepare(`SELECT a.id, a.type, a.period, a.closes_at FROM awards a WHERE a.closes_at <= ?`).bind(new Date().toISOString()).all()).results;
    for (const a of closed.slice(-60)) {
      const votes = (await db.prepare(`SELECT n.player_slug, n.label, COUNT(v.id) AS n FROM award_nominees n LEFT JOIN award_votes v ON v.nominee_id = n.id WHERE n.award_id = ? GROUP BY n.id`).bind(a.id).all()).results;
      const top = Math.max(0, ...votes.map(v => v.n));
      if (top > 0) for (const v of votes.filter(x => x.n === top && x.player_slug)) awards.push({ slug: v.player_slug, type: a.type, title: AWARD_TYPES[a.type] || a.type, period: a.period, date: a.closes_at });
    }
  }
  return { matches, byId, stats, motm, awards, startMonth };
}

const blank = () => ({ apps: 0, starts: 0, subs: 0, minutes: 0, goals: 0, assists: 0, cleanSheets: 0, yellow: 0, red: 0, motm: 0 });
const vs = m => `${m.home ? 'v' : 'at'} ${m.opponent}`;

/** One player's career. slugs: the current web address first, then earlier ones (name corrections). */
export function careerFor(data, slugs, { goalkeeper = false } = {}) {
  const mine = new Set(slugs.filter(Boolean));
  const rows = data.stats.filter(s => mine.has(s.player_slug) && (s.played || s.goals || s.assists))
    .map(s => ({ ...s, m: data.byId.get(s.event_id) })).sort((a, b) => a.m.date.localeCompare(b.m.date));
  const seasons = new Map(), total = blank();
  let debut = null, firstGoal = null;
  const milestones = [], upcoming = [];
  const add = (key, label, m) => milestones.push({ key, label, date: m?.date || null, eventId: m?.id || null, match: m ? vs(m) : null });
  const seasonGoals = new Map();
  let firstAssist = false, firstClean = false;
  for (const r of rows) {
    const m = r.m, s = seasons.get(m.season) || blank();
    seasons.set(m.season, s);
    const played = r.played ? 1 : 0, clean = goalkeeper && played && m.ga === 0 ? 1 : 0, won = (data.motm.get(m.id) || []).some(x => mine.has(x)) ? 1 : 0;
    for (const t of [s, total]) { t.apps += played; t.starts += r.started ? 1 : 0; t.subs += played && !r.started ? 1 : 0; t.minutes += r.minutes || 0; t.goals += r.goals; t.assists += r.assists; t.cleanSheets += clean; t.yellow += r.yellow; t.red += r.red; t.motm += won; }
    if (played && !debut) { debut = { date: m.date, match: vs(m), eventId: m.id }; add('debut', 'Lobi Stars debut', m); }
    for (const n of APPS) if (played && total.apps === n) add(`apps_${n}`, `${n} appearances for Lobi Stars`, m);
    if (r.goals && !firstGoal) { firstGoal = { date: m.date, match: vs(m), eventId: m.id }; add('first_goal', 'First Lobi Stars goal', m); }
    for (const n of GOALS) if (r.goals && total.goals >= n && total.goals - r.goals < n) add(`goals_${n}`, `${n} goals for Lobi Stars`, m);
    if (r.goals >= 3) add(`hattrick_${m.id}`, `Hat-trick ${vs(m)}`, m);
    const sg = (seasonGoals.get(m.season) || 0) + r.goals; seasonGoals.set(m.season, sg);
    if (r.goals && sg >= 10 && sg - r.goals < 10) add(`season10_${m.season}`, `10th goal of the ${m.season} season`, m);
    if (r.assists && !firstAssist) { firstAssist = true; add('first_assist', 'First Lobi Stars assist', m); }
    if (clean && !firstClean) { firstClean = true; add('first_clean_sheet', 'First clean sheet for Lobi Stars', m); }
    if (won && total.motm === 1) add('first_motm', 'First Man of the Match award', m);
  }
  const awards = [
    ...rows.filter(r => (data.motm.get(r.m.id) || []).some(x => mine.has(x))).map(r => ({ type: 'motm', title: 'Man of the Match', date: r.m.date, detail: vs(r.m), eventId: r.m.id })),
    ...data.awards.filter(a => mine.has(a.slug)).map(a => ({ type: a.type, title: a.title, date: a.date, detail: a.period })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const firstAward = awards.find(a => a.type !== 'motm');
  if (firstAward) milestones.push({ key: 'first_award', label: `First award: ${firstAward.title} (${firstAward.detail})`, date: firstAward.date, eventId: null, match: null });
  milestones.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // Upcoming (for the media partner): within 3 appearances or 2 goals of the next milestone.
  const nextApps = APPS.find(n => n > total.apps), nextGoals = GOALS.find(n => n > total.goals);
  if (nextApps && nextApps - total.apps <= 3 && total.apps > 0) upcoming.push({ key: `apps_${nextApps}`, label: `${nextApps - total.apps} appearance${nextApps - total.apps === 1 ? '' : 's'} away from ${nextApps} for the club` });
  if (nextGoals && nextGoals - total.goals <= 2 && total.goals > 0) upcoming.push({ key: `goals_${nextGoals}`, label: `${nextGoals - total.goals} goal${nextGoals - total.goals === 1 ? '' : 's'} away from ${nextGoals} for the club` });
  const cur = [...seasonGoals.entries()].sort().pop();
  if (cur && cur[1] >= 8 && cur[1] < 10) upcoming.push({ key: `season10_${cur[0]}`, label: `${10 - cur[1]} goal${10 - cur[1] === 1 ? '' : 's'} away from 10 this season` });
  return {
    seasons: [...seasons.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([season, s]) => ({ season, ...s })),
    total, debut, firstGoal, awards, milestones, upcoming,
  };
}

/** A Head or Assistant Coach's record while at the club (from the joined date to leaving, or today). */
export function coachRecord(data, { from = null, to = null } = {}) {
  const start = from ? Date.parse(from) : 0, end = to ? Date.parse(to) : Date.now();
  const list = data.matches.filter(m => Date.parse(m.date) >= start && Date.parse(m.date) <= end);
  const r = { matches: list.length, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  for (const m of list) { r[m.result === 'W' ? 'wins' : m.result === 'D' ? 'draws' : 'losses']++; r.goalsFor += m.gf; r.goalsAgainst += m.ga; }
  return r;
}
export const COACH_RECORD_ROLES = ['Head Coach', 'Assistant Coach'];
