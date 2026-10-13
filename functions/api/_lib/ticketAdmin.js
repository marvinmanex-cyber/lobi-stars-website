// Admin › Tickets helpers: the per-match sales view and validated settings.
import { requireAdminUser } from './adminEvents.js';
import { ensureTicketShopSchema, settingsFor, soldCounts } from './ticketShop.js';
import { ticketState, TIERS, PRICE_COL, CAP_COL, TIER_LABELS } from './tickets/rules.js';
import { listMatches, toSummary } from './matchCentre.js';

export const ok = (d = {}) => Response.json({ ok: true, ...d }, { headers: { 'Cache-Control': 'no-store' } });
export const fail = (error, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function ticketAuth(request, env) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  await ensureTicketShopSchema(env.DB);
  return { admin, staff: { email: admin.email || admin.name || 'owner' } };
}

/** Nigerian "YYYY-MM-DDTHH:MM" (or ISO) -> UTC ISO; '' -> null; undefined -> undefined (no change). */
function lagosToIso(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) { const t = Date.parse(`${s}:00Z`) - 3600e3; return Number.isNaN(t) ? NaN : new Date(t).toISOString(); }
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : new Date(t).toISOString();
}

/**
 * Checks a settings change. Body: { prices: { VIP: naira, ... }, capacities: { VIP: n|null, ... },
 * saleOpensAt, saleClosesAt, maxPerOrder, isOnSale }. Returns { ok, prices, settings } or { error }.
 */
export function parseTicketSettings(b, event) {
  const prices = {}, settings = {};
  if (b.prices !== undefined) {
    for (const t of TIERS) {
      if (b.prices[t] === undefined) continue;
      const n = Number(b.prices[t]);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return { error: `${TIER_LABELS[t]}: the price is a whole number of naira (0 = not sold).` };
      prices[PRICE_COL[t]] = n * 100;
    }
  }
  if (b.capacities !== undefined) {
    for (const t of TIERS) {
      if (b.capacities[t] === undefined) continue;
      const v = b.capacities[t];
      if (v === null || v === '') { settings[CAP_COL[t]] = null; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: `${TIER_LABELS[t]}: capacity is a whole number of seats (empty = no limit).` };
      settings[CAP_COL[t]] = n;
    }
  }
  for (const [k, col] of [['saleOpensAt', 'sale_opens_at'], ['saleClosesAt', 'sale_closes_at']]) {
    const iso = lagosToIso(b[k]);
    if (Number.isNaN(iso)) return { error: 'Enter real sale dates and times.' };
    if (iso !== undefined) settings[col] = iso;
  }
  if (settings.sale_opens_at && settings.sale_closes_at && settings.sale_opens_at >= settings.sale_closes_at) return { error: 'Sales must open before they close.' };
  if (b.maxPerOrder !== undefined) {
    const n = Number(b.maxPerOrder);
    if (!Number.isInteger(n) || n < 1 || n > 10) return { error: 'Most tickets per order is 1 to 10.' };
    settings.max_per_order = n;
  }
  if (b.isOnSale !== undefined) {
    if (b.isOnSale && event && !(event.is_home === 1 || event.is_home === true)) return { error: 'Tickets are only sold for Lobi Stars home matches.' };
    settings.is_on_sale = b.isOnSale ? 1 : 0;
  }
  return { ok: true, prices, settings };
}

export async function saveTicketSettings(db, eventId, parsed, staff) {
  const cols = Object.keys(parsed.settings);
  if (Object.keys(parsed.prices).length) {
    const p = Object.keys(parsed.prices);
    await db.prepare(`UPDATE events SET ${p.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...p.map(c => parsed.prices[c]), eventId).run();
  }
  await db.prepare(`INSERT OR IGNORE INTO league_ticket_settings (event_id) VALUES (?)`).bind(eventId).run();
  if (cols.length) {
    await db.prepare(`UPDATE league_ticket_settings SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now'), updated_by = ? WHERE event_id = ?`)
      .bind(...cols.map(c => parsed.settings[c]), staff.email, eventId).run();
  }
}

/** Every Lobi Stars home match with prices, settings, sales and state. */
export async function salesView(env) {
  const db = env.DB;
  const rows = (await listMatches(db)).map(r => ({ row: r, s: toSummary(r, r) })).filter(x => x.s.is_home);
  const ids = new Set(rows.map(x => x.row.id));
  const [settings, held] = await Promise.all([settingsFor(db), soldCounts(db)]);
  const paid = new Map();
  const { results } = await db.prepare(`SELECT o.event_id, o.tier, SUM(o.quantity) AS sold, SUM(o.total_kobo) AS revenue FROM orders o
    WHERE o.payment_status = 'paid' AND o.refunded_at IS NULL GROUP BY o.event_id, o.tier`).all();
  for (const r of results) { if (!ids.has(r.event_id)) continue; if (!paid.has(r.event_id)) paid.set(r.event_id, {}); paid.get(r.event_id)[r.tier] = r; }
  let md = new Map();
  try { md = new Map((await db.prepare(`SELECT event_id, matchday FROM league_fixtures WHERE event_id IS NOT NULL`).all()).results.map(r => [r.event_id, r.matchday])); } catch { /* no league */ }
  return rows.map(({ row, s }) => {
    const st = settings.get(row.id) || null;
    const t = ticketState({ ...row, is_home: true, status: s.status }, st, held.get(row.id) || {});
    const p = paid.get(row.id) || {};
    return {
      id: row.id, matchday: md.get(row.id) ?? null, homeTeam: row.home_team, awayTeam: row.away_team, kickoff: row.event_date, venue: row.venue, status: s.status,
      state: t.state, isOnSale: !!st?.is_on_sale, saleOpensAt: st?.sale_opens_at || null, saleClosesAt: st?.sale_closes_at || null, maxPerOrder: st?.max_per_order || 10,
      tiers: TIERS.map(tr => ({ tier: tr, label: TIER_LABELS[tr], priceNaira: (Number(row[PRICE_COL[tr]]) || 0) / 100, capacity: st?.[CAP_COL[tr]] ?? null,
        sold: Number(p[tr]?.sold) || 0, revenueKobo: Number(p[tr]?.revenue) || 0, held: Number(held.get(row.id)?.[tr]) || 0 })),
    };
  }).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
}
