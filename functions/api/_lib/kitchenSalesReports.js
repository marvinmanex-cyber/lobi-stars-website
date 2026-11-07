// MatchDay Kitchen: saved sales reports. One report per venue per day, saved by itself after each
// home match or by hand, and kept with its own figures so old records never shift when the menu
// or prices change. Any reports can be combined. A report can only be deleted a year after its
// date, and nothing deletes one by itself. Figures only: no customer details.
import { DEFAULT_VENUE, ensureFoodSchema, formatNaira } from './foodOrders.js';
import { isHomeGame } from './matchCentre.js';

const nowIso = () => new Date().toISOString();
const items = o => { try { return JSON.parse(o.items_json || '[]'); } catch { return []; } };
const NOT_SOLD = ['CANCELLED', 'REFUNDED', 'REJECTED'];
export const lagosDayOf = iso => new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 10);
const dayRange = day => ({ start: new Date(Date.parse(`${day}T00:00:00Z`) - 3600e3).toISOString(), end: new Date(Date.parse(`${day}T00:00:00Z`) + 23 * 3600e3).toISOString() });

let ready = false;
export async function ensureSalesReports(db) {
  await ensureFoodSchema(db);
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS food_sales_reports (report_no INTEGER PRIMARY KEY AUTOINCREMENT, venue_id TEXT NOT NULL, day TEXT NOT NULL, title TEXT NOT NULL, event_id TEXT, data_json TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT, updated_by TEXT, UNIQUE (venue_id, day))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_reports_day ON food_sales_reports (day)`),
  ]);
  ready = true;
}

/**
 * The figures for these orders (no database). A sale is a paid order that wasn't cancelled, rejected
 * or refunded. Items are most sold first; ties go by money, then name, so the order never wobbles.
 */
export function salesFigures(orders) {
  const sold = orders.filter(o => o.payment_status === 'paid' && !NOT_SOLD.includes(o.order_status));
  const out = { online: { orders: 0, kobo: 0 }, whatsapp: { orders: 0, kobo: 0 }, totalOrders: sold.length, totalKobo: 0, totalItems: 0, discountsKobo: 0, excluded: { orders: 0, kobo: 0 }, items: [] };
  const map = new Map();
  for (const o of sold) {
    const way = o.channel === 'whatsapp' ? 'whatsapp' : 'online';
    out[way].orders++; out[way].kobo += o.total_kobo || 0; out.totalKobo += o.total_kobo || 0;
    let listed = 0;
    for (const i of items(o)) {
      const qty = Number(i.qty) || 0, kobo = qty * (Number(i.priceKobo) || 0);
      const x = map.get(i.name) || { name: i.name, qty: 0, kobo: 0, onlineQty: 0, whatsappQty: 0 };
      x.qty += qty; x.kobo += kobo; x[way === 'online' ? 'onlineQty' : 'whatsappQty'] += qty;
      map.set(i.name, x); listed += kobo; out.totalItems += qty;
    }
    // Star Points and vouchers: what the fan paid can be less than the menu prices.
    out.discountsKobo += Math.max(0, listed - (o.total_kobo || 0));
  }
  for (const o of orders) if (o.payment_status === 'paid' && NOT_SOLD.includes(o.order_status) || NOT_SOLD.includes(o.order_status) && o.paid_iso) { out.excluded.orders++; out.excluded.kobo += o.total_kobo || 0; }
  out.items = rank([...map.values()]);
  return out;
}
const rank = list => list.sort((a, b) => b.qty - a.qty || b.kobo - a.kobo || String(a.name).localeCompare(String(b.name)));

/** Several reports added together. */
export function combineFigures(list) {
  const out = { online: { orders: 0, kobo: 0 }, whatsapp: { orders: 0, kobo: 0 }, totalOrders: 0, totalKobo: 0, totalItems: 0, discountsKobo: 0, excluded: { orders: 0, kobo: 0 }, items: [] };
  const map = new Map();
  for (const d of list) {
    for (const k of ['online', 'whatsapp', 'excluded']) { out[k].orders += d[k]?.orders || 0; out[k].kobo += d[k]?.kobo || 0; }
    for (const k of ['totalOrders', 'totalKobo', 'totalItems', 'discountsKobo']) out[k] += d[k] || 0;
    for (const i of d.items || []) {
      const x = map.get(i.name) || { name: i.name, qty: 0, kobo: 0, onlineQty: 0, whatsappQty: 0 };
      for (const k of ['qty', 'kobo', 'onlineQty', 'whatsappQty']) x[k] += i[k] || 0;
      map.set(i.name, x);
    }
  }
  out.items = rank([...map.values()]);
  return out;
}

/** One year after the report's date (the day the delete button can appear). */
export function deletableFrom(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
export const canDeleteReport = (day, today = lagosDayOf(nowIso())) => today >= deletableFrom(day);

async function figuresFor(db, venueId, day) {
  const { start, end } = dayRange(day);
  const { results } = await db.prepare(`SELECT order_status, payment_status, channel, total_kobo, items_json, paid_iso FROM food_orders WHERE COALESCE(venue_id, ?) = ? AND paid_iso >= ? AND paid_iso < ?`).bind(DEFAULT_VENUE, venueId, start, end).all();
  return salesFigures(results);
}
async function titleFor(db, day) {
  const { start, end } = dayRange(day);
  const { results } = await db.prepare(`SELECT * FROM events WHERE event_date >= ? AND event_date < ? ORDER BY event_date`).bind(start, end).all();
  const m = results.find(isHomeGame);
  return { title: m ? `${m.home_team} vs ${m.away_team}` : 'Sales with no home match', eventId: m?.id || null };
}

/** Saves a day's report, or brings an existing one up to date. Returns { reportNo, created, empty }. */
export async function saveSalesReport(db, { venueId = DEFAULT_VENUE, day, by = 'Automatic' }) {
  await ensureSalesReports(db);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return { error: 'Choose a date.' };
  if (day > lagosDayOf(nowIso())) return { error: "That date hasn't happened yet." };
  const data = await figuresFor(db, venueId, day);
  const had = await db.prepare(`SELECT report_no FROM food_sales_reports WHERE venue_id = ? AND day = ?`).bind(venueId, day).first();
  if (!had && !data.totalOrders && !data.excluded.orders) return { error: 'There were no paid orders on that day, so there is nothing to save.', empty: true };
  const { title, eventId } = await titleFor(db, day);
  const at = nowIso();
  await db.prepare(`INSERT INTO food_sales_reports (venue_id, day, title, event_id, data_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (venue_id, day) DO UPDATE SET data_json = excluded.data_json, updated_at = ?, updated_by = ?`).bind(venueId, day, title, eventId, JSON.stringify(data), at, by, at, by).run();
  const row = await db.prepare(`SELECT report_no FROM food_sales_reports WHERE venue_id = ? AND day = ?`).bind(venueId, day).first();
  return { ok: true, reportNo: row.report_no, created: !had };
}

const parse = s => { try { return JSON.parse(s); } catch { return {}; } };
export async function listSalesReports(db, scope = null) {
  await ensureSalesReports(db);
  const { results } = await db.prepare(`SELECT r.*, v.name AS venue FROM food_sales_reports r LEFT JOIN mk_venues v ON v.id = r.venue_id ORDER BY r.day DESC, r.report_no DESC LIMIT 1000`).all();
  return results.filter(r => !scope || scope.includes(r.venue_id)).map(r => {
    const d = parse(r.data_json);
    return { no: r.report_no, day: r.day, title: r.title, venue: r.venue || '', orders: d.totalOrders || 0, total: formatNaira(d.totalKobo || 0), updatedAt: r.updated_at || null, deleteFrom: deletableFrom(r.day), canDelete: canDeleteReport(r.day) };
  });
}
/** One report or several combined, ready to show or download. Returns null if any isn't there or isn't allowed. */
export async function loadSalesReport(db, numbers, scope = null) {
  await ensureSalesReports(db);
  const nos = [...new Set(numbers.map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, 200);
  if (!nos.length) return null;
  const { results } = await db.prepare(`SELECT r.*, v.name AS venue FROM food_sales_reports r LEFT JOIN mk_venues v ON v.id = r.venue_id WHERE r.report_no IN (${nos.map(() => '?').join(',')}) ORDER BY r.day`).bind(...nos).all();
  if (results.length !== nos.length || results.some(r => scope && !scope.includes(r.venue_id))) return null;
  const figures = results.length === 1 ? parse(results[0].data_json) : combineFigures(results.map(r => parse(r.data_json)));
  const parts = results.map(r => ({ no: r.report_no, day: r.day, title: r.title, venue: r.venue || '', orders: parse(r.data_json).totalOrders || 0, total: formatNaira(parse(r.data_json).totalKobo || 0) }));
  return { nos, combined: results.length > 1, parts, heading: results.length > 1 ? `Combined report: reports ${nos.join(', ')}` : `Report ${nos[0]}: ${results[0].title}`, figures: display(figures) };
}
/** Money as words, and each item's share of the total sold. */
function display(f) {
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    ...f,
    total: formatNaira(f.totalKobo), onlineTotal: formatNaira(f.online?.kobo || 0), whatsappTotal: formatNaira(f.whatsapp?.kobo || 0), discounts: formatNaira(f.discountsKobo || 0), excludedTotal: formatNaira(f.excluded?.kobo || 0),
    items: (f.items || []).map((i, n) => ({ ...i, rank: n + 1, sales: formatNaira(i.kobo), share: pct(i.qty, f.totalItems) })),
  };
}
/** Up to 7 items by name, then the rest as "Other": a pie with more slices can't be read. */
export function pieSlices(items) {
  const total = items.reduce((s, i) => s + i.qty, 0);
  if (!total) return [];
  const top = items.slice(0, items.length > 8 ? 7 : 8).map(i => ({ name: i.name, qty: i.qty }));
  const rest = items.slice(top.length).reduce((s, i) => s + i.qty, 0);
  if (rest) top.push({ name: `Other (${items.length - top.length} items)`, qty: rest });
  return top.map(s => ({ ...s, share: Math.round((s.qty / total) * 1000) / 10 }));
}
export async function deleteSalesReport(db, no, scope = null) {
  await ensureSalesReports(db);
  const r = await db.prepare(`SELECT * FROM food_sales_reports WHERE report_no = ?`).bind(Number(no) || 0).first();
  if (!r || (scope && !scope.includes(r.venue_id))) return { error: 'That report is no longer here.', status: 404 };
  if (!canDeleteReport(r.day)) return { error: `A report can only be deleted a year after its date. This one: from ${deletableFrom(r.day)}.`, status: 403 };
  await db.prepare(`DELETE FROM food_sales_reports WHERE report_no = ?`).bind(r.report_no).run();
  return { ok: true, title: r.title, day: r.day, data: parse(r.data_json) };
}

/** Called by the every-minute timer after a home match: saves the day's report for each venue with sales, once. */
export async function saveMatchDayReports(db, day) {
  await ensureSalesReports(db);
  const { start, end } = dayRange(day);
  const { results } = await db.prepare(`SELECT DISTINCT COALESCE(venue_id, ?) AS venue FROM food_orders WHERE paid_iso >= ? AND paid_iso < ?`).bind(DEFAULT_VENUE, start, end).all();
  const saved = [];
  for (const { venue } of results) { const r = await saveSalesReport(db, { venueId: venue, day }); if (r.ok) saved.push(r.reportNo); }
  return saved;
}
