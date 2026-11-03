import { ticketAuth, ok, fail } from '../../_lib/ticketAdmin.js';
import { ensureTicketShopSchema } from '../../_lib/ticketShop.js';
import { TIERS, TIER_LABELS } from '../../_lib/tickets/rules.js';

// GET /api/admin/tickets/sales[?event=<id>] -- the Ticket Sales dashboard (paid online sales only,
// refunds left out): totals, every home match by stand (tickets, % and money), where buyers came
// from, their city / state and device, sales by day, checkouts started vs paid, and the latest
// purchases. The page asks again every 15 seconds.
const PAID = `payment_status = 'paid' AND refunded_at IS NULL`;
export async function onRequestGet({ request, env }) {
  const { denied } = await ticketAuth(request, env);
  if (denied) return denied;
  const db = env.DB;
  try {
    await ensureTicketShopSchema(db);
    const ev = new URL(request.url).searchParams.get('event') || '';
    const f = ev ? ' AND event_id = ?' : '';
    const bind = q => (ev ? db.prepare(q).bind(ev) : db.prepare(q));
    const [byMatchTier, sources, places, devices, daily, started, recent, matches] = await Promise.all([
      db.prepare(`SELECT event_id, tier, SUM(quantity) AS tickets, SUM(total_kobo) AS kobo, COUNT(DISTINCT buyer_email) AS buyers FROM orders WHERE ${PAID} GROUP BY event_id, tier`).all(),
      bind(`SELECT COALESCE(source, 'Before tracking') AS name, SUM(quantity) AS tickets, SUM(total_kobo) AS kobo FROM orders WHERE ${PAID}${f} GROUP BY 1 ORDER BY tickets DESC`).all(),
      bind(`SELECT COALESCE(NULLIF(region, ''), 'Before tracking') AS region, COALESCE(NULLIF(city, ''), '') AS city, SUM(quantity) AS tickets FROM orders WHERE ${PAID}${f} GROUP BY 1, 2 ORDER BY tickets DESC LIMIT 20`).all(),
      bind(`SELECT COALESCE(device, 'Before tracking') AS name, SUM(quantity) AS tickets FROM orders WHERE ${PAID}${f} GROUP BY 1 ORDER BY tickets DESC`).all(),
      bind(`SELECT substr(datetime(COALESCE(paid_at, created_at), '+1 hour'), 1, 10) AS day, SUM(quantity) AS tickets, SUM(total_kobo) AS kobo FROM orders WHERE ${PAID}${f} GROUP BY 1 ORDER BY 1 DESC LIMIT 30`).all(),
      bind(`SELECT COUNT(DISTINCT COALESCE(basket_id, id)) AS checkouts, COUNT(DISTINCT CASE WHEN payment_status = 'paid' THEN COALESCE(basket_id, id) END) AS paid,
        COUNT(DISTINCT CASE WHEN payment_status = 'pending' AND created_at > datetime('now', '-30 minutes') THEN COALESCE(basket_id, id) END) AS paying_now FROM orders WHERE 1 = 1${f}`).first(),
      bind(`SELECT o.id, o.event_id, o.buyer_name, o.tier, o.quantity, o.total_kobo, o.source, o.city, o.region, o.device, COALESCE(o.paid_at, o.created_at) AS at, e.home_team, e.away_team
        FROM orders o LEFT JOIN events e ON e.id = o.event_id WHERE ${PAID.replace(/payment_status|refunded_at/g, m => `o.${m}`)}${ev ? ' AND o.event_id = ?' : ''} ORDER BY COALESCE(o.paid_at, o.created_at) DESC LIMIT 40`).all(),
      db.prepare(`SELECT id, home_team, away_team, event_date FROM events WHERE active = 1 AND home_team LIKE '%Lobi Stars%' ORDER BY event_date`).all(),
    ]);
    // Per match, per stand.
    const per = new Map();
    for (const m of matches.results) per.set(m.id, { id: m.id, name: `${m.home_team} vs ${m.away_team}`, date: m.event_date, tickets: 0, kobo: 0, buyers: 0, tiers: Object.fromEntries(TIERS.map(t => [t, { tickets: 0, kobo: 0 }])) });
    for (const r of byMatchTier.results) {
      const m = per.get(r.event_id) || per.set(r.event_id, { id: r.event_id, name: 'Other / removed match', date: null, tickets: 0, kobo: 0, buyers: 0, tiers: Object.fromEntries(TIERS.map(t => [t, { tickets: 0, kobo: 0 }])) }).get(r.event_id);
      const t = m.tiers[r.tier] || (m.tiers[r.tier] = { tickets: 0, kobo: 0 });
      t.tickets += r.tickets || 0; t.kobo += r.kobo || 0; m.tickets += r.tickets || 0; m.kobo += r.kobo || 0; m.buyers += r.buyers || 0;
    }
    // Upcoming home matches, and any earlier match that sold tickets (oldest first).
    const cutoff = Date.now() - 86400e3;
    const list = [...per.values()].filter(m => m.kobo > 0 || m.tickets > 0 || m.id === ev || (m.date && Date.parse(m.date) >= cutoff)).sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));
    const scope = ev ? list.filter(m => m.id === ev) : list;
    const tiers = TIERS.map(t => ({ tier: t, label: TIER_LABELS[t], tickets: scope.reduce((s, m) => s + (m.tiers[t]?.tickets || 0), 0), kobo: scope.reduce((s, m) => s + (m.tiers[t]?.kobo || 0), 0) }));
    const tickets = tiers.reduce((s, t) => s + t.tickets, 0), kobo = tiers.reduce((s, t) => s + t.kobo, 0);
    for (const t of tiers) t.percent = tickets ? Math.round((t.tickets / tickets) * 1000) / 10 : 0;
    const buyers = (await bind(`SELECT COUNT(DISTINCT buyer_email) AS n FROM orders WHERE ${PAID}${f}`).first())?.n || 0;
    return ok({
      at: new Date().toISOString(), event: ev || null,
      totals: { tickets, kobo, buyers, checkouts: started?.checkouts || 0, paidCheckouts: started?.paid || 0, payingNow: started?.paying_now || 0 },
      tiers, matches: list.map(m => ({ ...m, tiers: TIERS.map(t => ({ tier: t, label: TIER_LABELS[t], ...m.tiers[t] })) })),
      sources: sources.results, places: places.results, devices: devices.results, daily: daily.results.reverse(),
      recent: recent.results.map(r => ({ id: r.id, at: r.at, match: r.home_team ? `${r.home_team} vs ${r.away_team}` : r.event_id, buyer: r.buyer_name, tier: TIER_LABELS[r.tier] || r.tier, qty: r.quantity, kobo: r.total_kobo, source: r.source || 'Before tracking', place: [r.city, r.region].filter(Boolean).join(', ') || '—', device: r.device || '—' })),
    });
  } catch (err) {
    console.error('[tickets admin] sales', err);
    return fail('Could not load the ticket sales.', 500);
  }
}
