import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { sourceLabels, ensureContactsSchema, unsubscribeContact, deleteContactEverywhere } from '../../_lib/contacts.js';
import { maskEmail, maskPhone } from '../../_lib/fanQuery.js';

// GET /api/admin/fans/:id -- one person and every interaction they've had.
export async function onRequestGet({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureContactsSchema(env.DB);
  const c = await env.DB.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(params.id).first();
  if (!c) return Response.json({ error: 'Not found' }, { status: 404 });
  const SOURCES = await sourceLabels(env.DB);
  const { results } = await env.DB.prepare(`SELECT source, ref_table, seen_at, label FROM contact_sources WHERE contact_id = ? ORDER BY seen_at DESC`).bind(c.id).all();
  // Predictions, votes and messages from their fan account / forms.
  const activity = { predictions: [], votes: [], awardVotes: 0, messages: [] };
  try {
    const memberIds = (await env.DB.prepare(`SELECT ref_id FROM contact_sources WHERE contact_id = ? AND ref_table = 'members'`).bind(c.id).all()).results.map(r => r.ref_id);
    const has = async t => !!(await env.DB.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).bind(t).first());
    for (const mid of memberIds) {
      if (await has('predictions')) activity.predictions.push(...(await env.DB.prepare(
        `SELECT p.home_goals, p.away_goals, p.created_at, p.is_winner, e.home_team, e.away_team FROM predictions p LEFT JOIN events e ON e.id = p.event_id WHERE p.member_id = ? ORDER BY p.created_at DESC LIMIT 30`
      ).bind(mid).all()).results.map(r => ({ match: `${r.home_team || '?'} vs ${r.away_team || '?'}`, prediction: `${r.home_goals}–${r.away_goals}`, at: r.created_at, winner: !!r.is_winner })));
      if (await has('motm_votes')) activity.votes.push(...(await env.DB.prepare(
        `SELECT v.player_name, v.created_at, e.home_team, e.away_team FROM motm_votes v LEFT JOIN events e ON e.id = v.event_id WHERE v.member_id = ? ORDER BY v.created_at DESC LIMIT 30`
      ).bind(mid).all()).results.map(r => ({ match: `${r.home_team || '?'} vs ${r.away_team || '?'}`, player: r.player_name, at: r.created_at })));
      if (await has('award_votes')) activity.awardVotes += (await env.DB.prepare(`SELECT COUNT(*) AS n FROM award_votes WHERE member_id = ?`).bind(mid).first()).n || 0;
    }
    const enqIds = (await env.DB.prepare(`SELECT ref_id FROM contact_sources WHERE contact_id = ? AND ref_table = 'enquiries'`).bind(c.id).all()).results.map(r => r.ref_id);
    for (const id of enqIds.slice(0, 30)) {
      const e = await env.DB.prepare(`SELECT kind, subject, interest, message, created_at FROM enquiries WHERE id = ?`).bind(id).first();
      if (e) activity.messages.push({ kind: e.kind === 'partnership' ? 'Partnership' : /^Hospitality/.test(e.interest || '') ? 'Hospitality' : 'Contact form', subject: e.subject || e.interest || '', message: String(e.message || '').slice(0, 400), at: e.created_at });
    }
  } catch (err) { console.error('[fans] activity', err); }
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
    activity,
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
