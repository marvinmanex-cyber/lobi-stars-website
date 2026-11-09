// MatchDay Kitchen half-time slots: half-time orders are spread over three slots (start, middle and
// end of half-time), each with a limit set by supervisors and Super Admins (0 = no limit). When a slot
// is full, fans are offered the next one, so the kitchen isn't flooded at the 45th minute and can
// prepare ahead (the kitchen screen shows each order's due time).
export const SLOTS = [
  { id: 'ht1', label: 'Start of half-time', minute: 45 },
  { id: 'ht2', label: 'Middle of half-time', minute: 50 },
  { id: 'ht3', label: 'End of half-time', minute: 55 },
];
const DEFAULT_CAPACITY = 40;
const LIVE = "('CANCELLED', 'REJECTED', 'EXPIRED', 'PAYMENT_FAILED', 'REFUNDED')";

let ready = false;
async function ensure(db) {
  if (ready) return;
  const cols = new Set((await db.prepare(`PRAGMA table_info(food_orders)`).all()).results.map(r => r.name));
  if (!cols.has('deliver_slot')) await db.prepare(`ALTER TABLE food_orders ADD COLUMN deliver_slot TEXT`).run().catch(() => {});
  ready = true;
}

export async function slotCapacity(db) {
  const v = (await db.prepare(`SELECT value FROM food_settings WHERE key = 'halftimeSlotCapacity'`).first().catch(() => null))?.value;
  const n = v === null || v === undefined || v === '' ? DEFAULT_CAPACITY : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_CAPACITY;
}
export async function saveSlotCapacity(db, value, by) {
  const n = Math.round(Number(value));
  if (!(n >= 0 && n <= 1000)) return { error: 'Orders per half-time slot must be a number from 0 (no limit) to 1000.' };
  await db.prepare(`INSERT INTO food_settings (key, value, updated_at, updated_by) VALUES ('halftimeSlotCapacity', ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(String(n), new Date().toISOString(), by || null).run();
  return { ok: true, capacity: n };
}

/** The slots for a match: [{ id, label, minute, at, taken, left (null = no limit), full }]. */
export async function slotsFor(db, eventId) {
  await ensure(db);
  if (!eventId) return [];
  const e = await db.prepare(`SELECT event_date FROM events WHERE id = ?`).bind(eventId).first().catch(() => null);
  const ko = e ? Date.parse(e.event_date) : NaN;
  if (!Number.isFinite(ko)) return [];
  const cap = await slotCapacity(db);
  const { results } = await db.prepare(`SELECT deliver_slot AS s, COUNT(*) AS n FROM food_orders WHERE event_id = ? AND deliver_when = 'half-time' AND order_status NOT IN ${LIVE} GROUP BY deliver_slot`).bind(eventId).all();
  return SLOTS.map(s => {
    const taken = results.find(r => r.s === s.id)?.n || 0;
    return { ...s, at: new Date(ko + s.minute * 60e3).toISOString(), taken, left: cap ? Math.max(0, cap - taken) : null, full: !!cap && taken >= cap };
  });
}

/** The slot for a new half-time order: the one asked for, or the first with room. { slot, at } or { error }. */
export async function pickSlot(db, eventId, wanted) {
  const slots = await slotsFor(db, eventId);
  if (!slots.length) return { slot: null, at: null };
  const asked = slots.find(s => s.id === wanted);
  if (asked && !asked.full) return { slot: asked.id, at: asked.at };
  if (asked && asked.full) {
    const next = slots.find(s => !s.full);
    return { error: next ? `${asked.label} is full. Choose ${next.label.toLowerCase()} instead.` : 'All half-time slots are full. Choose "As soon as possible".', code: 'slot_full' };
  }
  const free = slots.find(s => !s.full);
  return free ? { slot: free.id, at: free.at } : { error: 'All half-time slots are full. Choose "As soon as possible".', code: 'slot_full' };
}
/** Today's home match, found the same way both checkouts find it (so the menu and the order agree). */
export async function checkoutMatchId(db, now = Date.now()) {
  const { listMatches, isMatchDay, toSummary } = await import('./matchCentre.js');
  return (await listMatches(db)).map(r => toSummary(r, r)).find(x => x.is_home && isMatchDay(x, now))?.id || null;
}
/** Saves the slot on the order (after setDelivery). */
export async function setSlot(db, orderId, slot, at) {
  await ensure(db);
  if (slot) await db.prepare(`UPDATE food_orders SET deliver_slot = ?, deliver_at = ? WHERE id = ?`).bind(slot, at, orderId).run();
}
