// WhatsApp food orders: a fan pays (bank transfer, USSD, POS or cash) and sends the evidence on
// WhatsApp. Kitchen staff upload that evidence and mark the order paid. From then on the order
// goes exactly as if it had been paid online: the kitchen is alerted, stock and rewards update,
// the fan's tracking page moves on and the confirmation email goes out (afterFoodPaid).
// Only supervisors and Super Admins record payments, and recording one also confirms the order,
// so it goes straight to Received with the start-cooking alarm.
//
// Guards: evidence is required (a real picture or PDF, checked by its first bytes); the amount
// must cover the order; only one payment per order (one atomic update); the same receipt used
// on another order is refused unless a supervisor or Super Admin allows it (recorded). Evidence
// has bank details on it: only roles that record payments can open it, never fans.
import { afterFoodPaid, ensureFoodSchema, foodSettings, formatNaira, recordOrderEvent, staffMessage } from './foodOrders.js';
import { notifyKitchen } from './kitchenNotify.js';

export const PAY_METHODS = { transfer: 'Bank transfer', ussd: 'USSD / mobile app', pos: 'POS', cash: 'Cash' };
export const RECORDABLE = ['AWAITING_WHATSAPP', 'CONFIRMED', 'EXPIRED', 'PAYMENT_FAILED'];
const MAX_BYTES = 1500 * 1024; // the database keeps one value of up to 2 MB
const nowIso = () => new Date().toISOString();
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

let ready = false;
export async function ensureProofSchema(db) {
  await ensureFoodSchema(db);
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS food_payment_proofs (
      order_id TEXT PRIMARY KEY, hash TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, data BLOB NOT NULL, file_name TEXT,
      method TEXT NOT NULL, amount_kobo INTEGER NOT NULL, note TEXT, duplicate_of TEXT,
      recorded_by TEXT NOT NULL, recorded_code TEXT, recorded_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS food_payment_proofs_hash ON food_payment_proofs (hash)`),
  ]);
  ready = true;
}

/** What the first bytes say the file really is (never trust the name or the browser's word). */
export function sniffMime(b) {
  if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (b.length > 5 && String.fromCharCode(...b.slice(0, 5)) === '%PDF-') return 'application/pdf';
  return null;
}
function decode(base64) {
  try {
    const bin = atob(String(base64 || '').replace(/^data:[^,]*,/, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
const sha256 = async b => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('');

/** The fan's chat, with the "payment received" message ready (the template in Ordering settings). */
function fanChat(settings, o) {
  const phone = String(o.phone || '').replace(/\D/g, '').replace(/^0/, '234');
  return phone.length >= 12 ? `https://wa.me/${phone}?text=${encodeURIComponent(staffMessage(settings, o, 'PAID'))}` : null;
}

/** May this order have a payment recorded here? */
export const canRecord = o => !!o && o.channel === 'whatsapp' && o.payment_status !== 'paid' && RECORDABLE.includes(o.order_status);

/**
 * Records the payment and marks the order paid. Returns { ok, ref, chatUrl } or { error, status, duplicate? }.
 * who = { name, code }; canOverride: a supervisor or Super Admin (may accept a receipt seen before).
 */
export async function recordPayment(env, order, v, who, { canOverride = false, waitUntil, origin } = {}) {
  const db = env.DB;
  await ensureProofSchema(db);
  if (!order) return { error: 'That order no longer exists.', status: 404 };
  if (order.payment_status === 'paid') return { error: 'This order is already paid.', status: 409 };
  if (order.channel !== 'whatsapp') return { error: 'Only WhatsApp orders are paid this way. Online orders are confirmed by Paystack.', status: 400 };
  if (!RECORDABLE.includes(order.order_status)) return { error: 'This order can no longer be paid. Ask the fan to order again.', status: 409 };
  if (!PAY_METHODS[v.method]) return { error: 'Choose how the fan paid.', status: 400 };

  const amount = Number(String(v.amount ?? '').replace(/[₦,\s]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter the amount received.', status: 400 };
  const amountKobo = Math.round(amount * 100);
  if (amountKobo < order.total_kobo) return { error: `${formatNaira(amountKobo)} is less than the order total of ${formatNaira(order.total_kobo)}. Ask the fan to pay the rest first.`, status: 400 };

  const bytes = decode(v.proof);
  if (!bytes || !bytes.length) return { error: 'Add the payment evidence: a photo or screenshot of the receipt, or its PDF.', status: 400 };
  if (bytes.length > MAX_BYTES) return { error: 'That file is too big (the most is 1.5 MB). Send a screenshot instead.', status: 400 };
  const mime = sniffMime(bytes);
  if (!mime) return { error: 'That file is not a picture or a PDF. Upload a photo or screenshot of the receipt, or its PDF.', status: 400 };

  // The same receipt on another order is the usual way this gets abused.
  const hash = await sha256(bytes);
  const seen = await db.prepare(`SELECT p.order_id, o.ref FROM food_payment_proofs p LEFT JOIN food_orders o ON o.id = p.order_id WHERE p.hash = ? AND p.order_id != ? LIMIT 1`).bind(hash, order.id).first();
  if (seen && !(canOverride && v.allowDuplicate === true)) {
    return { error: `This same receipt was already used for order ${seen.ref || seen.order_id}.${canOverride ? '' : ' Ask a kitchen supervisor.'}`, status: 409, duplicate: seen.ref || seen.order_id, canOverride };
  }

  const at = nowIso(), name = clean(who?.name, 80) || 'Kitchen staff', code = (c => (c && !c.includes('@') ? c : null))(clean(who?.code, 60)), note = clean(v.note, 200) || null;
  // Saved first so a paid order always has its evidence; taken out again if someone else got there first.
  await db.prepare(`INSERT INTO food_payment_proofs (order_id, hash, mime, bytes, data, file_name, method, amount_kobo, note, duplicate_of, recorded_by, recorded_code, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (order_id) DO UPDATE SET hash = excluded.hash, mime = excluded.mime, bytes = excluded.bytes, data = excluded.data, file_name = excluded.file_name, method = excluded.method, amount_kobo = excluded.amount_kobo, note = excluded.note, duplicate_of = excluded.duplicate_of, recorded_by = excluded.recorded_by, recorded_code = excluded.recorded_code, recorded_at = excluded.recorded_at`)
    .bind(order.id, hash, mime, bytes.length, bytes, clean(v.fileName, 120) || null, v.method, amountKobo, note, seen ? (seen.ref || seen.order_id) : null, name, code, at).run();

  const late = ['EXPIRED', 'PAYMENT_FAILED'].includes(order.order_status) ? 1 : 0;
  const reference = `WhatsApp: ${PAY_METHODS[v.method]}, recorded by ${name}${code ? ` (${code})` : ''}`.slice(0, 200);
  const claim = await db.prepare(`UPDATE food_orders SET payment_status = 'paid', order_status = 'ACCEPTED', kitchen_ack_at = ?, kitchen_ack_by = ?, paid_at = datetime('now'), paid_iso = ?, paid_reference = ?, paid_late = ?, status_by = ?, status_at = ?
    WHERE id = ? AND payment_status != 'paid' AND order_status IN (${RECORDABLE.map(() => '?').join(',')})`).bind(at, name, at, reference, late, `${name} – MatchDay Kitchen`, at, order.id, ...RECORDABLE).run();
  if (!claim.meta?.changes) {
    await db.prepare(`DELETE FROM food_payment_proofs WHERE order_id = ?`).bind(order.id).run();
    return { error: 'Someone else has just changed this order. Refresh and try again.', status: 409 };
  }

  await recordOrderEvent(db, order.id, { from: order.order_status, to: 'ACCEPTED', byId: who?.id || null, byName: name, byRole: who?.role || null, note: `Payment recorded: ${PAY_METHODS[v.method]}` });
  const paid = { ...order, payment_status: 'paid', order_status: 'ACCEPTED', paid_iso: at, paid_reference: reference };
  await afterFoodPaid(env, order, paid, { waitUntil, origin });
  const cook = notifyKitchen(env, order.id, 'cook');
  if (waitUntil) waitUntil(cook); else await cook;
  const settings = await foodSettings(db);
  return { ok: true, ref: order.ref || order.id, total: formatNaira(order.total_kobo), amount: formatNaira(amountKobo), method: PAY_METHODS[v.method], late: !!late, duplicateOf: seen ? (seen.ref || seen.order_id) : null, chatUrl: fanChat(settings, order) };
}

/** What was recorded (no file), for the order page. */
export async function proofInfo(db, orderId) {
  await ensureProofSchema(db);
  const p = await db.prepare(`SELECT order_id, mime, bytes, file_name, method, amount_kobo, note, duplicate_of, recorded_by, recorded_code, recorded_at FROM food_payment_proofs WHERE order_id = ?`).bind(String(orderId)).first();
  if (!p) return null;
  return { mime: p.mime, isPdf: p.mime === 'application/pdf', method: PAY_METHODS[p.method] || p.method, amount: formatNaira(p.amount_kobo), note: p.note, duplicateOf: p.duplicate_of, by: p.recorded_by, code: p.recorded_code, at: p.recorded_at };
}
/** The file itself, as a response that a browser can only show, never run. */
export async function proofResponse(db, orderId) {
  await ensureProofSchema(db);
  const p = await db.prepare(`SELECT data, mime, order_id FROM food_payment_proofs WHERE order_id = ?`).bind(String(orderId)).first();
  if (!p) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[p.mime] || 'bin';
  // Browsers won't show a PDF on a locked-down page, so a PDF downloads and a picture shows.
  const how = p.mime === 'application/pdf' ? 'attachment' : 'inline';
  return new Response(new Uint8Array(p.data), { headers: {
    'Content-Type': p.mime, 'Content-Disposition': `${how}; filename="payment-evidence-${String(p.order_id).replace(/[^\w-]/g, '')}.${ext}"`, 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  } });
}
