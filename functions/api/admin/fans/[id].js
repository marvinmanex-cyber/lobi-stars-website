import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { SOURCES, ensureContactsSchema, unsubscribeContact, deleteContactEverywhere } from '../../_lib/contacts.js';
import { maskEmail, maskPhone } from '../../_lib/fanQuery.js';

// GET /api/admin/fans/:id -- one person and every interaction they've had.
export async function onRequestGet({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureContactsSchema(env.DB);
  const c = await env.DB.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(params.id).first();
  if (!c) return Response.json({ error: 'Not found' }, { status: 404 });
  const { results } = await env.DB.prepare(`SELECT source, ref_table, seen_at, label FROM contact_sources WHERE contact_id = ? ORDER BY seen_at DESC`).bind(c.id).all();
  // Their in-seat food orders (paid), matched by email or phone.
  let food = [];
  try {
    const { results: fo } = await env.DB.prepare(
      `SELECT ref, order_status, total_kobo, items_json, seat, stand, paid_iso, created_iso FROM food_orders
       WHERE payment_status = 'paid' AND ((? != '' AND lower(email) = ?) OR (? != '' AND phone = ?)) ORDER BY created_iso DESC LIMIT 50`
    ).bind(c.email || '', (c.email || '').toLowerCase(), c.phone || '', c.phone || '').all();
    food = fo.map(o => { let items = []; try { items = JSON.parse(o.items_json); } catch {} return { ref: o.ref, status: o.order_status, totalKobo: o.total_kobo, items: items.map(i => `${i.qty}× ${i.name}`).join(', '), seat: [o.seat, o.stand].filter(Boolean).join(' · '), at: o.paid_iso || o.created_iso }; });
  } catch { /* no food orders yet */ }
  return Response.json({
    contact: {
      id: c.id, firstName: c.first_name || '', surname: c.surname || '', state: c.state || '',
      email: admin.canExport ? c.email || '' : maskEmail(c.email),
      phone: admin.canExport ? c.phone || '' : maskPhone(c.phone),
      firstSource: SOURCES[c.first_source] || c.first_source, firstSeen: c.first_seen, lastSeen: c.last_seen,
      marketingConsent: !!c.marketing_consent, unsubscribedAt: c.unsubscribed_at,
    },
    history: results.map(h => ({ source: SOURCES[h.source] || h.source, at: h.seen_at, detail: h.label || '' })),
    foodOrders: food,
    canExport: admin.canExport,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST /api/admin/fans/:id { action: 'unsubscribe' } -- marketing opt-out.
export async function onRequestPost({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  let b; try { b = await request.json(); } catch { b = {}; }
  if (b.action !== 'unsubscribe') return Response.json({ error: 'Unknown action' }, { status: 400 });
  await ensureContactsSchema(env.DB);
  const c = await env.DB.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(params.id).first();
  if (!c) return Response.json({ error: 'Not found' }, { status: 404 });
  await unsubscribeContact(env.DB, c);
  await logAdminAction(env.DB, admin, 'fan_unsubscribed', [c.id, [c.first_name, c.surname].filter(Boolean).join(' ')].filter(Boolean).join(' - '));
  return Response.json({ ok: true });
}

// DELETE /api/admin/fans/:id -- erase this person everywhere (NDPA request).
export async function onRequestDelete({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env, { needExport: true });
  if (denied) return denied;
  await ensureContactsSchema(env.DB);
  const c = await env.DB.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(params.id).first();
  if (!c) return Response.json({ error: 'Not found' }, { status: 404 });
  await deleteContactEverywhere(env.DB, c.id);
  // Only the id goes in the log -- the point is to forget the person.
  await logAdminAction(env.DB, admin, 'fan_deleted', c.id);
  return Response.json({ ok: true });
}
