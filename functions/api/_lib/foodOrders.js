// In-seat food orders for staff (Admin -> Commerce -> In-Seat Food Orders).
// Orders are created and paid through /api/food-checkout and Paystack; this
// adds the kitchen/delivery status that staff update on matchday.
let ready = false;
export async function ensureFoodAdminSchema(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS food_orders (
    id TEXT PRIMARY KEY, seat TEXT NOT NULL, stand TEXT, phone TEXT NOT NULL, email TEXT NOT NULL,
    items_json TEXT NOT NULL, total_kobo INTEGER NOT NULL, paystack_reference TEXT UNIQUE NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT
  )`).run();
  const cols = new Set((await db.prepare(`PRAGMA table_info(food_orders)`).all()).results.map(r => r.name));
  for (const [name, type] of [
    ['status', "TEXT NOT NULL DEFAULT 'new'"],   // new / preparing / delivered / cancelled
    ['status_by', 'TEXT'],
    ['status_at', 'TEXT'],
  ]) if (!cols.has(name)) await db.prepare(`ALTER TABLE food_orders ADD COLUMN ${name} ${type}`).run();
  ready = true;
}
export const FOOD_STATUSES = ['new', 'preparing', 'delivered', 'cancelled'];
