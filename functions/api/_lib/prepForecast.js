// MatchDay Kitchen "How much to prepare": a suggestion for the next home match from the saved sales
// reports (the last 5 match days, the most recent counting most) plus a safety margin, and the
// pre-orders already paid for that match. Kitchen staff use it to plan stock; it never changes anything.
import { ensureSalesReports } from './kitchenSalesReports.js';
import { slotsFor } from './halftimeSlots.js';
import { DEFAULT_VENUE } from './foodOrders.js';

const LOOKBACK = 5;
const MARGIN = 0.15; // 15% extra so the kitchen doesn't sell out early
const NOT_SOLD = ['CANCELLED', 'REJECTED', 'EXPIRED', 'PAYMENT_FAILED', 'REFUNDED'];
const parse = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

/** The suggestion from past reports (oldest first), no database: [{ name, average, last, suggest }]. */
export function forecastFrom(reports, margin = MARGIN) {
  const recent = reports.slice(-LOOKBACK);
  if (!recent.length) return [];
  const weights = recent.map((_, i) => i + 1); // the most recent counts most
  const totalW = weights.reduce((a, b) => a + b, 0);
  const names = new Set(recent.flatMap(r => (r.items || []).map(i => i.name)));
  const out = [];
  for (const name of names) {
    const qtys = recent.map(r => Number((r.items || []).find(i => i.name === name)?.qty) || 0);
    const weighted = qtys.reduce((a, q, i) => a + q * weights[i], 0) / totalW;
    out.push({ name, average: Math.round(weighted * 10) / 10, last: qtys[qtys.length - 1], suggest: Math.ceil(weighted * (1 + margin)) });
  }
  return out.sort((a, b) => b.suggest - a.suggest || a.name.localeCompare(b.name));
}

/** The forecast for the next home match (scope = the staff member's venues, or null for all). */
export async function prepForecast(db, scope = null, now = Date.now()) {
  await ensureSalesReports(db);
  const { results: reps } = await db.prepare(`SELECT venue_id, day, title, data_json FROM food_sales_reports ORDER BY day DESC LIMIT 60`).all();
  const mine = reps.filter(r => !scope || scope.includes(r.venue_id));
  // One entry per day (several venues on the same day add together), newest LOOKBACK days.
  const byDay = new Map();
  for (const r of mine) {
    const d = parse(r.data_json), x = byDay.get(r.day) || { day: r.day, title: r.title, items: [] };
    for (const i of d.items || []) { const y = x.items.find(z => z.name === i.name); if (y) y.qty += i.qty || 0; else x.items.push({ name: i.name, qty: i.qty || 0 }); }
    byDay.set(r.day, x);
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-LOOKBACK);
  const items = forecastFrom(days);

  // The next (or current) home match and what's already ordered for it.
  const next = await db.prepare(`SELECT id, home_team || ' v ' || away_team AS title, event_date FROM events WHERE active = 1 AND home_team LIKE '%Lobi Stars%' AND event_date >= ? ORDER BY event_date LIMIT 1`).bind(new Date(now - 4 * 3600e3).toISOString()).first().catch(() => null);
  let preordered = new Map(), slots = [];
  if (next) {
    const { results } = await db.prepare(`SELECT items_json, venue_id, order_status FROM food_orders WHERE event_id = ? AND payment_status = 'paid'`).bind(next.id).all();
    for (const o of results) {
      if (NOT_SOLD.includes(o.order_status) || (scope && !scope.includes(o.venue_id || DEFAULT_VENUE))) continue;
      let its = []; try { its = JSON.parse(o.items_json || '[]'); } catch { /* skip */ }
      for (const i of Array.isArray(its) ? its : []) preordered.set(i.name, (preordered.get(i.name) || 0) + (Number(i.qty) || 0));
    }
    slots = (await slotsFor(db, next.id).catch(() => [])).map(s => ({ label: s.label, at: s.at, taken: s.taken, left: s.left }));
  }
  const list = items.map(i => ({ ...i, preordered: preordered.get(i.name) || 0 }));
  for (const [name, qty] of preordered) if (!list.find(i => i.name === name)) list.push({ name, average: 0, last: 0, suggest: qty, preordered: qty });
  for (const i of list) i.suggest = Math.max(i.suggest, i.preordered);
  return { basedOn: days.map(d => ({ day: d.day, title: d.title })), margin: Math.round(MARGIN * 100), next: next ? { title: next.title, at: next.event_date } : null, items: list, halftimeSlots: slots };
}
