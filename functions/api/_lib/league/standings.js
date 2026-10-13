// The league table, CALCULATED from results, points adjustments, tie
// decisions and the competition's rules (never typed in). Pure functions:
// the same code runs in Pages Functions, Astro pages and Node tests.
//
// computeStandings({ teams, fixtures, adjustments, tieOverrides, rules, upToMatchday, scope })
//   teams:        [{ id, name, short_name, code, ... }]
//   fixtures:     [{ id, matchday, home_team_id, away_team_id, kickoff_at, status, home_goals, away_goals }]
//   adjustments:  [{ team_id, points_delta, reason, is_active }]
//   tieOverrides: [{ team_id, rank_hint, reason }]
//   rules:        the competition row (points_win, points_draw, points_loss, tiebreak_order, include_live)
//   scope:        'overall' | 'home' | 'away'
// Returns { rows, preSeason, matchday, matchesPlayed } where each row is
// { pos, team, played, won, drawn, lost, gf, ga, gd, points, adjustment, form,
//   movement, level, tiedWith, decidedBy }.

export const CRITERIA = ['points', 'goal_difference', 'goals_for', 'goals_against', 'wins', 'h2h_points', 'h2h_goal_difference', 'h2h_goals_for', 'away_goals'];
export const DEFAULT_TIEBREAK = ['points', 'goal_difference', 'goals_for', 'wins', 'h2h_points', 'h2h_goal_difference', 'h2h_goals_for'];

/** Plain-language names, for footnotes and the admin "Explain this position". */
export const CRITERION_LABELS = {
  points: 'points',
  goal_difference: 'goal difference',
  goals_for: 'goals scored',
  goals_against: 'fewer goals conceded',
  wins: 'wins',
  h2h_points: 'points in the matches between the tied clubs',
  h2h_goal_difference: 'goal difference in the matches between the tied clubs',
  h2h_goals_for: 'goals scored in the matches between the tied clubs',
  away_goals: 'goals scored away from home',
  tie_override: 'a decision by the league (recorded by the club)',
  alphabetical: 'alphabetical order (level on everything)',
};

const LIVE = ['live', 'half_time'];
const int = v => Number.isInteger(v);

/** Does this result count towards the table? */
export function isCounted(f, competition = {}) {
  if (!int(f.home_goals) || !int(f.away_goals)) return false;
  if (f.status === 'full_time' || f.status === 'awarded') return true;
  return !!competition.include_live && LIVE.includes(f.status);
}

export function parseTiebreak(rules) {
  const t = rules?.tiebreak_order;
  if (Array.isArray(t)) return t;
  try { const a = JSON.parse(t || '[]'); if (Array.isArray(a) && a.length) return a; } catch { /* default */ }
  return DEFAULT_TIEBREAK;
}

const pts = rules => ({ w: Number(rules?.points_win ?? 3), d: Number(rules?.points_draw ?? 1), l: Number(rules?.points_loss ?? 0) });
const byKickoff = (a, b) => String(a.kickoff_at || a.original_kickoff_at || '').localeCompare(String(b.kickoff_at || b.original_kickoff_at || '')) || (a.matchday || 0) - (b.matchday || 0) || (a.id || 0) - (b.id || 0);

function blankRow(team) {
  return { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, adjustment: 0, awayGoals: 0, results: [] };
}

/** Adds one side of a result to a row. */
function addResult(row, gf, ga, isAway, p, f) {
  row.played++; row.gf += gf; row.ga += ga;
  if (isAway) row.awayGoals += gf;
  const r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
  if (r === 'W') { row.won++; row.points += p.w; } else if (r === 'D') { row.drawn++; row.points += p.d; } else { row.lost++; row.points += p.l; }
  row.results.push({ r, f });
}

/** Mini-league among `ids` using only matches between them. */
function headToHead(ids, counted, p) {
  const set = new Set(ids);
  const t = new Map(ids.map(id => [id, { points: 0, gd: 0, gf: 0 }]));
  for (const f of counted) {
    if (!set.has(f.home_team_id) || !set.has(f.away_team_id)) continue;
    const h = t.get(f.home_team_id), a = t.get(f.away_team_id);
    h.gf += f.home_goals; a.gf += f.away_goals;
    h.gd += f.home_goals - f.away_goals; a.gd += f.away_goals - f.home_goals;
    if (f.home_goals > f.away_goals) { h.points += p.w; a.points += p.l; }
    else if (f.home_goals < f.away_goals) { a.points += p.w; h.points += p.l; }
    else { h.points += p.d; a.points += p.d; }
  }
  return t;
}

function valueOf(criterion, row, h2h) {
  switch (criterion) {
    case 'points': return row.points;
    case 'goal_difference': return row.gd;
    case 'goals_for': return row.gf;
    case 'goals_against': return -row.ga; // fewer is better
    case 'wins': return row.won;
    case 'away_goals': return row.awayGoals;
    case 'h2h_points': return h2h.get(row.team.id).points;
    case 'h2h_goal_difference': return h2h.get(row.team.id).gd;
    case 'h2h_goals_for': return h2h.get(row.team.id).gf;
    default: return 0;
  }
}
/** The value as people read it (goals conceded shown as a positive number). */
const shown = (criterion, v) => (criterion === 'goals_against' ? -v : v);

/**
 * Orders a group of rows that are level so far, criterion by criterion.
 * Head-to-head criteria use a mini-league among ONLY the clubs still level.
 */
function orderGroup(group, criteria, ci, counted, p, overrides) {
  if (group.length <= 1) return group;
  if (ci >= criteria.length) {
    // Level on every criterion: the league's decision (rank hint), then A-Z.
    const hint = r => (overrides.has(r.team.id) ? overrides.get(r.team.id).rank_hint : Infinity);
    const sorted = [...group].sort((a, b) => hint(a) - hint(b) || a.team.name.localeCompare(b.team.name));
    for (const r of sorted) { r.level = true; r.tiedWith = sorted.filter(x => x !== r).map(x => x.team.name); }
    sorted.forEach((r, i) => {
      if (i === 0) return;
      const byHint = hint(sorted[i - 1]) !== hint(r);
      r.decidedBy = { criterion: byHint ? 'tie_override' : 'alphabetical', above: sorted[i - 1].team.name, reason: byHint ? overrides.get(sorted[i - 1].team.id)?.reason || overrides.get(r.team.id)?.reason || null : null };
    });
    return sorted;
  }
  const c = criteria[ci];
  const h2h = c.startsWith('h2h_') ? headToHead(group.map(r => r.team.id), counted, p) : null;
  const vals = new Map(group.map(r => [r, valueOf(c, r, h2h)]));
  const buckets = [...new Set(vals.values())].sort((a, b) => b - a).map(v => group.filter(r => vals.get(r) === v));
  if (buckets.length === 1) return orderGroup(group, criteria, ci + 1, counted, p, overrides);
  const out = [];
  buckets.forEach((b, bi) => {
    const ordered = orderGroup(b, criteria, ci + 1, counted, p, overrides);
    if (bi > 0) {
      const above = out[out.length - 1];
      ordered[0].decidedBy = { criterion: c, above: above.team.name, aboveValue: shown(c, vals.get(above)), value: shown(c, vals.get(ordered[0])) };
    }
    out.push(...ordered);
  });
  return out;
}

function table({ teams, counted, adjustments, overrides, rules, scope }) {
  const p = pts(rules);
  const rows = new Map(teams.map(t => [t.id, blankRow(t)]));
  for (const f of [...counted].sort(byKickoff)) {
    const h = rows.get(f.home_team_id), a = rows.get(f.away_team_id);
    if (h && scope !== 'away') addResult(h, f.home_goals, f.away_goals, false, p, f);
    if (a && scope !== 'home') addResult(a, f.away_goals, f.home_goals, true, p, f);
  }
  if (scope === 'overall') {
    for (const adj of adjustments) {
      if (!adj.is_active && adj.is_active !== undefined) continue;
      const r = rows.get(adj.team_id);
      if (r) { r.adjustment += Number(adj.points_delta) || 0; r.points += Number(adj.points_delta) || 0; }
    }
  }
  for (const r of rows.values()) { r.gd = r.gf - r.ga; r.form = r.results.slice(-5).map(x => x.r); }
  const criteria = parseTiebreak(rules);
  // Head-to-head always uses every counted match between the tied clubs.
  const ordered = orderGroup([...rows.values()].sort((a, b) => a.team.name.localeCompare(b.team.name)), criteria, 0, counted, p, overrides);
  return ordered.map((r, i) => ({
    pos: i + 1, team: r.team, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.gf, ga: r.ga, gd: r.gd,
    points: r.points, adjustment: r.adjustment, form: r.form, level: !!r.level, tiedWith: r.tiedWith || [], decidedBy: r.decidedBy || null,
  }));
}

export function computeStandings({ teams = [], fixtures = [], adjustments = [], tieOverrides = [], rules = {}, upToMatchday = null, scope = 'overall' } = {}) {
  const overrides = new Map(tieOverrides.map(o => [o.team_id, o]));
  const inScope = f => upToMatchday == null || (f.matchday != null && f.matchday <= upToMatchday);
  const counted = fixtures.filter(f => isCounted(f, rules) && inScope(f));
  const activeAdj = adjustments.filter(a => a.is_active === undefined || a.is_active === 1 || a.is_active === true);
  if (!counted.length && !activeAdj.length) {
    const rows = [...teams].sort((a, b) => a.name.localeCompare(b.name)).map((team, i) => ({
      pos: i + 1, team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, adjustment: 0, form: [], movement: 0, level: false, tiedWith: [], decidedBy: null,
    }));
    return { rows, preSeason: true, matchday: null, matchesPlayed: 0 };
  }
  const rows = table({ teams, counted, adjustments: activeAdj, overrides, rules, scope });
  // Movement: compared with the table after the previous matchday that has a counted match.
  const days = [...new Set(counted.map(f => f.matchday).filter(d => d != null))].sort((a, b) => a - b);
  const current = days.length ? days[days.length - 1] : null;
  const prevDay = days.length > 1 ? days[days.length - 2] : null;
  if (prevDay != null) {
    const before = table({ teams, counted: counted.filter(f => f.matchday != null && f.matchday <= prevDay), adjustments: activeAdj, overrides, rules, scope });
    const was = new Map(before.map(r => [r.team.id, r.pos]));
    for (const r of rows) r.movement = was.has(r.team.id) ? was.get(r.team.id) - r.pos : 0;
  } else for (const r of rows) r.movement = 0;
  return { rows, preSeason: false, matchday: current, matchesPlayed: counted.length };
}

/** "Level on points with Mighty Jets FC; ranked higher on goal difference, +4 to +1." */
export function explainPosition(row, rows) {
  if (!row) return '';
  const i = rows.indexOf(row);
  const parts = [];
  const sign = (c, v) => (c.includes('goal_difference') ? (v > 0 ? `+${v}` : String(v)) : String(v));
  if (row.decidedBy) {
    const d = row.decidedBy;
    const label = CRITERION_LABELS[d.criterion] || d.criterion;
    if (d.criterion === 'points') parts.push(`${d.value} points, behind ${d.above} on ${d.aboveValue}.`);
    else if (d.aboveValue !== undefined) parts.push(`Level with ${d.above} until ${label}: ${d.above} ${sign(d.criterion, d.aboveValue)}, ${row.team.name} ${sign(d.criterion, d.value)}.`);
    else parts.push(`Level with ${d.above} on every rule; placed below by ${label}${d.reason ? ` (${d.reason})` : ''}.`);
  } else if (i === 0) parts.push(`Top of the table on ${row.points} points.`);
  const below = rows[i + 1];
  if (below?.decidedBy && below.decidedBy.criterion !== 'points') {
    const d = below.decidedBy, label = CRITERION_LABELS[d.criterion] || d.criterion;
    parts.push(d.aboveValue !== undefined
      ? `Level with ${below.team.name} until ${label}: ranked higher, ${sign(d.criterion, d.aboveValue)} to ${sign(d.criterion, d.value)}.`
      : `Level with ${below.team.name} on every rule; placed above by ${label}.`);
  }
  if (row.adjustment) parts.push(`Includes a points adjustment of ${row.adjustment > 0 ? '+' : ''}${row.adjustment}.`);
  return parts.join(' ');
}

/** "Points, then goal difference, then goals scored, ..." */
export const tiebreakInWords = rules => {
  const list = parseTiebreak(rules).map(c => CRITERION_LABELS[c] || c);
  return `Clubs level on ${list[0]} are separated by ${list.slice(1).join(', then ')}.`;
};

// ── Helpers for pages ──

/** Last 5 counted results for a team, oldest first: [{ r: 'W'|'D'|'L', fixture }]. */
export function buildFormGuide(teamId, fixtures, rules = {}, n = 5) {
  return fixtures.filter(f => isCounted(f, rules) && (f.home_team_id === teamId || f.away_team_id === teamId)).sort(byKickoff).slice(-n).map(f => {
    const home = f.home_team_id === teamId;
    const us = home ? f.home_goals : f.away_goals, them = home ? f.away_goals : f.home_goals;
    return { r: us > them ? 'W' : us < them ? 'L' : 'D', fixture: f };
  });
}

const UPCOMING = ['scheduled', 'live', 'half_time'];
export function nextFixture(teamId, fixtures, now = Date.now()) {
  return fixtures.filter(f => (f.home_team_id === teamId || f.away_team_id === teamId) && f.kickoff_at
    && (LIVE.includes(f.status) || (UPCOMING.includes(f.status) && Date.parse(f.kickoff_at) > now - 2.25 * 3600e3)))
    .sort(byKickoff)[0] || null;
}
export function lastResult(teamId, fixtures, rules = {}) {
  return fixtures.filter(f => (f.home_team_id === teamId || f.away_team_id === teamId) && isCounted({ ...f, status: f.status }, { ...rules, include_live: false })).sort(byKickoff).pop() || null;
}
export function groupByMatchday(fixtures) {
  const m = new Map();
  for (const f of [...fixtures].sort((a, b) => (a.matchday ?? 999) - (b.matchday ?? 999) || (a.match_no || 0) - (b.match_no || 0))) {
    const k = f.matchday ?? 'other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return [...m.entries()].map(([matchday, list]) => ({ matchday, fixtures: list }));
}
export function groupByDate(fixtures, dayOf) {
  const m = new Map();
  for (const f of [...fixtures].sort(byKickoff)) {
    const k = f.kickoff_at ? dayOf(f.kickoff_at) : 'tbc';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return [...m.entries()].map(([date, list]) => ({ date, fixtures: list }));
}
export { byKickoff };
