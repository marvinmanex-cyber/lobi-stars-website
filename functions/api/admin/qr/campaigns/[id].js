import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { logAdminAction } from '../../../_lib/adminSession.js';
import { ensureQrSchema, CHANNELS } from '../../../_lib/qr.js';
import { stripTags } from '../../../_lib/programme.js';

// PATCH /api/admin/qr/campaigns/:id { label?, channel?, notes?, is_active? }
// The short code can never change and campaigns are never deleted: printed QR
// codes must keep working. Switching one off only removes it from the active list.
export async function onRequestPatch({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureQrSchema(db);
    const c = await db.prepare(`SELECT * FROM qr_campaigns WHERE id = ?`).bind(Number(params.id) || 0).first();
    if (!c) return Response.json({ error: 'Campaign not found' }, { status: 404 });
    const b = await request.json().catch(() => ({}));
    if (b.code !== undefined && String(b.code).toLowerCase() !== c.code) return Response.json({ error: 'The short code can never be changed (printed QR codes use it).' }, { status: 400 });
    const next = { label: c.label, channel: c.channel, notes: c.notes, is_active: c.is_active };
    if (b.label !== undefined) { next.label = stripTags(b.label).slice(0, 80); if (!next.label) return Response.json({ error: 'The name cannot be empty.' }, { status: 400 }); }
    if (b.channel !== undefined) { if (!CHANNELS.includes(b.channel)) return Response.json({ error: 'Unknown channel.' }, { status: 400 }); next.channel = b.channel; }
    if (b.notes !== undefined) next.notes = stripTags(b.notes).slice(0, 500) || null;
    if (b.is_active !== undefined) next.is_active = b.is_active ? 1 : 0;
    await db.prepare(`UPDATE qr_campaigns SET label = ?, channel = ?, notes = ?, is_active = ? WHERE id = ?`).bind(next.label, next.channel, next.notes, next.is_active, c.id).run();
    const changes = Object.keys(next).filter(k => next[k] !== c[k]).map(k => `${k}: ${c[k] ?? '–'} → ${next[k] ?? '–'}`);
    if (changes.length) await logAdminAction(db, admin, 'qr_campaign_update', `/p/${c.code}: ${changes.join('; ')}`);
    return Response.json({ ok: true, campaign: { ...c, ...next } });
  } catch (err) {
    console.error('[admin qr] update', err);
    return Response.json({ error: 'Could not save the campaign.' }, { status: 500 });
  }
}
