import { ensureFoodSchema } from '../_lib/foodOrders.js';
import { receiptPdf, receiptPdfName, canReceipt, LOGO_JPEG } from '../_lib/foodReceipt.js';

// GET /api/food/receipt?ref=FD-...&t=<token>[&download=1] -- the buyer's MatchDay
// Kitchen receipt as a PDF (one compact page with the logo). Uses the order's
// private link token, like the order status page; only paid orders.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const ref = (url.searchParams.get('ref') || '').trim(), token = (url.searchParams.get('t') || '').trim();
  const fail = (msg, status) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!ref || !token) return fail('This receipt link is not complete.', 400);
  await ensureFoodSchema(env.DB);
  const o = await env.DB.prepare(`SELECT * FROM food_orders WHERE ref = ?`).bind(ref).first();
  if (!o || !o.view_token || o.view_token !== token) return fail('Receipt not found.', 404);
  if (!canReceipt(o)) return fail('There is no receipt for this order: it has not been paid.', 409);
  let logo = null;
  try { const r = await env.ASSETS.fetch(new URL(LOGO_JPEG, url.origin)); if (r.ok) logo = new Uint8Array(await r.arrayBuffer()); } catch { /* receipt without the logo */ }
  const pdf = receiptPdf(o, logo);
  return new Response(pdf, { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${receiptPdfName(o)}"`,
    'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex',
  } });
}
