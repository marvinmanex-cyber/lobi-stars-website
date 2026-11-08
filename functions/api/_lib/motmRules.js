// Man of the Match: the voting rules, as pure functions (no database), so the status API, the vote
// API, Matchday Live, the admin panel and the tests all use one set of rules.
//
// - Lobi Stars HOME games only; postponed or abandoned (cancelled) matches get no vote.
// - Opens automatically at kick-off and closes VOTING_OPEN_MINUTES later (4:00 pm to 5:50 pm for a
//   4 pm kick-off), on the club clock (Africa/Lagos). If kick-off moves, both times move with it.
// - Votable: the starting XI, and a substitute only from the moment his substitution was recorded.
// - One vote per verified fan account per match (UNIQUE (event_id, member_id) in the database).
// - Accounts created less than HOLD_NEW_ACCOUNTS_HOURS before kick-off: vote saved as "held", not counted.
// - Winner: most valid votes; level on votes = whoever reached that total first.

import { effectiveKickoff } from './kickoff.js';

export const VOTING_OPEN_MINUTES = 110;
export const HOLD_NEW_ACCOUNTS_HOURS = 24;
export const CLUB_TZ = 'Africa/Lagos';
export const DEFAULT_SPONSOR = { show: true, name: 'Mr. Moses Orkuma', line: 'Proudly sponsored by Mr. Moses Orkuma', photoUrl: null };
const MIN = 60e3;

/** "4:00 pm" on the club clock. */
export const clubTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: CLUB_TZ }).replace(/\s/g, ' ');

/**
 * The voting window for a match: { status, opensAt, closesAt }.
 * status: upcoming | open | closed | cancelled | not_home | no_match
 */
export function votingWindow(m, now = Date.now()) {
  if (!m) return { status: 'no_match', opensAt: null, closesAt: null };
  const opens = effectiveKickoff(m.event_date), closes = opens + VOTING_OPEN_MINUTES * MIN; // 4:00 pm if no kick-off time was entered
  const win = { opensAt: new Date(opens).toISOString(), closesAt: new Date(closes).toISOString() };
  if (!m.is_home) return { status: 'not_home', ...win };
  if (m.status === 'postponed' || m.status === 'cancelled') return { status: 'cancelled', ...win };
  return { status: now < opens ? 'upcoming' : now < closes ? 'open' : 'closed', ...win };
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Did this substitution bring the player on? The timeline's player is the one coming on ("on for X" goes in the detail). */
export function cameOn(p, e) {
  const who = norm(String(e.player || '').split(/\s+(?:on for|for|replaces|replacing)\s+/i)[0]);
  if (!who) return false;
  const name = norm(p.name);
  if (who === name || who.includes(name)) return true;
  if (p.number != null && new RegExp(`(^|\\s)#?${p.number}(\\s|$)`).test(String(e.player))) return true;
  const said = who.split(' ');
  return name.split(' ').some(t => t.length > 2 && said.includes(t));
}

/**
 * Players fans can vote for at time `at`: the starting XI, and each substitute from the time his
 * substitution was recorded (entries saved before times were kept count as already on).
 * Each: { slug, name, number, position, photo, role, since }.
 */
export function candidates(squad, timeline, side = 'home', at = Date.now()) {
  const s = squad || {};
  const subs = (timeline || []).filter(e => e.type === 'sub' && (!e.team || e.team === side));
  const out = (s.starting || []).map(p => ({ ...p, role: 'Starting XI', since: null }));
  for (const p of s.bench || []) {
    const times = subs.filter(e => cameOn(p, e)).map(e => (e.recordedAt ? Date.parse(e.recordedAt) : 0)).filter(t => t <= at);
    if (times.length) out.push({ ...p, role: 'Came on', since: Math.min(...times) ? new Date(Math.min(...times)).toISOString() : null });
  }
  return out;
}

/** Is this account's vote held (not counted)? Accounts made less than 24 hours before kick-off. */
export const isHeldAccount = (accountCreatedAt, kickoffIso) => !accountCreatedAt || Date.parse(accountCreatedAt) > Date.parse(kickoffIso) - HOLD_NEW_ACCOUNTS_HOURS * 3600e3;

/**
 * Counts the votes. votes: [{ player_slug, created_at, status }]. Only counted votes, cast inside the
 * window, for a player who was votable at that moment, are valid.
 * Returns { totalVotes, rows: [{ slug, name, number, position, photo, votes, percent, reachedAt }], tieBroken, held, invalid }.
 */
export function tally({ votes, players, opensAt, closesAt }) {
  const opens = Date.parse(opensAt), closes = Date.parse(closesAt);
  const bySlug = new Map(players.map(p => [p.slug, p]));
  const counted = new Map();
  let held = 0, invalid = 0;
  const sorted = [...votes].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  for (const v of sorted) {
    if (v.status === 'held') { held++; continue; }
    const t = Date.parse(v.created_at), p = bySlug.get(v.player_slug);
    if (!p || !(t >= opens && t < closes) || (p.since && t < Date.parse(p.since))) { invalid++; continue; }
    const c = counted.get(p.slug) || { votes: 0, reachedAt: null };
    c.votes++; c.reachedAt = v.created_at; // the time this player reached his current total
    counted.set(p.slug, c);
  }
  const totalVotes = [...counted.values()].reduce((n, c) => n + c.votes, 0);
  const rows = [...counted.entries()].map(([slug, c]) => {
    const p = bySlug.get(slug);
    return { slug, name: p.name, number: p.number ?? null, position: p.position || '', photo: p.photo || null, votes: c.votes, percent: totalVotes ? Math.round((c.votes / totalVotes) * 100) : 0, reachedAt: c.reachedAt };
  }).sort((a, b) => b.votes - a.votes || Date.parse(a.reachedAt) - Date.parse(b.reachedAt));
  const tieBroken = rows.length > 1 && rows[0].votes === rows[1].votes;
  return { totalVotes, rows, tieBroken, held, invalid };
}

/** The sponsor as shown, or null when "Show sponsor" is off. */
export function sponsorView(saved) {
  const s = { ...DEFAULT_SPONSOR, ...(saved || {}) };
  if (!s.show) return null;
  return { name: s.name || DEFAULT_SPONSOR.name, line: s.line || DEFAULT_SPONSOR.line, photoUrl: s.photoUrl || null };
}

const pub = r => r && { slug: r.slug, name: r.name, number: r.number, position: r.position, photoUrl: r.photo || null, votes: r.votes, percent: r.percent };
/** What is saved once at closing time: the winner and the top 3 (no message: that is built when shown, with the current sponsor). */
export function announcementData(t, announcedAt) {
  return { winnerSlug: t.rows[0]?.slug || null, winner: pub(t.rows[0]) || null, top3: t.rows.slice(0, 3).map(pub), totalVotes: t.totalVotes, tieBroken: t.tieBroken, announcedAt };
}

/** The announcement as fans see it, with the message filled in. */
export function announcementView(data, { opponent, venue = 'McCarthy Stadium', sponsor = null }) {
  const w = data.winner;
  if (!w) return { winner: null, top3: [], totalVotes: data.totalVotes || 0, tieBroken: false, announcedAt: data.announcedAt, message: 'No Man of the Match this game.' };
  const first = String(w.name).split(' ')[0];
  const lines = [
    `Your Man of the Match: ${w.name}!`,
    `Lobi Stars fans have spoken. ${w.name}${w.number != null ? ` (#${w.number})` : ''} is the Man of the Match for Lobi Stars vs ${opponent} at ${venue}, with ${w.votes} vote${w.votes === 1 ? '' : 's'} (${w.percent}% of the fan vote). Congratulations, ${first}!`,
  ];
  if (sponsor) lines.push(`The Lobi Stars Man of the Match award is proudly sponsored by ${sponsor.name}.`);
  return { winner: w, top3: data.top3, totalVotes: data.totalVotes, tieBroken: !!data.tieBroken, announcedAt: data.announcedAt, message: lines.join('\n') };
}
