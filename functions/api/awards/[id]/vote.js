import { currentFan } from '../../_lib/matchdayFan.js';
import { rateLimit, tooMany, clientIp } from '../../_lib/fans.js';
import { ensureAwardsSchema, awardState, totalAwardVoters } from '../../_lib/awards.js';
import { recordServerEvent } from '../../_lib/analytics.js';

const noStore = { 'Cache-Control': 'no-store' };

// POST /api/awards/:id/vote { nominee: <id> } -- the fan's one vote for this award.
export async function onRequestPost({ request, env, params }) {
  await ensureAwardsSchema(env.DB);
  const award = await env.DB.prepare(`SELECT * FROM awards WHERE id = ?`).bind(String(params.id || '')).first();
  if (!award) return Response.json({ error: 'Award not found.' }, { status: 404 });
  const fan = await currentFan(request, env);
  if (!fan) return Response.json({ error: 'Please log in to vote.', code: 'login' }, { status: 401 });
  if (!fan.email_verified) return Response.json({ error: 'Please confirm your email address before voting.', code: 'unverified' }, { status: 403 });
  if (!(await rateLimit(env.DB, `award:${fan.id}:${clientIp(request)}`, 20, 600))) return tooMany();

  const state = awardState(award);
  if (state === 'upcoming') return Response.json({ error: 'Voting has not opened yet.', code: 'before' }, { status: 409 });
  if (state !== 'open') return Response.json({ error: 'Voting has closed for this award.', code: 'closed' }, { status: 409 });

  let b;
  try { b = await request.json(); } catch { b = {}; }
  const nominee = await env.DB.prepare(`SELECT id, label FROM award_nominees WHERE id = ? AND award_id = ?`).bind(Number(b.nominee) || 0, award.id).first();
  if (!nominee) return Response.json({ error: 'Please choose one of the nominees.' }, { status: 400 });

  const at = new Date().toISOString();
  // UNIQUE (award_id, member_id) is the final guard against double votes.
  const res = await env.DB.prepare(
    `INSERT INTO award_votes (award_id, member_id, nominee_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (award_id, member_id) DO NOTHING`
  ).bind(award.id, fan.id, nominee.id, at).run();
  if (!res.meta?.changes) return Response.json({ error: 'You have already voted for this award.', code: 'voted' }, { status: 409 });
  await recordServerEvent(env, 'award_vote', award.id, request);
  return Response.json({ ok: true, myVote: { nominee: nominee.id, at }, totalVoters: await totalAwardVoters(env.DB, award.id) }, { headers: noStore });
}
