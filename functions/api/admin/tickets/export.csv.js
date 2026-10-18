import { ticketAuth, fail } from '../../_lib/ticketAdmin.js';
import { listSql, listBinds, shape } from './orders/index.js';
import { toCsv } from '../../_lib/league/csv.js';
import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { freshCodeCheck, exportName } from '../../_lib/exportGuard.js';

// GET /api/admin/tickets/export.csv?q=&event=&status= -- the orders list as CSV.
export async function onRequestGet({ request, env }) {
  const { denied } = await ticketAuth(request, env);
  if (denied) return denied;
  // Buyers' contact details: needs download rights and a fresh two-step code.
  const { admin, denied: noExport } = await requireAdminUser(request, env, { needExport: true });
  if (noExport) return noExport;
  const needCode = await freshCodeCheck(request, env, admin);
  if (needCode) return needCode;
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80), ev = url.searchParams.get('event') || '', status = url.searchParams.get('status') || '';
    if (status && !['pending', 'paid', 'failed', 'refunded'].includes(status)) return fail('Unknown status.');
    const { results } = await env.DB.prepare(listSql(q, ev, status)).bind(...listBinds(q, ev, status)).all();
    const rows = results.map(shape).map(o => ({ ...o, total_naira: o.totalKobo / 100 }));
    const csv = toCsv(['reference', 'kind', 'status', 'name', 'email', 'phone', 'matches', 'tickets', 'opponents', 'total_naira', 'createdAt', 'paidAt'], rows);
    await logAdminAction(env.DB, admin, 'export_ticket_orders', `Ticket orders: ${rows.length} rows`);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${exportName('ticket-orders', admin, 'csv')}"`, 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[tickets admin] export', err);
    return fail('Could not make the file.', 500);
  }
}
