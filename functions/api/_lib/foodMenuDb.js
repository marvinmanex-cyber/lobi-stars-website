// In-seat food menu, managed by staff in Admin -> Commerce -> In-Seat Food -> Menu.
//
// Items: name, photo, price (whole naira, stored in kobo), description,
// category, available, sold out, display order, optional max per order,
// optional stock (counts down as orders are paid; 0 = sold out) and an 18+
// flag for alcoholic drinks, optional spice level (0-3) and badge (Best
// Seller / Spicy / New) for MatchDay Kitchen. Items that have been ordered are ARCHIVED
// instead of deleted (hidden from fans, kept for order history). Orders keep
// their own copy of name and price, so menu changes never alter past orders.
// The first time this runs, the original 8 items are copied in.
import { FOOD_MENU } from './foodMenu.js';
import { randomId } from './crypto.js';
import { ensureFoodSchema, foodSettings } from './foodOrders.js';
import { listMatches, toSummary } from './matchCentre.js';

const SEED_CATEGORIES = [['meals', 'Meals'], ['snacks', 'Snacks'], ['drinks', 'Drinks']];
const SEED_ITEMS = {
  suya: ['meals', '🍢'], pepper: ['meals', '🍲'], chicken: ['meals', '🍗'], plantain: ['snacks', '🍌'],
  puff: ['snacks', '🍩'], pie: ['snacks', '🥧'], water: ['drinks', '💧'], malt: ['drinks', '🥤'],
};

let ready = false;
export async function ensureMenuSchema(db) {
  if (ready) return;
  await ensureFoodSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS food_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS food_items (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, price_kobo INTEGER NOT NULL, category_id TEXT,
      photo_id TEXT, emoji TEXT, available INTEGER NOT NULL DEFAULT 1, sold_out INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, max_per_order INTEGER, stock INTEGER,
      adult INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS food_photos (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, bytes INTEGER NOT NULL, created_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS food_item_history (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, at TEXT NOT NULL, by TEXT, text TEXT NOT NULL)`),
  ]);
  // Added for MatchDay Kitchen (/kitchen/): spice level and a badge.
  const { results: cols } = await db.prepare(`PRAGMA table_info(food_items)`).all();
  if (!cols.some(c => c.name === 'spice')) await db.prepare(`ALTER TABLE food_items ADD COLUMN spice INTEGER NOT NULL DEFAULT 0`).run();
  if (!cols.some(c => c.name === 'badge')) await db.prepare(`ALTER TABLE food_items ADD COLUMN badge TEXT`).run();
  const n = (await db.prepare(`SELECT COUNT(*) AS n FROM food_items`).first()).n;
  if (!n) {
    const now = new Date().toISOString();
    const stmts = SEED_CATEGORIES.map(([id, name], i) => db.prepare(`INSERT OR IGNORE INTO food_categories (id, name, sort) VALUES (?, ?, ?)`).bind(id, name, i));
    Object.entries(FOOD_MENU).forEach(([id, m], i) => {
      const [cat, emoji] = SEED_ITEMS[id] || ['meals', '🍽️'];
      stmts.push(db.prepare(`INSERT OR IGNORE INTO food_items (id, name, price_kobo, category_id, emoji, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, m.name, m.priceKobo, cat, emoji, i, now, now));
    });
    await db.batch(stmts);
  }
  ready = true;
}

export const photoUrl = id => (id ? `/api/food/photo/${encodeURIComponent(id)}` : null);

export async function history(db, itemId, by, text) {
  await db.prepare(`INSERT INTO food_item_history (item_id, at, by, text) VALUES (?, ?, ?, ?)`).bind(itemId, new Date().toISOString(), by || null, text).run();
}

/** Has this item ever been in an order? (Then it is archived, not deleted.) */
export async function wasOrdered(db, itemId) {
  const r = await db.prepare(`SELECT 1 FROM food_orders WHERE items_json LIKE ? LIMIT 1`).bind(`%"id":"${itemId.replace(/["%_]/g, '')}"%`).first();
  return !!r;
}

const naira = k => '₦' + (k / 100).toLocaleString('en-NG');
export { naira };

/** Menu badges (MatchDay Kitchen). */
export const BADGES = ['best-seller', 'spicy', 'new'];

/** Validates the add/edit form. Returns { value } or { error }. */
export function parseItem(b, categories) {
  const name = String(b?.name || '').trim().slice(0, 60);
  if (!name) return { error: 'Please enter the item name.' };
  const price = Number(b.price);
  if (!Number.isInteger(price) || price <= 0 || price > 1_000_000) return { error: 'The price must be a whole number of naira above 0 (e.g. 2500).' };
  const category_id = categories.some(c => c.id === b.category) ? b.category : null;
  if (!category_id) return { error: 'Please choose a category.' };
  const int = (v, max) => (v === '' || v === null || v === undefined ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : NaN);
  const max_per_order = int(b.maxPerOrder, 50), stock = int(b.stock, 100000);
  if (Number.isNaN(max_per_order) || max_per_order === 0) return { error: 'Most per order must be a whole number from 1 to 50 (or leave it empty).' };
  if (Number.isNaN(stock)) return { error: 'Stock must be a whole number (or leave it empty for no limit).' };
  return { value: {
    name, price_kobo: price * 100, category_id,
    description: String(b.description || '').trim().slice(0, 160) || null,
    emoji: String(b.emoji || '').trim().slice(0, 4) || null,
    photo_id: typeof b.photoId === 'string' && /^fp-[A-Za-z0-9]+$/.test(b.photoId) ? b.photoId : null,
    available: b.available === false ? 0 : 1, sold_out: b.soldOut ? 1 : 0, adult: b.adult ? 1 : 0,
    max_per_order, stock,
    spice: [0, 1, 2, 3].includes(Number(b.spice)) ? Number(b.spice) : 0,
    badge: BADGES.includes(b.badge) ? b.badge : null,
  } };
}

/**
 * Is in-seat ordering open right now? { open, reason, match?, opensAt?, closesAt? }
 * Automatic mode also gives the opening and closing time (ISO) of the home
 * match concerned, for the MatchDay Kitchen countdown.
 */
export async function orderingState(env, settings) {
  const s = settings || await foodSettings(env.DB);
  if (s.orderingMode === 'closed') return { open: false, reason: 'closed' };
  if (s.orderingMode !== 'auto') return { open: true, reason: 'open' };
  // Automatic: from N minutes before kick-off of a Lobi Stars HOME game until full time.
  const now = Date.now();
  try {
    const matches = (await listMatches(env.DB)).map(r => toSummary(r, r)).filter(m => m.is_home && !['postponed', 'cancelled', 'full-time'].includes(m.status));
    const win = m => { const ko = new Date(m.event_date).getTime(); return { opens: ko - s.autoOpenMinutes * 60_000, closes: ko + 3 * 3600e3 }; };
    const on = matches.find(m => {
      const w = win(m);
      return now >= w.opens && (m.status === 'live' || m.status === 'half-time' || now < w.closes);
    });
    if (on) return { open: true, reason: 'matchday', match: `${on.home_team} vs ${on.away_team}`, closesAt: new Date(win(on).closes).toISOString() };
    const next = matches.filter(m => win(m).opens > now).sort((a, b) => Date.parse(a.event_date) - Date.parse(b.event_date))[0];
    return next
      ? { open: false, reason: 'not matchday', match: `${next.home_team} vs ${next.away_team}`, opensAt: new Date(win(next).opens).toISOString() }
      : { open: false, reason: 'not matchday' };
  } catch { return { open: false, reason: 'not matchday' }; }
}

/** The public menu: available, non-archived items grouped by category. */
export async function publicMenu(db) {
  await ensureMenuSchema(db);
  const { results: cats } = await db.prepare(`SELECT * FROM food_categories ORDER BY sort, name`).all();
  const { results: items } = await db.prepare(`SELECT * FROM food_items WHERE archived = 0 AND available = 1 ORDER BY sort, name`).all();
  return cats.map(c => ({
    id: c.id, name: c.name,
    items: items.filter(i => i.category_id === c.id).map(i => ({
      id: i.id, name: i.name, description: i.description || '', priceKobo: i.price_kobo, photo: photoUrl(i.photo_id),
      emoji: i.emoji || '', soldOut: !!i.sold_out || i.stock === 0, maxPerOrder: i.max_per_order || 20, adult: !!i.adult,
      spice: i.spice || 0, badge: i.badge || null,
    })),
  })).filter(c => c.items.length);
}
