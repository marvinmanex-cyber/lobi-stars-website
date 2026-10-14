// Ticket and match-list rules, as pure functions (no database, no
// Cloudflare-only APIs) so Functions, pages and Node tests share them.

export const TIERS = ['VIP', 'Premium', 'Regular'];
export const TIER_LABELS = { VIP: 'VIP Sitting', Premium: 'Cover Stand', Regular: 'Popular Stand' };
export const PRICE_COL = { VIP: 'vip_price_kobo', Premium: 'premium_price_kobo', Regular: 'regular_price_kobo' };
export const CAP_COL = { VIP: 'vip_capacity', Premium: 'premium_capacity', Regular: 'regular_capacity' };
export const DEFAULT_MAX_PER_ORDER = 10;
const LIVE = ['live', 'half-time'];
const GONE = ['full-time', 'cancelled', 'abandoned'];

/** "₦5,000" */
export const naira = kobo => `₦${Math.round(Number(kobo || 0) / 100).toLocaleString('en-NG')}`;

/**
 * The Lobi Stars match list: every unfinished match (not full time,
 * cancelled or abandoned), in kick-off order, with any live match first.
 * Postponed matches keep their place (their original date). The league's own
 * status (league_status, from League › Fixtures/Results) counts too: a league
 * result or postponement there is enough.
 */
const LEAGUE_GONE = ['full_time', 'awarded', 'cancelled', 'abandoned'];
export function upcomingMatches(matches, now = Date.now()) {
  return matches
    .filter(m => !GONE.includes(m.status) && !LEAGUE_GONE.includes(m.league_status))
    .map(m => (m.league_status === 'postponed' && !LIVE.includes(m.status) && m.status !== 'postponed' ? { ...m, status: 'postponed' } : m))
    .filter(m => LIVE.includes(m.status) || m.status === 'postponed' || Date.parse(m.event_date) > now - 2.25 * 3600e3)
    .sort((a, b) => (LIVE.includes(b.status) - LIVE.includes(a.status)) || Date.parse(a.event_date) - Date.parse(b.event_date));
}

const isLobi = name => /lobi stars/i.test(name || '');

/**
 * THE next Lobi Stars match, used by every "next match" on the site (the
 * homepage Upcoming Matches card and the Match Day Programme strip), so they
 * never disagree: a live match until it ends, otherwise the earliest
 * unfinished one; postponed matches are skipped until they have a new date.
 * Returns the match or null.
 */
export function nextLobiMatch(matches, now = Date.now()) {
  return upcomingMatches(matches.filter(m => isLobi(m.home_team) || isLobi(m.away_team)), now).find(m => m.status !== 'postponed') || null;
}

/**
 * The match in the homepage match bar: THE next match (nextLobiMatch); only
 * when every remaining match is postponed, the first postponed one (shown as
 * "Postponed – date to be confirmed"). null hides the bar.
 */
export function matchBarMatch(matches, now = Date.now()) {
  const lobi = matches.filter(m => isLobi(m.home_team) || isLobi(m.away_team));
  return nextLobiMatch(lobi, now) || upcomingMatches(lobi, now)[0] || null;
}

/** The other club in a Lobi Stars match (its full name), and whether Lobi Stars are at home. */
export const opponentOf = m => (isLobi(m.home_team) ? m.away_team : m.home_team);
export const lobiAtHome = m => isLobi(m.home_team);

/**
 * Can tickets be bought for this match? One of:
 *   'on_sale'      buy now (tiers with a price and seats left)
 *   'sold_out'     every priced stand is full
 *   'not_on_sale'  switched off, no prices, or sales haven't opened yet (opensAt)
 *   'closed'       kicked off, finished, postponed or past the closing time
 *   'away'         Lobi Stars are away: tickets are never sold here
 * settings: { is_on_sale, sale_opens_at, sale_closes_at, max_per_order, <tier>_capacity }
 * sold: { VIP: n, Premium: n, Regular: n } (paid tickets + seats held by unpaid orders)
 */
export function ticketState(event, settings, sold = {}, now = Date.now()) {
  const home = event.is_home === true || event.is_home === 1;
  if (!home) return { state: 'away', tiers: [], maxPerOrder: 0 };
  const kickoff = Date.parse(event.event_date);
  const maxPerOrder = Math.max(1, Math.min(10, Number(settings?.max_per_order) || DEFAULT_MAX_PER_ORDER));
  const tiers = TIERS.map(t => {
    const price = Number(event[PRICE_COL[t]]) || 0;
    const cap = settings?.[CAP_COL[t]];
    const capacity = cap === null || cap === undefined || cap === '' ? null : Number(cap);
    const remaining = capacity === null ? null : Math.max(0, capacity - (Number(sold[t]) || 0));
    return { tier: t, label: TIER_LABELS[t], priceKobo: price, capacity, remaining };
  }).filter(t => t.priceKobo > 0);
  const base = { tiers, maxPerOrder };
  if (event.active === 0 || (event.status && event.status !== 'scheduled') || !(kickoff > now)) return { ...base, state: 'closed' };
  if (settings?.sale_closes_at && Date.parse(settings.sale_closes_at) <= now) return { ...base, state: 'closed' };
  if (!settings || !settings.is_on_sale || !tiers.length) return { ...base, state: 'not_on_sale' };
  if (settings.sale_opens_at && Date.parse(settings.sale_opens_at) > now) return { ...base, state: 'not_on_sale', opensAt: settings.sale_opens_at };
  if (tiers.every(t => t.remaining === 0)) return { ...base, state: 'sold_out' };
  return { ...base, state: 'on_sale' };
}

/** Short text for a card or list row. */
export function ticketLabel(t) {
  if (!t) return '';
  return { on_sale: 'Buy ticket', sold_out: 'Sold out', not_on_sale: 'Tickets not on sale yet', closed: 'Ticket sales closed', away: 'Away fixture' }[t.state] || '';
}

/**
 * Checks and prices a basket. lines: [{ eventId, tier, quantity }];
 * catalogue: Map eventId -> { event, ticket } (ticket from ticketState).
 * Returns { ok, lines: [{ ..., unitKobo, totalKobo }], totalKobo } or { ok: false, error, eventId? }.
 */
export function priceBasket(lines, catalogue) {
  if (!Array.isArray(lines) || !lines.length) return { ok: false, error: 'Choose at least one match.' };
  if (lines.length > 30) return { ok: false, error: 'Too many lines in one order.' };
  const seen = new Set(), out = [];
  for (const l of lines) {
    const key = `${l.eventId}|${l.tier}`;
    if (seen.has(key)) return { ok: false, error: 'Each match and stand can only be added once.' };
    seen.add(key);
    const c = catalogue.get(String(l.eventId));
    if (!c) return { ok: false, error: 'One of the matches was not found.', eventId: l.eventId };
    const name = `${c.event.home_team} vs ${c.event.away_team}`;
    if (c.ticket.state === 'away') return { ok: false, error: `${name} is an away match: tickets are sold by the home club.`, eventId: l.eventId };
    if (c.ticket.state !== 'on_sale') return { ok: false, error: `Tickets for ${name} are not on sale.`, eventId: l.eventId };
    const tier = c.ticket.tiers.find(t => t.tier === l.tier);
    if (!tier) return { ok: false, error: `Choose a stand for ${name}.`, eventId: l.eventId };
    const q = Number(l.quantity);
    if (!Number.isInteger(q) || q < 1 || q > c.ticket.maxPerOrder) return { ok: false, error: `You can buy 1 to ${c.ticket.maxPerOrder} tickets for ${name}.`, eventId: l.eventId };
    if (tier.remaining !== null && tier.remaining < q) {
      return { ok: false, soldOut: true, error: tier.remaining ? `Only ${tier.remaining} ${tier.label} ticket${tier.remaining === 1 ? '' : 's'} left for ${name}.` : `${tier.label} is sold out for ${name}.`, eventId: l.eventId };
    }
    out.push({ eventId: String(l.eventId), tier: l.tier, quantity: q, unitKobo: tier.priceKobo, totalKobo: tier.priceKobo * q });
  }
  return { ok: true, lines: out, totalKobo: out.reduce((s, l) => s + l.totalKobo, 0) };
}

/**
 * Season Ticket saving: when every remaining home match on sale is selected
 * in one stand with the same number of tickets, compare with Season Tickets
 * for that stand. season: { enabled, tiers: [{ tier, priceKobo }] }.
 */
export function seasonSaving(lines, onSaleHomeIds, season) {
  if (!season?.enabled || !lines.length || !onSaleHomeIds.length) return null;
  const tiers = [...new Set(lines.map(l => l.tier))], qtys = [...new Set(lines.map(l => l.quantity))];
  if (tiers.length !== 1 || qtys.length !== 1) return null;
  const ids = new Set(lines.map(l => String(l.eventId)));
  if (!onSaleHomeIds.every(id => ids.has(String(id)))) return null;
  const st = season.tiers?.find(t => t.tier === tiers[0]);
  if (!st || !(st.priceKobo > 0)) return null;
  const matchTotal = lines.reduce((s, l) => s + l.unitKobo * l.quantity, 0);
  const seasonTotal = st.priceKobo * qtys[0];
  return matchTotal > seasonTotal ? { tier: tiers[0], quantity: qtys[0], seasonTotalKobo: seasonTotal, matchTotalKobo: matchTotal, savingKobo: matchTotal - seasonTotal } : null;
}

/** Gate result for a ticket: 'valid' | 'used' | 'wrong_match' | 'void' (pure, for tests and the scanner). */
export function gateState(ticket, event, now = Date.now()) {
  if (!ticket) return 'not_found';
  if (ticket.status === 'void') return 'void';
  if (ticket.status === 'used') return 'used';
  const day = d => new Date(Date.parse(d) + 3600e3).toISOString().slice(0, 10);
  if (event && day(event.event_date) !== day(new Date(now).toISOString())) return 'wrong_match';
  return 'valid';
}
