import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureAwardsSchema, parseAward, totalAwardVoters, AWARD_TYPES } from '../../_lib/awards.js';
import { awardsAssets } from '../../_lib/awardsData.js';

const noStore = { 'Cache-Control': 'no-store' };

async function find(env, id) {
  await ensureAwardsSchema(env.DB);
  return env.DB.prepare(`SELECT * FROM awards WHERE id = ?`).bind(String(id || '')).first();
}

// PUT /api/admin/awards/:id -- edit an award. Dates, month/season and sponsor
// can always change; the nominees can only change before anyone has voted.
export async function onRequestPut({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const award = await find(env, params.id);
  if (!award) return Response.json({ error: 'Award not found.' }, { status: 404 });
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const { roster } = await awardsAssets(env, request);
  const { value: v, error } = parseAward({ ...b, type: award.type }, roster);
  if (error) return Response.json({ error }, { status: 400 });
  const voted = await totalAwardVoters(env.DB, award.id);
  const stmts = [env.DB.prepare(`UPDATE awards SET period = ?, opens_at = ?, closes_at = ?, sponsor_slug = ? WHERE id = ?`)
    .bind(v.period, v.opens_at, v.closes_at, v.sponsor_slug, award.id)];
  if (!voted) {
    stmts.push(env.DB.prepare(`DELETE FROM award_nominees WHERE award_id = ?`).bind(award.id));
    for (const n of v.nominees) stmts.push(env.DB.prepare(`INSERT INTO award_nominees (award_id, label, player_slug, youtube_id, sort) VALUES (?, ?, ?, ?, ?)`)
      .bind(award.id, n.label, n.player_slug, n.youtube_id, n.sort));
  }
  await env.DB.batch(stmts);
  await logAdminAction(env.DB, admin, 'award_edit', `${AWARD_TYPES[award.type]} ${v.period}`);
  return Response.json({ ok: true, nomineesLocked: !!voted }, { headers: noStore });
}

// DELETE /api/admin/awards/:id -- removes the award, its nominees and its votes.
export async function onRequestDelete({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const award = await find(env, params.id);
  if (!award) return Response.json({ error: 'Award not found.' }, { status: 404 });
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM award_votes WHERE award_id = ?`).bind(award.id),
    env.DB.prepare(`DELETE FROM award_nominees WHERE award_id = ?`).bind(award.id),
    env.DB.prepare(`DELETE FROM awards WHERE id = ?`).bind(award.id),
  ]);
  await logAdminAction(env.DB, admin, 'award_delete', `${AWARD_TYPES[award.type]} ${award.period}`);
  return Response.json({ ok: true }, { headers: noStore });
}
