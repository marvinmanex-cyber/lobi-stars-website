// Man of the Match voting (Lobi Stars HOME games only).
//
// Rules, all enforced here on the server with the server clock:
// - only signed-in fans with a confirmed email can vote;
// - voting opens at the scheduled kick-off and closes 1 hour 50 minutes later (4:00pm to 5:50pm),
//   fixed times, so the winner can be announced in the stadium;
// - one vote per fan per match (UNIQUE (event_id, member_id)), never changed;
// - only players on the field can be voted for: the starting XI, and substitutes once they come on;
// - vote counts stay hidden until 5 minutes after voting closes, then the leaderboard is shown.
import { LIVE_STATUSES } from './matchCentre.js';

let ready = false;
export async function ensureMotmSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS motm_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      member_id TEXT NOT NULL,          -- becomes 'deleted-<id>' if the fan asks to be erased
      player_slug TEXT NOT NULL,
      player_name TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (event_id, member_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_motm_votes_event ON motm_votes(event_id)`),
  ]);
  ready = true;
}

/** 'before' (not kicked off), 'open' (live), 'closed' (full time) or 'off' (postponed/cancelled). */
export function votingState(status) {
  if (LIVE_STATUSES.includes(status)) return 'open';
  if (status === 'full-time') return 'closed';
  if (status === 'postponed' || status === 'cancelled') return 'off';
  return 'before';
}

const MIN = 60e3;
// Fixed times, decided by the club (8 Nov 2026): voting opens at the scheduled kick-off and closes
// 1 hour 50 minutes later (4:00pm to 5:50pm for a 4pm kick-off), whatever happens in the match.
// Nothing staff press opens it earlier or closes it sooner.
export const OPEN_FOR_MIN = 110;
const REVEAL_AFTER_MS = 5 * MIN;         // fans see the result 5 minutes after voting closes
const iso = t => (Number.isFinite(t) ? new Date(t).toISOString() : null);

/** When voting opens and closes, on the server clock. Returns { state: before|open|closed|off, opensAt, closesAt, revealed }. */
export function votingWindow(m, now = Date.now()) {
  const status = m.status || 'scheduled';
  if (status === 'postponed' || status === 'cancelled') return { state: 'off', opensAt: null, closesAt: null, revealed: false };
  const opensAt = Date.parse(m.event_date), closesAt = opensAt + OPEN_FOR_MIN * MIN;
  const win = { opensAt: iso(opensAt), closesAt: iso(closesAt) };
  if (now < opensAt) return { state: 'before', ...win, revealed: false };
  if (now < closesAt) return { state: 'open', ...win, revealed: false };
  return { state: 'closed', ...win, revealed: now >= closesAt + REVEAL_AFTER_MS };
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Did this substitution bring the player on? The timeline's player is the one coming on ("on for X" goes in the detail). */
function cameOn(p, e) {
  const who = norm(String(e.player || '').split(/\s+(?:on for|for|replaces|replacing)\s+/i)[0]);
  if (!who) return false;
  const name = norm(p.name);
  if (who === name || who.includes(name)) return true;
  if (p.number != null && new RegExp(`(^|\\s)#?${p.number}(\\s|$)`).test(String(e.player))) return true;
  const said = who.split(' ');
  return name.split(' ').some(t => t.length > 2 && said.includes(t));
}
/** Players fans can vote for: the starting XI, and each substitute once a substitution brings them on. */
export function playersOnField(squad, timeline, side = 'home') {
  const s = squad || {};
  const subs = (timeline || []).filter(e => e.type === 'sub' && (!e.team || e.team === side));
  return [
    ...(s.starting || []).map(p => ({ ...p, role: 'Starting XI' })),
    ...(s.bench || []).filter(p => subs.some(e => cameOn(p, e))).map(p => ({ ...p, role: 'Came on' })),
  ];
}

/** The latest Media Centre line-up for this match (draft or published), as a squad. Null if there isn't one. */
export async function mediaLineup(db, eventId) {
  try {
    const r = await db.prepare(`SELECT status, data_json, updated_at FROM mc_items WHERE kind = 'lineup' AND ref = ? AND status NOT IN ('rejected', 'unpublished') ORDER BY updated_at DESC LIMIT 1`).bind(eventId).first();
    if (!r) return null;
    const d = JSON.parse(r.data_json || '{}');
    const pick = list => (Array.isArray(list) ? list : []).filter(p => p && p.slug && p.name).map(p => ({ slug: String(p.slug), name: String(p.name), number: p.number ?? null, position: p.position || '', photo: null }));
    const squad = { starting: pick(d.starting), bench: pick(d.subs) };
    return squad.starting.length ? { ...squad, status: r.status, updatedAt: r.updated_at } : null;
  } catch { return null; } // no Media Centre yet
}
/**
 * The squad voting uses: the one saved in Live Match Control (a published line-up goes there too);
 * if that's empty, the Media Centre line-up, so a line-up picked there counts even before it's published.
 */
export async function votingSquad(db, match) {
  if (match.squad?.starting?.length) return match.squad;
  const lu = await mediaLineup(db, match.id);
  return lu ? { starting: lu.starting, bench: lu.bench } : { starting: [], bench: [] };
}
export const lobiSide = match => (/lobi stars/i.test(match.home_team || '') ? 'home' : 'away');

/** Every squad player (starting XI then bench), for the voting cards. */
export function squadPlayers(squad) {
  const s = squad || {};
  return [
    ...(s.starting || []).map(p => ({ ...p, role: 'Starting XI' })),
    ...(s.bench || []).map(p => ({ ...p, role: 'Substitute' })),
  ];
}

export async function totalVoters(db, eventId) {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM motm_votes WHERE event_id = ?`).bind(eventId).first()).n || 0;
}

/**
 * The leaderboard: every squad player ranked by votes, with % and the
 * winner(s). Joint winners when the top vote count is shared.
 */
export async function leaderboard(db, eventId, squad, players = null) {
  const { results } = await db.prepare(
    `SELECT player_slug, MAX(player_name) AS player_name, COUNT(*) AS votes FROM motm_votes WHERE event_id = ? GROUP BY player_slug`
  ).bind(eventId).all();
  const total = results.reduce((n, r) => n + r.votes, 0);
  const list = players || squadPlayers(squad);
  const rows = list.map(p => ({ slug: p.slug, name: p.name, number: p.number, position: p.position, photo: p.photo || null, votes: results.find(r => r.player_slug === p.slug)?.votes || 0 }));
  // Votes for a player later removed from the squad still count.
  for (const r of results) if (!rows.some(x => x.slug === r.player_slug)) rows.push({ slug: r.player_slug, name: r.player_name || r.player_slug, number: null, position: '', photo: null, votes: r.votes });
  rows.sort((a, b) => b.votes - a.votes || String(a.name).localeCompare(String(b.name)));
  const top = rows[0]?.votes || 0;
  return {
    total,
    rows: rows.map(r => ({ ...r, pct: total ? Math.round((r.votes / total) * 1000) / 10 : 0, winner: top > 0 && r.votes === top })),
    winners: top > 0 ? rows.filter(r => r.votes === top).map(r => r.slug) : [],
  };
}

/**
 * Man of the Match awards per player across all finished home games:
 * { [playerSlug]: count }. Joint winners each get an award.
 */
export async function awardCounts(db) {
  await ensureMotmSchema(db);
  const { results } = await db.prepare(
    `SELECT v.event_id, v.player_slug, COUNT(*) AS votes FROM motm_votes v
     JOIN match_centre m ON m.event_id = v.event_id AND m.status = 'full-time'
     GROUP BY v.event_id, v.player_slug`
  ).all();
  const byEvent = new Map();
  for (const r of results) {
    const list = byEvent.get(r.event_id) || [];
    list.push(r); byEvent.set(r.event_id, list);
  }
  const awards = {};
  for (const list of byEvent.values()) {
    const top = Math.max(...list.map(r => r.votes));
    for (const r of list) if (r.votes === top) awards[r.player_slug] = (awards[r.player_slug] || 0) + 1;
  }
  return awards;
}
