import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { recommendations, markDone, writeAiSummary } from '../_lib/analyticsInsights.js';

// Admin › Analytics › Recommendations (permission analytics.view_all).
// GET                                  -- findings ("at a glance") and recommendations with step-by-step guides (last 28 days)
// POST { action: 'done', id }          -- "Mark as done": hidden for 30 days
// POST { action: 'undo', id }          -- "Show again"
// POST { action: 'ai_summary' }        -- write the optional Claude summary now (only when switched on, handover A28)
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return json(await recommendations(env));
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const who = admin.name || admin.email || 'Admin';
  if (body.action === 'done' || body.action === 'undo') {
    const id = String(body.id || '').slice(0, 200);
    if (!id) return json({ error: 'Missing id' }, 400);
    await markDone(env.DB, id, who, body.action === 'undo');
    await logAdminAction(env.DB, admin, body.action === 'done' ? 'recommendation_done' : 'recommendation_undo', id);
    return json({ ok: true });
  }
  if (body.action === 'ai_summary') {
    const r = await writeAiSummary(env, who);
    if (r.error) return json(r, 409);
    await logAdminAction(env.DB, admin, 'ai_summary', r.model);
    return json({ ok: true, summary: r });
  }
  return json({ error: 'Unknown action' }, 400);
}
