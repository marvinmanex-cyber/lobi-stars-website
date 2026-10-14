import { ticketAuth, fail } from '../../../_lib/ticketAdmin.js';
import { discountReport } from '../../../_lib/ticketDiscounts.js';
import { toCsv } from '../../../_lib/league/csv.js';

// GET /api/admin/tickets/discounts/report.csv -- per discount: orders, tickets,
// child tickets, discount given and revenue after discount (paid, not refunded).
export async function onRequestGet({ request, env }) {
  const { denied } = await ticketAuth(request, env);
  if (denied) return denied;
  try {
    const rows = (await discountReport(env.DB)).map(r => ({ ...r, on: r.isActive ? 'yes' : 'no', discount_naira: r.discountKobo / 100, revenue_after_discount_naira: r.revenueKobo / 100 }));
    const csv = toCsv(['name', 'kind', 'on', 'orders', 'tickets', 'childTickets', 'discount_naira', 'revenue_after_discount_naira'], rows);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ticket-discounts-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[discounts admin] report', err);
    return fail('Could not make the file.', 500);
  }
}
