// Ticketing engine: matches, stands, prices and seats left (GET /events), matched to the
// site's own matches and stands, and fed into the SAME rules the site uses today
// (rules.ticketState), so /tickets, the homepage "from ₦…" and the basket checks look and
// behave the same. Cached briefly (30 s in memory, last good copy in D1 for 10 minutes).
import { engine } from './engineClient.js';
import { getSetting, setSetting, logTicketing } from './engineStore.js';
import { TIERS, TIER_LABELS, PRICE_COL, CAP_COL, MODE_COL, OFF_COL } from '../tickets/rules.js';

const MEMO_MS = 30e3, KEEP_MS = 10 * 60e3, CACHE_KEY = 'ticketing_events_cache';
let memo = { at: 0, events: null };

/** The engine's events, cached. Returns [] when nothing can be had (the matches then show "not on sale"). */
export async function engineEvents(env, { fresh = false } = {}) {
  if (!fresh && memo.events && Date.now() - memo.at < MEMO_MS) return memo.events;
  try {
    const d = await engine.events(env);
    const events = Array.isArray(d?.events) ? d.events : [];
    memo = { at: Date.now(), events };
    await setSetting(env.DB, CACHE_KEY, JSON.stringify({ at: memo.at, events }), 'engine').catch(() => {});
    return events;
  } catch (err) {
    await logTicketing(env, 'error', 'events_failed', { code: err.code, status: err.status });
    try {
      const c = JSON.parse((await getSetting(env.DB, CACHE_KEY)) || 'null');
      if (c && Date.now() - c.at < KEEP_MS) { memo = { at: Date.now() - MEMO_MS / 2, events: c.events }; return c.events; }
    } catch { /* no copy */ }
    return [];
  }
}
export const _resetEngineMemo = () => { memo = { at: 0, events: null }; };

/** Engine stand -> the site's stand (VIP / Premium / Regular), by id or by name. */
export function standTier(stand) {
  const id = String(stand?.stand_id || '').trim().toLowerCase(), name = String(stand?.name || '').trim().toLowerCase();
  for (const t of TIERS) if (id === t.toLowerCase() || name === TIER_LABELS[t].toLowerCase() || name === t.toLowerCase()) return t;
  if (/\bvip\b/.test(name)) return 'VIP';
  if (/grand|premium|covered/.test(name)) return 'Premium';
  if (/popular|regular|open|terrace/.test(name)) return 'Regular';
  return null;
}

/** The site's match for an engine event: the home match kicking off within 3 hours of it (closest first). */
export function matchLocal(ev, locals) {
  const k = Date.parse(ev?.kickoff_at);
  if (!Number.isFinite(k)) return null;
  const name = String(ev.name || '').toLowerCase();
  const near = locals.filter(r => Math.abs(Date.parse(r.event_date) - k) <= 3 * 3600e3)
    .sort((a, b) => (name.includes(String(b.away_team || '').toLowerCase()) - name.includes(String(a.away_team || '').toLowerCase())) || Math.abs(Date.parse(a.event_date) - k) - Math.abs(Date.parse(b.event_date) - k));
  return near[0] || null;
}

/**
 * Both directions: local event id -> { ev, stands: Map(tier -> stand) } and
 * engine event id -> { localId, tiers: Map(stand_id -> tier) }.
 */
export function buildIndex(events, localRows) {
  const homes = localRows.filter(r => r.is_home === 1 || r.is_home === true || r.is_home === undefined);
  const byLocal = new Map(), byEngine = new Map();
  for (const ev of events || []) {
    const local = matchLocal(ev, homes);
    const stands = new Map(), tiers = new Map();
    for (const s of ev.stands || []) { const t = standTier(s); if (t && !stands.has(t)) { stands.set(t, s); tiers.set(String(s.stand_id), t); } }
    byEngine.set(String(ev.event_id), { localId: local?.id || null, ev, tiers });
    if (local && !byLocal.has(local.id)) byLocal.set(local.id, { ev, stands });
  }
  return { byLocal, byEngine };
}

/**
 * A local match row and its settings rewritten from the engine, for ticketState:
 * prices from the engine, on sale between sale_open and sale_close, a stand the
 * engine does not sell is "opening soon", no local amount off. Seats left are set
 * afterwards (fixRemaining). A match the engine does not list is not on sale.
 */
export function engineRowAndSettings(row, settings, entry) {
  if (!entry) return { row, settings: settings ? { ...settings, is_on_sale: 0 } : null };
  const r = { ...row }, s = { ...(settings || {}), event_id: row.id };
  for (const t of TIERS) {
    const st = entry.stands.get(t);
    r[PRICE_COL[t]] = st ? Math.max(0, Math.round(Number(st.price_kobo) || 0)) : 0;
    s[CAP_COL[t]] = null; s[OFF_COL[t]] = 0;
    s[MODE_COL[t]] = !st ? 'soon' : Number(st.price_kobo) === 0 ? 'free' : 'paid';
  }
  s.is_on_sale = 1;
  s.sale_opens_at = entry.ev.sale_open || null;
  s.sale_closes_at = entry.ev.sale_close || null;
  s.max_per_order = settings?.max_per_order ?? 10;
  return { row: r, settings: s };
}
/** Seats left from the engine (its "available"), after ticketState. */
export function fixRemaining(ticket, entry) {
  if (!entry || !ticket?.tiers) return ticket;
  for (const t of ticket.tiers) {
    const st = entry.stands.get(t.tier);
    if (st && st.available !== undefined && st.available !== null) t.remaining = Math.max(0, Number(st.available) || 0);
  }
  const open = ticket.tiers.filter(t => !t.soon);
  if (ticket.state === 'on_sale' && open.length && open.every(t => t.remaining === 0)) ticket.state = 'sold_out';
  return ticket;
}
