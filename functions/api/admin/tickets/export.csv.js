import { ticketAuth, fail } from '../../_lib/ticketAdmin.js';
import { listSql, listBinds, shape } from './orders/index.js';
import { toCsv } from '../../_lib/league/csv.js';

// GET /api/admin/tickets/export.csv?q=&event=&status= -- the orders list as CSV.
export async function onRequestGet({ request, env }) {
  const { denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80), ev = url.searchParams.get('event') || '', status = url.searchParams.get('status') || '';
    if (status && !['pending', 'paid', 'failed', 'refunded'].includes(status)) return fail('Unknown status.');
    const { results } = await env.DB.prepare(listSql(q, ev, status)).bind(...listBinds(q, ev, status)).all();
    const rows = results.map(shape).map(o => ({ ...o, total_naira: o.totalKobo / 100 }));
    const csv = toCsv(['reference', 'kind', 'status', 'name', 'email', 'phone', 'matches', 'tickets', 'opponents', 'total_naira', 'createdAt', 'paidAt'], rows);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ticket-orders-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[tickets admin] export', err);
    return fail('Could not make the file.', 500);
  }
}
