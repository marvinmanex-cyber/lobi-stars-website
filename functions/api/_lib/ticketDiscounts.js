// Ticket discounts, database side: tables, the three rules (seeded OFF),
// global settings, discounted tickets already used per match, pricing a
// basket with the server clock, the locked snapshot re-check for the webhook,
// and the admin report. The maths itself is tickets/discounts.js (pure).
import { computeOrderPricing, publicOffers, DEFAULT_SETTINGS } from './tickets/discounts.js';
import { HOLD_MINUTES } from './ticketShop.js';
import { CAP_COL } from './tickets/rules.js';

export const SETTING_KEYS = {
  allowStacking: 'tickets_discount_allow_stacking',
  maxTotalBp: 'tickets_discount_max_total_bp',
  minTicketKobo: 'tickets_discount_min_ticket_kobo',
  perEmailPerMatch: 'tickets_discount_per_email_per_match',
};

// Suggested defaults. Every rule starts OFF; the admin switches them on.
export const SEED_RULES = [
  { id: 'group', kind: 'group', name: 'Group discount', percentBp: 0, config: {}, tiers: [{ minTickets: 10, percentBp: 1000 }, { minTickets: 20, percentBp: 1500 }] },
  { id: 'early_bird', kind: 'early_bird', name: 'Early bird', percentBp: 1000, config: { daysBefore: 7 } },
  { id: 'family', kind: 'family', name: 'Family bundle', percentBp: 1500, config: { minAdults: 1, maxAdults: 2, minChildren: 1, maxChildren: 4, childMaxAge: 16 } },
];

let ready = false;
/** Creates the discount tables and columns (safe to run every time; also in migrations/0005). */
export async function ensureDiscountSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS league_ticket_discount_rules (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('group', 'early_bird', 'family')),
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      percent_bp INTEGER NOT NULL DEFAULT 0,
      valid_from TEXT, valid_until TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      max_discounted_tickets_per_match INTEGER,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS league_ticket_group_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL,
      min_tickets INTEGER NOT NULL,
      percent_bp INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_league_ticket_group_tiers_rule ON league_ticket_group_tiers (rule_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
  ]);
  const cols = async t => new Set((await db.prepare(`PRAGMA table_info(${t})`).all()).results.map(c => c.name));
  // Two first requests at once can both add a column: the second one's "duplicate column" is fine.
  const add = async (t, have, defs) => { for (const [c, d] of defs) if (!have.has(c)) await db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`).run().catch(err => { if (!/duplicate column/i.test(String(err))) throw err; }); };
  await add('league_ticket_orders', await cols('league_ticket_orders'), [
    ['subtotal_kobo', 'INTEGER'], ['discount_kobo', 'INTEGER NOT NULL DEFAULT 0'], ['discount_rule_id', 'TEXT'],
    ['discount_label', 'TEXT'], ['discount_snapshot_json', 'TEXT'], ['group_name', 'TEXT']]);
  await add('orders', await cols('orders'), [
    ['ticket_type', "TEXT NOT NULL DEFAULT 'adult'"], ['discount_kobo', 'INTEGER NOT NULL DEFAULT 0'],
    ['discount_rule_ids', 'TEXT'], ['discounted_qty', 'INTEGER NOT NULL DEFAULT 0']]);
  await add('tickets', await cols('tickets'), [
    ['ticket_type', "TEXT NOT NULL DEFAULT 'adult'"], ['unit_price_kobo', 'INTEGER'], ['discount_kobo', 'INTEGER NOT NULL DEFAULT 0']]);
  await add('league_ticket_settings', await cols('league_ticket_settings'), [
    ['allow_discounts', 'INTEGER NOT NULL DEFAULT 1'], ['discount_cap', 'INTEGER']]);
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_event_discount ON orders (event_id, discounted_qty)`).run();
  // Seeds: the three rules, all OFF. Existing rules are never changed.
  for (const r of SEED_RULES) {
    const ins = await db.prepare(`INSERT OR IGNORE INTO league_ticket_discount_rules (id, kind, name, is_active, percent_bp, config_json, updated_by) VALUES (?, ?, ?, 0, ?, ?, 'setup')`)
      .bind(r.id, r.kind, r.name, r.percentBp, JSON.stringify(r.config)).run();
    if (ins.meta.changes && r.tiers) await db.batch(r.tiers.map(t => db.prepare(`INSERT INTO league_ticket_group_tiers (rule_id, min_tickets, percent_bp) VALUES (?, ?, ?)`).bind(r.id, t.minTickets, t.percentBp)));
  }
  ready = true;
}

const toRule = (r, tiers) => {
  let config = {};
  try { config = JSON.parse(r.config_json || '{}'); } catch { /* keep {} */ }
  return {
    id: r.id, kind: r.kind, name: r.name, isActive: !!r.is_active, percentBp: Number(r.percent_bp) || 0,
    validFrom: r.valid_from || null, validUntil: r.valid_until || null, config,
    maxPerMatch: r.max_discounted_tickets_per_match == null ? null : Number(r.max_discounted_tickets_per_match),
    tiers: tiers.filter(t => t.rule_id === r.id).map(t => ({ minTickets: Number(t.min_tickets), percentBp: Number(t.percent_bp) })).sort((a, b) => a.minTickets - b.minTickets),
    updatedAt: r.updated_at || null, updatedBy: r.updated_by || null,
  };
};

export async function loadRules(db) {
  await ensureDiscountSchema(db);
  const [{ results: rows }, { results: tiers }] = await Promise.all([
    db.prepare(`SELECT * FROM league_ticket_discount_rules ORDER BY CASE kind WHEN 'group' THEN 1 WHEN 'early_bird' THEN 2 ELSE 3 END, id`).all(),
    db.prepare(`SELECT * FROM league_ticket_group_tiers ORDER BY min_tickets`).all(),
  ]);
  return rows.map(r => toRule(r, tiers));
}

export async function loadDiscountSettings(db) {
  await ensureDiscountSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'tickets_discount_%'`).all();
  const v = new Map(results.map(r => [r.key, r.value]));
  const num = (k, d) => { const n = Number(v.get(SETTING_KEYS[k])); return v.has(SETTING_KEYS[k]) && Number.isFinite(n) ? n : d; };
  return {
    allowStacking: v.get(SETTING_KEYS.allowStacking) === '1',
    maxTotalBp: num('maxTotalBp', DEFAULT_SETTINGS.maxTotalBp),
    minTicketKobo: num('minTicketKobo', DEFAULT_SETTINGS.minTicketKobo),
    perEmailPerMatch: num('perEmailPerMatch', DEFAULT_SETTINGS.perEmailPerMatch),
  };
}

// Orders that count: paid and not refunded, or unpaid but still holding seats.
const LIVE_ORDER = `((o.payment_status = 'paid' AND o.refunded_at IS NULL) OR (o.payment_status = 'pending' AND o.created_at > datetime('now', '-${HOLD_MINUTES} minutes')))`;

/**
 * Per match: discounted tickets already sold or held (per rule and in all),
 * the match's own cap, and this email's earlier group/family orders.
 */
export async function discountContext(db, eventIds, email = '') {
  // Three queries in all (not per match): the catalogue asks for every home match.
  const ids = new Set(eventIds);
  const [rows, st, prior] = await Promise.all([
    db.prepare(`SELECT o.event_id, o.discount_rule_ids AS ids, SUM(o.discounted_qty) AS n FROM orders o WHERE o.discounted_qty > 0 AND ${LIVE_ORDER} GROUP BY o.event_id, o.discount_rule_ids`).all(),
    db.prepare(`SELECT event_id, allow_discounts, discount_cap FROM league_ticket_settings`).all(),
    email ? db.prepare(`SELECT o.event_id, COUNT(DISTINCT o.basket_id) AS n FROM orders o WHERE lower(o.buyer_email) = ? AND (instr(o.discount_rule_ids, ',group,') > 0 OR instr(o.discount_rule_ids, ',family,') > 0) AND ${LIVE_ORDER} GROUP BY o.event_id`).bind(email.toLowerCase()).all() : { results: [] },
  ]);
  const stBy = new Map(st.results.map(r => [r.event_id, r]));
  const priorBy = new Map(prior.results.map(r => [r.event_id, Number(r.n) || 0]));
  const ctx = {};
  for (const id of ids) {
    const s = stBy.get(id);
    ctx[id] = { usedByRule: {}, usedMatch: 0, matchCap: s?.discount_cap ?? null, allowDiscounts: s ? s.allow_discounts !== 0 : true, priorDiscountOrders: priorBy.get(id) || 0 };
  }
  for (const r of rows.results) {
    const c = ctx[r.event_id]; if (!c) continue;
    const n = Number(r.n) || 0; c.usedMatch += n;
    for (const rid of String(r.ids || '').split(',').filter(Boolean)) c.usedByRule[rid] = (c.usedByRule[rid] || 0) + n;
  }
  return ctx;
}

/**
 * Turns the buyer's lines + the priced basket (priceBasket) into pricing
 * lines, then prices them on the server clock. Returns { pricing, input }
 * where input is what gets locked in the order snapshot.
 */
export async function priceWithDiscounts(db, pricedLines, rawByKey, catalogue, email = '', now = Date.now()) {
  const [rules, settings] = await Promise.all([loadRules(db), loadDiscountSettings(db)]);
  const ctx = await discountContext(db, pricedLines.map(l => l.eventId), email);
  const lines = pricedLines.map(l => {
    const raw = rawByKey.get(`${l.eventId}|${l.tier}`) || {};
    const family = !!raw.family;
    return {
      eventId: l.eventId, tier: l.tier, unitKobo: l.unitKobo, kickoff: catalogue.get(l.eventId).event.event_date,
      family, adults: family ? raw.adults : l.quantity, children: family ? raw.children : 0,
      allowDiscounts: ctx[l.eventId].allowDiscounts,
    };
  });
  const pricing = computeOrderPricing(lines, rules, settings, now, ctx);
  return { pricing, input: { v: 1, now, lines, rules: rules.map(({ updatedAt, updatedBy, ...r }) => r), settings, ctx } };
}

/** Badges for the /tickets cards (no personal data). */
export async function offersFor(db, matches, now = Date.now()) {
  try {
    const [rules, settings] = await Promise.all([loadRules(db), loadDiscountSettings(db)]);
    if (!rules.some(r => r.isActive)) return new Map();
    const ctx = await discountContext(db, matches.map(m => m.id));
    return new Map(matches.map(m => [m.id, m.state === 'on_sale' ? publicOffers(rules, settings, { kickoff: m.kickoff, allowDiscounts: ctx[m.id].allowDiscounts }, now, ctx[m.id]) : null]));
  } catch (err) {
    console.error('[discounts] offers', err);
    return new Map();
  }
}

/**
 * Webhook / success-page re-check: the locked snapshot, priced again by the
 * same pure function, must give the stored total, and the order rows must add
 * up to it. Old orders (no snapshot) only need the rows to add up.
 */
export async function lockedTotalOk(db, basket) {
  const rows = await db.prepare(`SELECT COALESCE(SUM(total_kobo), 0) AS t FROM orders WHERE basket_id = ?`).bind(basket.id).first();
  if (Number(rows?.t) !== basket.total_kobo) return false;
  if (!basket.discount_snapshot_json) return true;
  try {
    const s = JSON.parse(basket.discount_snapshot_json);
    const p = computeOrderPricing(s.lines, s.rules, s.settings, s.now, s.ctx);
    return p.ok && p.totalKobo === basket.total_kobo;
  } catch { return false; }
}

/** One orders row per (stand, adult/child, price) and at most 10 tickets (the orders table allows 1 to 10). */
export function orderChunks(pricing, pricedLines) {
  const out = [];
  for (const m of pricing.matches) {
    const groups = new Map();
    for (const t of m.tickets) {
      const line = pricedLines.filter(l => l.eventId === m.eventId)[t.lineIdx];
      const ids = t.ruleIds.length ? `,${t.ruleIds.join(',')},` : null;
      const key = `${line.tier}|${t.type}|${t.discountKobo}|${ids}`;
      if (!groups.has(key)) groups.set(key, { eventId: m.eventId, tier: line.tier, ticketType: t.type, unitKobo: t.unitKobo, discountKobo: t.discountKobo, ruleIds: ids, quantity: 0 });
      groups.get(key).quantity++;
    }
    for (const g of groups.values()) {
      for (let left = g.quantity; left > 0; left -= 10) {
        const q = Math.min(10, left);
        out.push({ ...g, quantity: q, totalKobo: (g.unitKobo - g.discountKobo) * q, rowDiscountKobo: g.discountKobo * q, discountedQty: g.discountKobo > 0 ? q : 0 });
      }
    }
  }
  return out;
}

/** Admin report per rule: orders, tickets, discount given, revenue after discount (paid, not refunded). */
export async function discountReport(db) {
  await ensureDiscountSchema(db);
  const rules = await loadRules(db);
  const { results } = await db.prepare(`SELECT o.basket_id, o.discount_rule_ids AS ids, o.quantity, o.discounted_qty, o.discount_kobo, o.total_kobo, o.ticket_type
    FROM orders o WHERE o.payment_status = 'paid' AND o.refunded_at IS NULL AND o.discounted_qty > 0`).all();
  return rules.map(r => {
    const mine = results.filter(x => String(x.ids || '').includes(`,${r.id},`));
    return {
      ruleId: r.id, kind: r.kind, name: r.name, isActive: r.isActive,
      orders: new Set(mine.map(x => x.basket_id)).size,
      tickets: mine.reduce((t, x) => t + (Number(x.discounted_qty) || 0), 0),
      childTickets: mine.filter(x => x.ticket_type === 'child').reduce((t, x) => t + x.quantity, 0),
      discountKobo: mine.reduce((t, x) => t + (Number(x.discount_kobo) || 0), 0),
      revenueKobo: mine.reduce((t, x) => t + (Number(x.total_kobo) || 0), 0),
    };
  });
}

/**
 * The buyer's lines: [{ eventId, tier, quantity }] or a family bundle
 * [{ eventId, tier, family: true, adults, children }]. Any price or discount
 * the browser sends is ignored. Returns { lines, rawByKey } for priceBasket.
 */
export function parseBuyerLines(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, 31) : [];
  const rawByKey = new Map();
  const lines = list.map(l => {
    const eventId = String(l?.eventId || ''), tier = String(l?.tier || '');
    const family = l?.family === true;
    const adults = family ? Number(l.adults) : null, children = family ? Number(l.children) : null;
    const quantity = family ? (Number.isInteger(adults) && Number.isInteger(children) ? adults + children : NaN) : Number(l?.quantity);
    rawByKey.set(`${eventId}|${tier}`, { family, adults, children });
    return { eventId, tier, quantity };
  });
  return { lines, rawByKey };
}

/** What the browser sees of a price (no rule internals). */
export function publicPricing(pricing) {
  return {
    subtotalKobo: pricing.subtotalKobo, discountKobo: pricing.discountKobo, totalKobo: pricing.totalKobo, label: pricing.label,
    matches: pricing.matches.map(m => ({
      eventId: m.eventId, tickets: m.tickets.length, adults: m.tickets.filter(t => t.type === 'adult').length, children: m.tickets.filter(t => t.type === 'child').length,
      subtotalKobo: m.subtotalKobo, discountKobo: m.discountKobo, totalKobo: m.totalKobo, label: m.label, reason: m.reason, nudge: m.nudge,
      applied: m.applied.map(a => ({ kind: a.kind, name: a.name, percentBp: a.percentBp, tickets: a.tickets })),
    })),
  };
}

/**
 * Holds one orders row (seats + discounted tickets) in ONE statement: it only
 * inserts if the seats still fit AND, for discounted tickets, the rule's and
 * the match's discounted-ticket allowance still has room. Rows of one basket
 * go in one db.batch (a transaction), so later rows see the earlier ones and
 * two buyers can't both take the last seats or the last discounted tickets.
 */
export function holdChunkStatement(db, { orderId, basketId, reference, buyer, chunk }) {
  const cap = CAP_COL[chunk.tier];
  const live = `((o.payment_status = 'paid' AND o.refunded_at IS NULL) OR (o.payment_status = 'pending' AND o.created_at > datetime('now', '-${HOLD_MINUTES} minutes')))`;
  let sql = `INSERT INTO orders (id, event_id, buyer_name, buyer_email, buyer_phone, tier, quantity, unit_price_kobo, total_kobo, paystack_reference, payment_status, basket_id, ticket_type, discount_kobo, discount_rule_ids, discounted_qty)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?
    WHERE ((SELECT ${cap} FROM league_ticket_settings WHERE event_id = ?) IS NULL
       OR (SELECT COUNT(*) FROM tickets WHERE event_id = ? AND tier = ? AND status != 'void')
        + (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE event_id = ? AND tier = ? AND payment_status = 'pending' AND created_at > datetime('now', '-${HOLD_MINUTES} minutes'))
        + ? <= (SELECT ${cap} FROM league_ticket_settings WHERE event_id = ?))`;
  const binds = [orderId, chunk.eventId, buyer.name, buyer.email, buyer.phone, chunk.tier, chunk.quantity, chunk.unitKobo, chunk.totalKobo, reference, basketId,
    chunk.ticketType, chunk.rowDiscountKobo, chunk.ruleIds, chunk.discountedQty,
    chunk.eventId, chunk.eventId, chunk.tier, chunk.eventId, chunk.tier, chunk.quantity, chunk.eventId];
  if (chunk.discountedQty > 0) {
    sql += ` AND ((SELECT discount_cap FROM league_ticket_settings WHERE event_id = ?) IS NULL
       OR (SELECT COALESCE(SUM(o.discounted_qty), 0) FROM orders o WHERE o.event_id = ? AND ${live}) + ? <= (SELECT discount_cap FROM league_ticket_settings WHERE event_id = ?))`;
    binds.push(chunk.eventId, chunk.eventId, chunk.discountedQty, chunk.eventId);
    for (const rid of String(chunk.ruleIds || '').split(',').filter(Boolean)) {
      sql += ` AND ((SELECT max_discounted_tickets_per_match FROM league_ticket_discount_rules WHERE id = ?) IS NULL
       OR (SELECT COALESCE(SUM(o.discounted_qty), 0) FROM orders o WHERE o.event_id = ? AND instr(o.discount_rule_ids, ?) > 0 AND ${live}) + ? <= (SELECT max_discounted_tickets_per_match FROM league_ticket_discount_rules WHERE id = ?))`;
      binds.push(rid, chunk.eventId, `,${rid},`, chunk.discountedQty, rid);
    }
  }
  return db.prepare(sql).bind(...binds);
}
