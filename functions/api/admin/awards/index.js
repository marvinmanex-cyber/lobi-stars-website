import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureAwardsSchema, listAwards, parseAward, awardState, awardResults, AWARD_TYPES } from '../../_lib/awards.js';
import { awardsAssets } from '../../_lib/awardsData.js';

const noStore = { 'Cache-Control': 'no-store' };

// GET /api/admin/awards -- every award with live vote counts (staff only),
// plus the squad and partner lists for the form.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const { roster, partners } = await awardsAssets(env, request);
  const awards = await listAwards(env.DB);
  for (const a of awards) {
    a.state = awardState(a);
    a.results = await awardResults(env.DB, a, a.nominees);
  }
  return Response.json({
    awards, types: AWARD_TYPES,
    players: roster.map(p => ({ slug: p.slug, name: p.name, number: p.number ?? null, isSample: !!p.isSample })),
    partners: partners.map(p => ({ slug: p.slug, name: p.name, hasLogo: !!p.logo })),
  }, { headers: noStore });
}

// POST /api/admin/awards -- create an award with its nominees.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const { roster } = await awardsAssets(env, request);
  const { value: v, error } = parseAward(b, roster);
  if (error) return Response.json({ error }, { status: 400 });
  await ensureAwardsSchema(env.DB);
  const id = `${v.type}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO awards (id, type, period, opens_at, closes_at, sponsor_slug) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, v.type, v.period, v.opens_at, v.closes_at, v.sponsor_slug),
    ...v.nominees.map(n => env.DB.prepare(`INSERT INTO award_nominees (award_id, label, player_slug, youtube_id, sort) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, n.label, n.player_slug, n.youtube_id, n.sort)),
  ]);
  await logAdminAction(env.DB, admin, 'award_create', `${AWARD_TYPES[v.type]} ${v.period}`);
  return Response.json({ ok: true, id }, { headers: noStore });
}
