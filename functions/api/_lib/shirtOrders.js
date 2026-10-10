// Shirt personalisation (name and number on an official shirt), paid with
// Paystack. OFF by default: it only works when the CMS setting is switched
// on, a fee is set, "how you get it" is filled in and the shirt has a price.
// Prices always come from the server's copy of the shop settings, never from
// the browser.
import shop from '../../../src/data/shop.json';
import site from '../../../src/data/site.json';

const P = shop.personalisation || {};
export const PERSONALISATION = {
  enabled: P.enabled === true && Number(P.feeNaira) > 0 && !!String(P.howYouGetIt || '').trim(),
  feeKobo: Math.round(Number(P.feeNaira || 0) * 100),
  maxLetters: Math.min(20, Math.max(1, Number(P.maxLetters) || 12)),
  sizes: Array.isArray(P.sizes) && P.sizes.length ? P.sizes.map(String) : ['S', 'M', 'L', 'XL', 'XXL'],
  howYouGetIt: String(P.howYouGetIt || '').trim(),
};

const withSeason = s => String(s).replaceAll('{season}', site.currentSeason || '');

/** Shirts that can be personalised right now: { id, name, priceKobo }. */
export function personalisableShirts() {
  if (!PERSONALISATION.enabled) return [];
  return (shop.products || [])
    .filter(p => p.personalisable && p.inStock && Number(p.price) > 0)
    .map(p => ({ id: p.id, name: withSeason(p.name), priceKobo: Math.round(Number(p.price) * 100) }));
}

const NAME_RE = /^[A-Z][A-Z .'-]*$/;
/** Validates an order form. Returns { value } or { error }. */
export function parseShirtOrder(b) {
  const shirt = personalisableShirts().find(s => s.id === String(b?.product || ''));
  if (!shirt) return { error: 'This shirt cannot be personalised at the moment.' };
  const size = PERSONALISATION.sizes.find(s => s === String(b.size || ''));
  if (!size) return { error: 'Please choose a size.' };
  const name = String(b.printName || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!name || name.length > PERSONALISATION.maxLetters || !NAME_RE.test(name)) {
    return { error: `The name can have up to ${PERSONALISATION.maxLetters} letters (A to Z, spaces, full stops, apostrophes and hyphens).` };
  }
  const num = String(b.printNumber ?? '').trim();
  if (!/^\d{1,2}$/.test(num)) return { error: 'The number must be from 0 to 99.' };
  const buyerName = String(b.buyerName || '').trim().slice(0, 100);
  const buyerEmail = String(b.buyerEmail || '').trim().toLowerCase().slice(0, 200);
  const buyerPhone = String(b.buyerPhone || '').trim().slice(0, 30);
  if (!buyerName || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(buyerEmail) || buyerPhone.replace(/\D/g, '').length < 10) {
    return { error: 'Please enter your name, a valid email address and your phone number.' };
  }
  return { value: {
    product_id: shirt.id, product_name: shirt.name, size, print_name: name, print_number: String(Number(num)),
    unit_kobo: shirt.priceKobo, fee_kobo: PERSONALISATION.feeKobo, total_kobo: shirt.priceKobo + PERSONALISATION.feeKobo,
    buyer_name: buyerName, buyer_email: buyerEmail, buyer_phone: buyerPhone,
  } };
}

let ready = false;
export async function ensureShirtSchema(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS shirt_orders (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    size TEXT NOT NULL,
    print_name TEXT NOT NULL,
    print_number TEXT NOT NULL,
    unit_kobo INTEGER NOT NULL,
    fee_kobo INTEGER NOT NULL,
    total_kobo INTEGER NOT NULL,
    buyer_name TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    buyer_phone TEXT NOT NULL,
    member_id TEXT,
    paystack_reference TEXT NOT NULL UNIQUE,
    payment_status TEXT NOT NULL DEFAULT 'pending',   -- pending / paid
    status TEXT NOT NULL DEFAULT 'new',               -- new / ready / collected / cancelled (set by staff)
    status_by TEXT,
    status_at TEXT,
    emailed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    paid_at TEXT
  )`).run();
  ready = true;
}

const naira = k => '₦' + (k / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function shirtOrderEmailHtml(o) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#15181D">
  <h2 style="color:#A3161B">Your personalised shirt order</h2>
  <p>Hi ${esc(o.buyer_name)}, thank you. Your payment has been received.</p>
  <table style="border-collapse:collapse;width:100%;font-size:15px">
    <tr><td style="padding:6px 0;color:#5B6472">Order</td><td><b>${esc(o.id)}</b></td></tr>
    <tr><td style="padding:6px 0;color:#5B6472">Shirt</td><td>${esc(o.product_name)} (size ${esc(o.size)})</td></tr>
    <tr><td style="padding:6px 0;color:#5B6472">Name and number</td><td><b>${esc(o.print_name)} ${esc(o.print_number)}</b></td></tr>
    <tr><td style="padding:6px 0;color:#5B6472">Paid</td><td>${naira(o.total_kobo)}</td></tr>
  </table>
  <p><b>How you get it:</b> ${esc(PERSONALISATION.howYouGetIt)}</p>
  <p style="color:#5B6472;font-size:13px">Keep this email and your order number. Lobi Stars FC will never ask for your bank details or card PIN.</p>
</div>`;
}
