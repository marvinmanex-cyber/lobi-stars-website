// In-seat food: the buyer's receipt, sent by staff from the Live Order Board
// (Send receipt by WhatsApp / by email). Branded with the MatchDay Kitchen
// logo. The same receipt is a page the buyer can open, print or save as PDF:
// /food/receipt/?ref=…&t=… (the order's private view token, like the order
// status page).
import { formatNaira, whereText } from './foodOrders.js';
import { PdfDoc, wrap, pdfSafe } from './pdfLite.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = env => String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
export const LOGO_PATH = '/images/matchday-kitchen-logo.png';

export const receiptUrl = (site, o) => `${site}/food/receipt/?ref=${encodeURIComponent(o.ref)}&t=${encodeURIComponent(o.view_token || '')}`;
const items = o => { try { return JSON.parse(o.items_json || '[]'); } catch { return []; } };
const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '');
const paidBy = o => (o.channel === 'whatsapp' ? 'Bank transfer / cash (WhatsApp order)' : 'Card / bank (Paystack)');
export const canReceipt = o => o && o.payment_status === 'paid' && !['CANCELLED', 'REFUNDED'].includes(o.order_status);

/** The receipt email (inline styles only, so it looks right in Gmail and phone mail apps). */
export function receiptEmailHtml(env, o) {
  const site = SITE(env);
  const rows = items(o).map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #EEE;">${esc(i.qty)} &times; ${esc(i.name)}</td>
    <td style="padding:8px 0;border-bottom:1px solid #EEE;text-align:right;white-space:nowrap;">${esc(formatNaira((i.priceKobo || 0) * (i.qty || 1)))}</td></tr>`).join('');
  return `<div style="background:#F4F1EC;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#15181D;">
  <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E7E1D8;">
    <div style="background:#15181D;padding:22px 20px;text-align:center;">
      <img src="${esc(site + LOGO_PATH)}" alt="MatchDay Kitchen" width="150" style="display:block;margin:0 auto;max-width:150px;height:auto;" />
      <div style="color:#F5C518;font-size:12px;letter-spacing:3px;font-weight:bold;margin-top:10px;">LOBI STARS FC &middot; IN-SEAT FOOD</div>
    </div>
    <div style="padding:22px 20px;">
      <h1 style="margin:0 0 4px;font-size:22px;color:#D4202B;">Receipt</h1>
      <p style="margin:0 0 16px;color:#5B6470;font-size:14px;">Thank you${o.customer_name ? `, ${esc(o.customer_name)}` : ''}! Enjoy the match.</p>
      <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:14px;">
        <tr><td style="color:#5B6470;padding:3px 0;">Order</td><td style="text-align:right;font-weight:bold;">${esc(o.ref)}</td></tr>
        <tr><td style="color:#5B6470;padding:3px 0;">Paid</td><td style="text-align:right;">${esc(when(o.paid_iso || o.created_iso))}</td></tr>
        <tr><td style="color:#5B6470;padding:3px 0;">${o.fulfilment === 'pickup' ? 'Collected at' : 'Delivered to'}</td><td style="text-align:right;">${esc(o.fulfilment === 'pickup' ? (o.pickup_point || 'Pickup point') : `Seat ${o.seat}${o.stand ? `, ${o.stand}` : ''}`)}</td></tr>
        ${o.delivered_at ? `<tr><td style="color:#5B6470;padding:3px 0;">${o.fulfilment === 'pickup' ? 'Collected' : 'Delivered'}</td><td style="text-align:right;">${esc(when(o.delivered_at))}</td></tr>` : ''}
        <tr><td style="color:#5B6470;padding:3px 0;">Payment</td><td style="text-align:right;">${esc(paidBy(o))}</td></tr>
      </table>
      <table style="width:100%;font-size:15px;border-collapse:collapse;">${rows}
        <tr><td style="padding:12px 0 0;font-weight:bold;font-size:17px;">Total paid</td><td style="padding:12px 0 0;text-align:right;font-weight:bold;font-size:17px;">${esc(formatNaira(o.total_kobo))}</td></tr>
      </table>
      ${o.notes ? `<p style="margin:14px 0 0;padding:10px 12px;background:#FFF7E0;border-radius:8px;font-size:13px;">Your note: ${esc(o.notes)}</p>` : ''}
      <p style="margin:20px 0 0;text-align:center;"><a href="${esc(receiptPdfUrl(site, o))}&amp;download=1" style="display:inline-block;background:#D4202B;color:#FFFFFF;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Download your receipt (PDF)</a></p>
    </div>
    <div style="background:#FAF8F4;padding:14px 20px;text-align:center;font-size:12px;color:#5B6470;">MatchDay Kitchen &middot; Lobi Stars Football Club, Makurdi &middot; Pride of Benue<br /><a href="${esc(site)}" style="color:#5B6470;">lobistarsfc.com</a></div>
  </div></div>`;
}

/** The WhatsApp message (plain text with the link to the branded receipt page). */
export function receiptWhatsappText(env, o) {
  const site = SITE(env);
  const lines = items(o).map(i => `${i.qty} x ${i.name} - ${formatNaira((i.priceKobo || 0) * (i.qty || 1))}`);
  // Plain text only: emojis in a wa.me link can arrive as broken characters.
  return [`*MatchDay Kitchen - Lobi Stars FC*`, `Receipt for order ${o.ref}`, '', ...lines, '', `*Total paid: ${formatNaira(o.total_kobo)}*`, whereText(o),
    '', `Your receipt (PDF): ${receiptPdfUrl(site, o)}`, '', 'Thank you and enjoy the match!'].join('\n');
}

/** "234…" for wa.me from the number the buyer gave (Nigerian numbers starting 0 → 234). */
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 11) d = `234${d.slice(1)}`;
  return d.length >= 10 ? d : null;
}

// ── The PDF receipt: one compact page, exactly as tall as its content (no empty space) ──
export const LOGO_JPEG = '/images/matchday-kitchen-logo-receipt.jpg';
export const receiptPdfUrl = (site, o) => `${site}/api/food/receipt?ref=${encodeURIComponent(o.ref)}&t=${encodeURIComponent(o.view_token || '')}`;
/** "Achigbe-George-Alexander-Receipt-FD-20261022-0004.pdf": the customer's name first, so receipts are easy to find in a folder. */
export const receiptPdfName = o => {
  const name = String(o.customer_name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 -]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${name ? `${name}-` : ''}Receipt-${String(o.ref || 'order').replace(/[^\w-]/g, '')}.pdf`;
};
const N = kobo => `NGN ${pdfSafe(formatNaira(kobo)).replace(/^N/, '')}`; // the built-in PDF font has no ₦

/** logo: the JPEG bytes (or null). Returns the PDF as a Uint8Array. */
export function receiptPdf(o, logo = null) {
  const W = 300, PAD = 18, INNER = W - PAD * 2;
  const its = items(o);
  const rows = [
    ['Order', o.ref],
    ['Paid', when(o.paid_iso || o.created_iso)],
    [o.fulfilment === 'pickup' ? 'Collected at' : 'Seat', o.fulfilment === 'pickup' ? (o.pickup_point || 'Pickup point') : `${o.seat}${o.stand ? `, ${o.stand}` : ''}`],
    ...(o.delivered_at ? [[o.fulfilment === 'pickup' ? 'Collected' : 'Delivered', when(o.delivered_at)]] : []),
    ['Payment', o.channel === 'whatsapp' ? 'Bank transfer / cash' : 'Card / bank (Paystack)'],
    ...(o.customer_name ? [['Customer', o.customer_name]] : []),
  ];
  // Measure first, so the page is exactly as tall as the receipt.
  const itemLines = its.map(i => wrap(`${i.qty} x ${i.name}`, INNER - 70, 9.5));
  const metaLines = rows.map(([, v]) => wrap(String(v), INNER - 78, 8.5));
  const HEAD = 96;
  let h = HEAD + 22 + 8;                                            // header, title, gap
  h += metaLines.reduce((n, l) => n + l.length * 11 + 2, 0) + 8;   // details
  h += itemLines.reduce((n, l) => n + l.length * 12 + 4, 0) + 6;   // items
  h += 26 + 22;                                                     // total, footer
  const doc = new PdfDoc({ width: W, height: h });
  // Header: dark band with the logo.
  doc.rect(0, 0, W, HEAD, { fill: '#15181D' });
  if (logo && doc.setJpeg(logo)) doc.drawImage((W - 66) / 2, 8, 66, 66);
  doc.text('LOBI STARS FC  ·  IN-SEAT FOOD', W / 2, 88, { size: 7, bold: true, color: '#F5C518', align: 'center' });
  let y = HEAD + 20;
  doc.text('RECEIPT', PAD, y, { size: 15, bold: true, color: '#D4202B' });
  doc.text('MatchDay Kitchen', W - PAD, y, { size: 8, color: '#5B6470', align: 'right' });
  y += 12;
  rows.forEach(([k], i) => {
    y += 10;
    doc.text(k, PAD, y, { size: 8.5, color: '#5B6470' });
    metaLines[i].forEach((line, j) => doc.text(line, W - PAD, y + j * 11, { size: 8.5, bold: k === 'Order', align: 'right' }));
    y += (metaLines[i].length - 1) * 11 + 2;
  });
  y += 8;
  doc.line(PAD, y, W - PAD, y, { color: '#E5E1DA' });
  its.forEach((i, n) => {
    y += 14;
    itemLines[n].forEach((line, j) => doc.text(line, PAD, y + j * 12, { size: 9.5 }));
    doc.text(N((i.priceKobo || 0) * (i.qty || 1)), W - PAD, y, { size: 9.5, align: 'right' });
    y += (itemLines[n].length - 1) * 12 + 2;
  });
  y += 8;
  doc.line(PAD, y, W - PAD, y, { color: '#15181D', width: 1 });
  y += 17;
  doc.text('TOTAL PAID', PAD, y, { size: 11, bold: true });
  doc.text(N(o.total_kobo), W - PAD, y, { size: 12, bold: true, align: 'right' });
  // Footer band.
  doc.rect(0, h - 20, W, 20, { fill: '#FAF8F4' });
  doc.text('Thank you! Enjoy the match  ·  lobistarsfc.com', W / 2, h - 7, { size: 7, color: '#5B6470', align: 'center' });
  return doc.toBytes({ title: `MatchDay Kitchen receipt ${o.ref}` });
}
