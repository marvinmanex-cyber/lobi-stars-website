import { ensureTable, loadMatch, toPublic, isHomeGame } from '../../_lib/matchCentre.js';
import { matchSlug } from '../../_lib/matchSlug.js';
import { readSession } from '../../_lib/session.js';
import { ensureFanSchema, rateLimit, tooMany, clientIp } from '../../_lib/fans.js';
import { ensureMotmSchema, votingState, squadPlayers, totalVoters, leaderboard } from '../../_lib/motm.js';
import { recordServerEvent } from '../../_lib/analytics.js';

const noStore = { 'Cache-Control': 'no-store' };

async function findHomeMatch(env, slug) {
  await ensureTable(env.DB);
  const key = String(slug || '').toLowerCase();
  const { results } = await env.DB.prepare(`SELECT * FROM events WHERE active = 1`).all();
  const event = results.find(e => e.id.toLowerCase() === key || matchSlug(e) === key);
  if (!event || !isHomeGame(event)) return null;
  const m = await loadMatch(env.DB, event.id); // also applies the 2h15 auto-close
  return toPublic(m.event, m.centre);
}

async function currentFan(request, env) {
  const id = await readSession(request, env.SESSION_SECRET);
  if (!id) return null;
  await ensureFanSchema(env.DB);
  return env.DB.prepare(`SELECT id, first_name, email_verified FROM members WHERE id = ?`).bind(id).first();
}

// GET /api/matches/:slug/motm -- voting state, squad, the fan's own vote,
// the number of voters and (only after full time) the leaderboard.
export async function onRequestGet({ request, env, params }) {
  const match = await findHomeMatch(env, params.slug);
  if (!match) return Response.json({ error: 'Man of the Match voting is only for Lobi Stars home games.' }, { status: 404 });
  await ensureMotmSchema(env.DB);
  const state = votingState(match.status);
  const fan = await currentFan(request, env);
  const mine = fan ? await env.DB.prepare(`SELECT player_slug, player_name, created_at FROM motm_votes WHERE event_id = ? AND member_id = ?`).bind(match.id, fan.id).first() : null;
  return Response.json({
    state,
    status: match.status,
    kickoff: match.event_date,
    players: squadPlayers(match.squad),
    totalVoters: await totalVoters(env.DB, match.id),
    fan: fan ? { firstName: fan.first_name, verified: !!fan.email_verified } : null,
    myVote: mine ? { slug: mine.player_slug, name: mine.player_name, at: mine.created_at } : null,
    // Counts and rankings stay secret until full time.
    results: state === 'closed' ? await leaderboard(env.DB, match.id, match.squad) : null,
    serverTime: new Date().toISOString(),
  }, { headers: noStore });
}

// POST /api/matches/:slug/motm { player: <slug> } -- cast the fan's one vote.
export async function onRequestPost({ request, env, params }) {
  const match = await findHomeMatch(env, params.slug);
  if (!match) return Response.json({ error: 'Man of the Match voting is only for Lobi Stars home games.' }, { status: 404 });
  const fan = await currentFan(request, env);
  if (!fan) return Response.json({ error: 'Please log in to vote.', code: 'login' }, { status: 401 });
  if (!fan.email_verified) return Response.json({ error: 'Please confirm your email address before voting.', code: 'unverified' }, { status: 403 });
  if (!(await rateLimit(env.DB, `motm:${fan.id}:${clientIp(request)}`, 20, 600))) return tooMany();

  const state = votingState(match.status);
  if (state === 'before') return Response.json({ error: 'Voting opens at kick-off.', code: 'before' }, { status: 409 });
  if (state !== 'open') return Response.json({ error: 'Voting has closed for this match.', code: 'closed' }, { status: 409 });

  let b;
  try { b = await request.json(); } catch { b = {}; }
  const player = squadPlayers(match.squad).find(p => p.slug === String(b.player || ''));
  if (!player) return Response.json({ error: 'Please choose a player from the matchday squad.' }, { status: 400 });

  await ensureMotmSchema(env.DB);
  const at = new Date().toISOString();
  // The UNIQUE (event_id, member_id) constraint is the final guard against double votes.
  const res = await env.DB.prepare(
    `INSERT INTO motm_votes (event_id, member_id, player_slug, player_name, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (event_id, member_id) DO NOTHING`
  ).bind(match.id, fan.id, player.slug, player.name, at).run();
  if (!res.meta?.changes) {
    const mine = await env.DB.prepare(`SELECT player_name FROM motm_votes WHERE event_id = ? AND member_id = ?`).bind(match.id, fan.id).first();
    return Response.json({ error: `You have already voted for ${mine?.player_name || 'a player'} in this match.`, code: 'voted' }, { status: 409 });
  }
  await recordServerEvent(env, 'motm_vote', match.slug, request);
  return Response.json({ ok: true, myVote: { slug: player.slug, name: player.name, at }, totalVoters: await totalVoters(env.DB, match.id) }, { headers: noStore });
}
