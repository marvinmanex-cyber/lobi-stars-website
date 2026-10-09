// Man of the Match voting (Lobi Stars HOME games only).
//
// Rules, all enforced here on the server with the server clock:
// - only signed-in fans with a confirmed email can vote;
// - voting is open only while the match is LIVE (kick-off to full time);
// - one vote per fan per match (UNIQUE (event_id, member_id)), never changed;
// - only players in that match's squad (picked by staff) can be voted for;
// - vote counts stay hidden until full time, then the leaderboard is shown.
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
export async function leaderboard(db, eventId, squad) {
  const { results } = await db.prepare(
    `SELECT player_slug, MAX(player_name) AS player_name, COUNT(*) AS votes FROM motm_votes WHERE event_id = ? GROUP BY player_slug`
  ).bind(eventId).all();
  const total = results.reduce((n, r) => n + r.votes, 0);
  const players = squadPlayers(squad);
  const rows = players.map(p => ({ slug: p.slug, name: p.name, number: p.number, position: p.position, photo: p.photo || null, votes: results.find(r => r.player_slug === p.slug)?.votes || 0 }));
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
