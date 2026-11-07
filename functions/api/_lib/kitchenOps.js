// MatchDay Kitchen, running a venue: its settings, the match-day shift, who is on duty, when an
// order should escalate, and refunds. Timers and amounts live in each venue's settings_json.
import { DEFAULT_VENUE, ensureFoodSchema, formatNaira } from './foodOrders.js';
import { parseZones } from './kitchenWorkflow.js';

export const VENUE_DEFAULTS = {
  newMinutes: 2, preparingMinutes: 15, readyMinutes: 3, outMinutes: 10, // escalation timers
  preorderMinutes: 30,          // kick-off and half-time orders start cooking this long before they are due
  backupAfterSeconds: 60,       // no one opened a new order: a WhatsApp or SMS to supervisors
  requireDeliveryCode: true,    // runners confirm delivery with the fan's 4-digit code
  refundApprovalKobo: 2000000,  // above this (₦20,000), only a Super Admin can refund
  paused: false, pauseMessage: '', maxOpenOrders: 0, // pause ordering, or stop at this many open orders (0 = no limit)
  zones: [],                    // delivery zones: [{ id, name, sections: [stands] }]
};
const nowIso = () => new Date().toISOString();
const parse = s => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

export const venueSettings = row => ({ ...VENUE_DEFAULTS, ...parse(row?.settings_json) });
export async function getVenue(db, id = DEFAULT_VENUE) {
  await ensureFoodSchema(db);
  const row = await db.prepare(`SELECT * FROM mk_venues WHERE id = ?`).bind(String(id || DEFAULT_VENUE)).first();
  return row ? { id: row.id, name: row.name, active: !!row.active, settings: venueSettings(row) } : null;
}
export async function activeVenueId(db, wanted) {
  if (!wanted) return DEFAULT_VENUE;
  const v = await getVenue(db, wanted);
  return v?.active ? v.id : DEFAULT_VENUE;
}
export async function saveVenueSettings(db, id, patch) {
  const v = await getVenue(db, id);
  if (!v) return null;
  const merged = { ...v.settings, ...patch };
  await db.prepare(`UPDATE mk_venues SET settings_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(merged), nowIso(), v.id).run();
  return { before: v.settings, after: merged };
}
/** Only the settings a form may send, each checked. Returns { patch } or { error }. */
export function cleanVenuePatch(b, { superAdmin = false } = {}) {
  const patch = {};
  const mins = (k, lo, hi) => {
    if (b[k] === undefined) return null;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) return `${k} must be between ${lo} and ${hi}.`;
    patch[k] = Math.round(n);
    return null;
  };
  const bad = mins('maxOpenOrders', 0, 5000) || (superAdmin && (mins('newMinutes', 1, 120) || mins('preparingMinutes', 1, 240) || mins('readyMinutes', 1, 120) || mins('outMinutes', 1, 240) || mins('preorderMinutes', 0, 240) || mins('backupAfterSeconds', 30, 3600)));
  if (bad) return { error: bad };
  if (b.zonesText !== undefined) patch.zones = parseZones(b.zonesText);
  if (b.paused !== undefined) patch.paused = !!b.paused;
  if (b.pauseMessage !== undefined) patch.pauseMessage = String(b.pauseMessage || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (superAdmin && b.requireDeliveryCode !== undefined) patch.requireDeliveryCode = !!b.requireDeliveryCode;
  if (superAdmin && b.refundApprovalNaira !== undefined) {
    const n = Number(b.refundApprovalNaira);
    if (!Number.isFinite(n) || n < 0 || n > 10000000) return { error: 'Enter the refund limit in naira.' };
    patch.refundApprovalKobo = Math.round(n * 100);
  }
  return { patch };
}

// ── The match-day shift ──
export async function openVenueShift(db, venueId = DEFAULT_VENUE) {
  await ensureFoodSchema(db);
  return db.prepare(`SELECT * FROM mk_venue_shifts WHERE venue_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`).bind(venueId).first();
}
export async function startVenueShift(db, venueId, by) {
  if (await openVenueShift(db, venueId)) return { error: 'The match-day shift has already started.' };
  const id = `vs-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await db.prepare(`INSERT INTO mk_venue_shifts (id, venue_id, started_by, started_at) VALUES (?, ?, ?, ?)`).bind(id, venueId, by, nowIso()).run();
  return { ok: true, id };
}
/** Ending it clocks everyone at the venue out, so their alerts stop. */
export async function endVenueShift(db, venueId, by) {
  const s = await openVenueShift(db, venueId);
  if (!s) return { error: 'The match-day shift has not started.' };
  const at = nowIso();
  await db.batch([
    db.prepare(`UPDATE mk_venue_shifts SET ended_at = ?, ended_by = ? WHERE id = ?`).bind(at, by, s.id),
    db.prepare(`UPDATE mk_shifts SET ended_at = ? WHERE ended_at IS NULL AND COALESCE(venue_id, ?) = ?`).bind(at, DEFAULT_VENUE, venueId),
  ]);
  return { ok: true };
}
/**
 * Who is on duty at a venue: null when no match-day shift is running. In that case alerts go to
 * everyone in the role, so forgetting to start the shift can never leave the kitchen silent.
 */
export async function dutyIds(db, venueId = DEFAULT_VENUE) {
  if (!(await openVenueShift(db, venueId))) return null;
  const { results } = await db.prepare(`SELECT user_id FROM mk_shifts WHERE ended_at IS NULL AND COALESCE(venue_id, ?) = ? AND started_at > ?`).bind(DEFAULT_VENUE, venueId, new Date(Date.now() - 18 * 3600e3).toISOString()).all();
  return results.map(r => r.user_id);
}

// ── Escalation ──
const minutesSince = (iso, now) => (iso ? (now - Date.parse(iso)) / 60000 : -1);
const preorderDue = (o, s, now) => !o.deliver_at || Date.parse(o.deliver_at) - now <= s.preorderMinutes * 60000;
/** What is overdue for one order (no database). Returns the alert names, without those already sent. */
export function dueEscalations(o, s, now, sent = []) {
  const due = [];
  const add = kind => { if (!sent.includes(kind)) due.push(kind); };
  const st = o.order_status;
  if (st === 'PAID' && minutesSince(o.paid_iso || o.created_iso, now) >= s.newMinutes) add('esc_new');
  if (st === 'AWAITING_WHATSAPP' && minutesSince(o.created_iso, now) >= s.newMinutes) add('esc_new');
  // Only an order that was held back when it was confirmed: anything else has already told the cooks.
  if (st === 'ACCEPTED' && o.deliver_at && o.accepted_iso && Date.parse(o.deliver_at) - Date.parse(o.accepted_iso) > s.preorderMinutes * 60000 && preorderDue(o, s, now)) add('release');
  if (st === 'PREPARING' && minutesSince(o.preparing_at, now) >= s.preparingMinutes) add('esc_preparing');
  if (st === 'READY' && o.fulfilment !== 'pickup' && minutesSince(o.ready_at, now) >= s.readyMinutes) add('esc_ready');
  if (st === 'OUT_FOR_DELIVERY' && minutesSince(o.out_at, now) >= s.outMinutes) add('esc_out');
  return due;
}
export const preorderHeld = (o, s, now = Date.now()) => !!o.deliver_at && !preorderDue(o, s, now);

/** Above this amount only a Super Admin can refund. Returns an error text, or null. */
export function refundProblem(amountKobo, s, isSuperAdmin) {
  if (isSuperAdmin || amountKobo <= s.refundApprovalKobo) return null;
  return `Refunds above ${formatNaira(s.refundApprovalKobo)} need a Super Admin.`;
}
