// Checks for everything staff can enter. Each returns { ok, value, error }.
import { CRITERIA } from './standings.js';
import { lagosDateTimeToUtcIso } from './time.js';

export const STATUSES = ['scheduled', 'live', 'half_time', 'full_time', 'postponed', 'abandoned', 'cancelled', 'awarded'];
const GOAL_STATUSES = ['live', 'half_time', 'full_time', 'awarded', 'abandoned'];
const NO_GOALS = ['scheduled', 'postponed', 'cancelled'];
const bad = error => ({ ok: false, error });

const goal = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN);
  return Number.isInteger(n) && n >= 0 && n <= 30 ? n : NaN;
};
const text = (v, max) => (v == null ? null : String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) || null);
const httpsOrPath = v => {
  const s = text(v, 300);
  if (!s) return null;
  if (/^\/[A-Za-z0-9\-._~/%]*$/.test(s)) return s;
  try { const u = new URL(s); return u.protocol === 'https:' ? u.toString() : undefined; } catch { return undefined; }
};

/**
 * A result for one fixture. { status, homeGoals, awayGoals, resultType?,
 * attendance?, referee?, reportUrl?, note? } -> the columns to save.
 * Awarded matches use the competition's awarded score unless both goals are given.
 */
export function validateResultInput(b = {}, competition = {}, fixture = {}) {
  const status = String(b.status || '');
  if (!STATUSES.includes(status)) return bad('Choose a valid status.');
  let hg = goal(b.homeGoals), ag = goal(b.awayGoals);
  if (Number.isNaN(hg) || Number.isNaN(ag)) return bad('Goals must be whole numbers from 0 to 30.');
  if (NO_GOALS.includes(status) && (hg !== null || ag !== null)) return bad(`A ${status} match cannot have a score.`);
  if (status === 'full_time' && (hg === null || ag === null)) return bad('Full time needs both scores.');
  if (['live', 'half_time'].includes(status)) { hg ??= 0; ag ??= 0; }
  let resultType = 'normal';
  if (status === 'awarded') {
    resultType = 'awarded';
    if (hg === null || ag === null) {
      // The competition's awarded score, from the point of view of the side it is awarded to.
      const toHome = b.awardedTo !== 'away';
      hg = toHome ? Number(competition.awarded_home_goals ?? 3) : Number(competition.awarded_away_goals ?? 0);
      ag = toHome ? Number(competition.awarded_away_goals ?? 0) : Number(competition.awarded_home_goals ?? 3);
    }
  }
  if (!GOAL_STATUSES.includes(status) && !NO_GOALS.includes(status)) return bad('Unknown status.');
  const attendance = b.attendance === '' || b.attendance == null ? null : Number(b.attendance);
  if (attendance !== null && !(Number.isInteger(attendance) && attendance >= 0 && attendance <= 200000)) return bad('Attendance must be a whole number.');
  const reportUrl = httpsOrPath(b.reportUrl);
  if (reportUrl === undefined) return bad('The report link must start with https:// or /.');
  return { ok: true, value: {
    status, home_goals: hg, away_goals: ag, result_type: resultType, attendance,
    referee: text(b.referee, 80), report_url: reportUrl, note: b.note === undefined ? fixture.note ?? null : text(b.note, 200),
  } };
}

/**
 * Fixture fields staff can edit. Dates and times arrive as Nigerian time
 * ({ date: 'YYYY-MM-DD' or 'DD/MM/YYYY', time: 'HH:MM' }) and are stored UTC.
 */
export function validateFixtureInput(b = {}, { partial = false } = {}) {
  const v = {};
  if (b.date !== undefined || b.time !== undefined) {
    if (!b.date && !b.time) v.kickoff_at = null;
    else {
      const iso = lagosDateTimeToUtcIso(b.date, b.time || '16:00');
      if (!iso) return bad('Enter a real date (YYYY-MM-DD) and time (HH:MM, 24-hour, Nigerian time).');
      v.kickoff_at = iso;
    }
  }
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return bad('Choose a valid status.'); v.status = b.status; }
  if (b.venueId !== undefined) { const n = b.venueId === null || b.venueId === '' ? null : Number(b.venueId); if (n !== null && !Number.isInteger(n)) return bad('Choose a venue.'); v.venue_id = n; }
  if (b.note !== undefined) v.note = text(b.note, 200);
  if (b.referee !== undefined) v.referee = text(b.referee, 80);
  if (b.isPublished !== undefined) v.is_published = b.isPublished ? 1 : 0;
  if (b.attendance !== undefined) {
    const a = b.attendance === '' || b.attendance === null ? null : Number(b.attendance);
    if (a !== null && !(Number.isInteger(a) && a >= 0 && a <= 200000)) return bad('Attendance must be a whole number.');
    v.attendance = a;
  }
  if (b.reportUrl !== undefined) { const u = httpsOrPath(b.reportUrl); if (u === undefined) return bad('The report link must start with https:// or /.'); v.report_url = u; }
  if (!partial) {
    for (const k of ['homeTeamId', 'awayTeamId']) if (!Number.isInteger(Number(b[k])) || !b[k]) return bad('Choose both teams.');
    if (Number(b.homeTeamId) === Number(b.awayTeamId)) return bad('A team cannot play itself.');
    v.home_team_id = Number(b.homeTeamId); v.away_team_id = Number(b.awayTeamId);
    if (b.matchday !== undefined && b.matchday !== null && b.matchday !== '') {
      const m = Number(b.matchday);
      if (!Number.isInteger(m) || m < 1 || m > 60) return bad('Matchday must be a whole number.');
      v.matchday = m;
    }
  }
  return { ok: true, value: v };
}

/** Points, tie-break order and zones. Returns the cleaned rules. */
export function validateRules(b = {}, teamCount = 8) {
  const v = {};
  for (const [k, col] of [['pointsWin', 'points_win'], ['pointsDraw', 'points_draw'], ['pointsLoss', 'points_loss']]) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 0 || n > 5) return bad('Points must be whole numbers from 0 to 5.');
    v[col] = n;
  }
  if (b.tiebreakOrder !== undefined) {
    const t = b.tiebreakOrder;
    if (!Array.isArray(t) || !t.length) return bad('Choose a tie-break order.');
    if (t.some(c => !CRITERIA.includes(c))) return bad('Unknown tie-break rule.');
    if (new Set(t).size !== t.length) return bad('Each tie-break rule can only be used once.');
    if (t[0] !== 'points') return bad('Points must come first.');
    v.tiebreak_order = JSON.stringify(t);
  }
  if (b.zones !== undefined) {
    if (!Array.isArray(b.zones) || b.zones.length > 6) return bad('Up to 6 zones.');
    const zones = [];
    for (const z of b.zones) {
      const from = Number(z.from), to = Number(z.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > teamCount || from > to) return bad(`Zones must be positions from 1 to ${teamCount}.`);
      const label = text(z.label, 40), colour = String(z.colour || '');
      if (!label) return bad('Each zone needs a label.');
      if (!/^#[0-9a-fA-F]{6}$/.test(colour)) return bad('Zone colours must look like #1A7F37.');
      if (zones.some(o => from <= o.to && to >= o.from)) return bad('Zones cannot overlap.');
      zones.push({ from, to, label, colour });
    }
    v.zones = JSON.stringify(zones.sort((a, b) => a.from - b.from));
  }
  if (b.includeLive !== undefined) v.include_live = b.includeLive ? 1 : 0;
  for (const [k, col] of [['awardedHomeGoals', 'awarded_home_goals'], ['awardedAwayGoals', 'awarded_away_goals']]) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 0 || n > 30) return bad('The awarded score must be whole numbers from 0 to 30.');
    v[col] = n;
  }
  return { ok: true, value: v };
}
