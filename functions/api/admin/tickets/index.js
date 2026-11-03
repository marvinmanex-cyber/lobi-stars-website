import { ticketAuth, ok, fail, salesView } from '../../_lib/ticketAdmin.js';
import { salesPause, setSalesPause, ensureTicketShopSchema } from '../../_lib/ticketShop.js';
import { logAdminAction } from '../../_lib/adminSession.js';

// GET /api/admin/tickets -- every home match: prices, capacity per stand,
// sale times, on/off, tickets sold, revenue and seats left; plus totals.
export async function onRequestGet({ request, env }) {
  const { denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const matches = await salesView(env);
    const totals = matches.reduce((t, m) => {
      for (const x of m.tiers) { t.sold += x.sold; t.revenueKobo += x.revenueKobo; if (x.capacity !== null) t.capacity += x.capacity; }
      return t;
    }, { sold: 0, revenueKobo: 0, capacity: 0 });
    await ensureTicketShopSchema(env.DB);
    return ok({ matches, totals, pause: await salesPause(env.DB) });
  } catch (err) {
    console.error('[tickets admin] view', err);
    return fail('Could not load ticket sales.', 500);
  }
}

// POST /api/admin/tickets { action: 'pause', paused, message } -- pause (or resume) all online ticket sales.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await ticketAuth(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  if (b.action !== 'pause') return fail('Unknown action.', 400);
  const pause = await setSalesPause(env.DB, { paused: !!b.paused, message: b.message }, admin?.name || admin?.email || 'admin');
  await logAdminAction(env.DB, admin, 'tickets_pause', pause.paused ? `Paused online ticket sales: ${pause.message}` : 'Resumed online ticket sales').catch(() => {});
  return ok({ pause });
}
