// Ticket discounts: Group, Early bird and Family bundle. PURE functions only
// (no database), so the checkout preview, order creation and the Paystack
// webhook re-check all get exactly the same numbers. The database side
// (loading rules, allowances, saving) is in ../ticketDiscounts.js.
//
// Money is integer kobo; percents are basis points (1000 = 10.00%).
// Each discount is rounded DOWN to whole naira (a multiple of 100 kobo), so
// the club never gives away fractions. Discounts are worked out PER MATCH.

export const KINDS = ['group', 'early_bird', 'family'];
export const KIND_LABELS = { group: 'Group', early_bird: 'Early bird', family: 'Family bundle' };
export const DEFAULT_SETTINGS = { allowStacking: false, maxTotalBp: 2500, minTicketKobo: 0, perEmailPerMatch: 1 };
const DAY = 864e5;

export const pct = bp => `${(bp / 100).toFixed(bp % 100 ? (bp % 10 ? 2 : 1) : 0)}%`;

/** Is the rule switched on and inside its dates at `now`? */
export function ruleLive(rule, now) {
  if (!rule || !rule.isActive) return false;
  if (rule.validFrom && Date.parse(rule.validFrom) > now) return false;
  if (rule.validUntil && Date.parse(rule.validUntil) <= now) return false;
  return true;
}

/** Group percent for n tickets: the highest tier reached (tiers ascending by minTickets). */
export function groupPercent(rule, n) {
  let bp = 0;
  for (const t of [...(rule.tiers || [])].sort((a, b) => a.minTickets - b.minTickets)) if (n >= t.minTickets) bp = t.percentBp;
  return bp;
}

/** When the early-bird price ends for a match (kick-off minus daysBefore, or the rule's end date if sooner). */
export function earlyBirdEndsAt(rule, kickoff) {
  const days = Number(rule.config?.daysBefore ?? 7);
  let end = Date.parse(kickoff) - days * DAY;
  if (rule.validUntil) end = Math.min(end, Date.parse(rule.validUntil));
  return end;
}

/** Family composition check. Returns null when fine, or the reason. */
export function familyProblem(rule, adults, children) {
  const c = { minAdults: 1, maxAdults: 2, minChildren: 1, maxChildren: 4, childMaxAge: 16, ...(rule?.config || {}) };
  if (!Number.isInteger(adults) || !Number.isInteger(children)) return 'Choose the number of adults and children.';
  if (adults < Math.max(1, c.minAdults) || adults > c.maxAdults) return `A family bundle has ${c.minAdults === c.maxAdults ? c.minAdults : `${Math.max(1, c.minAdults)} or ${c.maxAdults}`} adult${c.maxAdults === 1 ? '' : 's'}.`;
  if (children < c.minChildren || children > c.maxChildren) return `A family bundle has ${c.minChildren} to ${c.maxChildren} children under ${c.childMaxAge}.`;
  return null;
}

/** Plain-language family rule for the page. */
export function familyText(rule) {
  const c = { minAdults: 1, maxAdults: 2, maxChildren: 4, childMaxAge: 16, ...(rule?.config || {}) };
  const adults = c.minAdults === c.maxAdults ? `${c.maxAdults}` : `${Math.max(1, c.minAdults)} or ${c.maxAdults}`;
  return `${adults} adult${c.maxAdults === 1 ? '' : 's'} with up to ${c.maxChildren} children under ${c.childMaxAge}. Children may be asked for proof of age at the gate.`;
}

const floorNaira = k => Math.floor(k / 100) * 100;

/**
 * Prices an order.
 *  lines:  [{ eventId, tier, unitKobo, kickoff, adults, children, family, allowDiscounts }]
 *          (a normal line: adults = quantity, children = 0, family = false)
 *  rules:  [{ id, kind, name, isActive, percentBp, validFrom, validUntil, config, maxPerMatch, tiers: [{ minTickets, percentBp }] }]
 *  settings: { allowStacking, maxTotalBp, minTicketKobo, perEmailPerMatch }
 *  now:    ms (the SERVER clock at order time)
 *  ctx:    { [eventId]: { usedByRule: { ruleId: n }, usedMatch: n, matchCap: n|null, priorDiscountOrders: n } }
 *          discounted tickets already sold or held for that match, and this
 *          email's earlier group/family orders for it.
 * Returns { ok: true, matches: [...], subtotalKobo, discountKobo, totalKobo, label, reason, applied }
 *      or { ok: false, error, eventId }.
 */
export function computeOrderPricing(lines, rules, settings = {}, now = Date.now(), ctx = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const byKind = {};
  for (const r of rules || []) if (KINDS.includes(r.kind) && !byKind[r.kind] && ruleLive(r, now)) byKind[r.kind] = r;
  const events = [];
  const perEvent = new Map();
  for (const l of lines || []) {
    if (!perEvent.has(l.eventId)) { perEvent.set(l.eventId, []); events.push(l.eventId); }
    perEvent.get(l.eventId).push(l);
  }

  const matches = [];
  for (const eventId of events) {
    const ls = perEvent.get(eventId);
    const c = ctx[eventId] || {};
    const fam = ls.filter(l => l.family);
    if (fam.length && (fam.length > 1 || ls.length > 1)) return { ok: false, error: 'A family bundle is for one stand of one match: remove the other tickets for that match or pay for them separately.', eventId };
    if (fam.length) {
      if (!byKind.family) return { ok: false, error: 'The family bundle is not available for this match.', eventId };
      const why = familyProblem(byKind.family, fam[0].adults, fam[0].children);
      if (why) return { ok: false, error: why, eventId };
    } else if (ls.some(l => (l.children || 0) > 0)) {
      return { ok: false, error: 'Child tickets are only sold as part of a family bundle.', eventId };
    }

    // One entry per ticket (adults first, so a capped allowance goes to the same tickets every time).
    const tickets = [];
    ls.forEach((l, lineIdx) => {
      for (let i = 0; i < (l.adults || 0); i++) tickets.push({ lineIdx, type: 'adult', unitKobo: l.unitKobo });
      for (let i = 0; i < (l.children || 0); i++) tickets.push({ lineIdx, type: 'child', unitKobo: l.unitKobo });
    });
    const n = tickets.length;
    const allow = ls.every(l => l.allowDiscounts !== false);
    const kickoff = ls[0].kickoff;

    // Eligible rules for this match.
    const cands = [];
    if (allow) {
      const g = byKind.group;
      const emailOk = !(s.perEmailPerMatch > 0 && (c.priorDiscountOrders || 0) >= s.perEmailPerMatch);
      if (g && !fam.length && emailOk) { const bp = groupPercent(g, n); if (bp > 0) cands.push({ rule: g, bp }); }
      if (byKind.family && fam.length && emailOk) cands.push({ rule: byKind.family, bp: byKind.family.percentBp });
      const e = byKind.early_bird;
      if (e && kickoff && now <= earlyBirdEndsAt(e, kickoff) && e.percentBp > 0) cands.push({ rule: e, bp: e.percentBp });
    }
    // How many tickets each rule may still discount at this match.
    const matchLeft = c.matchCap == null ? Infinity : Math.max(0, c.matchCap - (c.usedMatch || 0));
    const ruleLeft = r => r.maxPerMatch == null ? Infinity : Math.max(0, r.maxPerMatch - (c.usedByRule?.[r.id] || 0));
    const cap = Math.max(0, Math.min(10000, s.maxTotalBp ?? 10000));
    const priceTickets = chosen => {
      const left = Math.min(matchLeft, n);
      const counts = new Map(chosen.map(x => [x.rule.id, Math.min(ruleLeft(x.rule), left)]));
      const used = new Map(chosen.map(x => [x.rule.id, 0]));
      return tickets.map((t, i) => {
        let bp = 0; const ids = [];
        if (i < left) for (const x of chosen) { if (used.get(x.rule.id) < counts.get(x.rule.id)) { bp += x.bp; ids.push(x.rule.id); used.set(x.rule.id, used.get(x.rule.id) + 1); } }
        bp = Math.min(bp, cap);
        let d = floorNaira(Math.floor(t.unitKobo * bp / 10000));
        d = Math.max(0, Math.min(d, t.unitKobo - (s.minTicketKobo || 0)));
        if (d <= 0) return { ...t, discountKobo: 0, priceKobo: t.unitKobo, ruleIds: [] };
        return { ...t, discountKobo: d, priceKobo: t.unitKobo - d, ruleIds: ids };
      });
    };
    let priced, chosen = [], reason = '';
    if (s.allowStacking && cands.length > 1) {
      chosen = cands; priced = priceTickets(cands);
      reason = `${cands.map(x => KIND_LABELS[x.rule.kind]).join(' and ')} combined${cap < cands.reduce((t, x) => t + x.bp, 0) ? ` (capped at ${pct(cap)})` : ''}.`;
    } else {
      // The single best discount (largest saving); ties: group, family, early bird.
      let best = null;
      for (const x of cands) {
        const p = priceTickets([x]);
        const saved = p.reduce((t, k) => t + k.discountKobo, 0);
        if (saved > 0 && (!best || saved > best.saved)) best = { x, p, saved };
      }
      if (best) {
        chosen = [best.x]; priced = best.p;
        const others = cands.filter(x => x !== best.x).map(x => KIND_LABELS[x.rule.kind]);
        reason = others.length ? `${KIND_LABELS[best.x.rule.kind]} applies: it saves you the most, and discounts are not combined.` : '';
      } else priced = priceTickets([]);
    }
    const sub = priced.reduce((t, k) => t + k.unitKobo, 0);
    const disc = priced.reduce((t, k) => t + k.discountKobo, 0);
    const applied = disc > 0 ? chosen.map(x => ({
      ruleId: x.rule.id, kind: x.rule.kind, name: x.rule.name || KIND_LABELS[x.rule.kind], percentBp: x.bp,
      tickets: priced.filter(k => k.ruleIds.includes(x.rule.id)).length,
    })).filter(a => a.tickets > 0) : [];
    const discountedQty = priced.filter(k => k.discountKobo > 0).length;
    // Nudge: close to a group tier that would save more.
    let nudge = null;
    const g = byKind.group;
    if (allow && g && !fam.length && !(s.perEmailPerMatch > 0 && (c.priorDiscountOrders || 0) >= s.perEmailPerMatch)) {
      const next = [...(g.tiers || [])].sort((a, b) => a.minTickets - b.minTickets).find(t => t.minTickets > n);
      const curBp = applied.reduce((t, a) => t + a.percentBp, 0);
      if (next && next.minTickets - n <= 3 && next.percentBp > curBp) nudge = { add: next.minTickets - n, percentBp: next.percentBp, text: `Add ${next.minTickets - n} more ticket${next.minTickets - n === 1 ? '' : 's'} to save ${pct(next.percentBp)}.` };
    }
    matches.push({
      eventId, tickets: priced, subtotalKobo: sub, discountKobo: disc, totalKobo: sub - disc, discountedQty, applied,
      label: applied.length ? applied.map(a => `${KIND_LABELS[a.kind]} (${pct(a.percentBp)})`).join(' + ') : '',
      reason: applied.length ? (reason || (discountedQty < n ? `Discount on ${discountedQty} of ${n} tickets (limited number of discounted tickets).` : '')) : '',
      nudge,
    });
  }
  const subtotalKobo = matches.reduce((t, m) => t + m.subtotalKobo, 0);
  const discountKobo = matches.reduce((t, m) => t + m.discountKobo, 0);
  const kinds = new Map();
  for (const m of matches) for (const a of m.applied) if (!kinds.has(a.ruleId)) kinds.set(a.ruleId, a);
  return {
    ok: true, matches, subtotalKobo, discountKobo, totalKobo: subtotalKobo - discountKobo,
    applied: [...kinds.values()],
    label: [...kinds.values()].map(a => `${KIND_LABELS[a.kind]} (${pct(a.percentBp)})`).join(' + '),
  };
}

/**
 * What the /tickets page shows on a match card (badges and the early-bird
 * deadline). Only rules that are on, in date and still have discounted
 * tickets left for this match; nothing at all when the match excludes discounts.
 */
export function publicOffers(rules, settings, match, now = Date.now(), c = {}) {
  if (match.allowDiscounts === false) return null;
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const matchLeft = c.matchCap == null ? Infinity : c.matchCap - (c.usedMatch || 0);
  if (matchLeft <= 0) return null;
  const live = KINDS.map(k => (rules || []).find(r => r.kind === k && ruleLive(r, now))).filter(Boolean)
    .filter(r => r.maxPerMatch == null || r.maxPerMatch - (c.usedByRule?.[r.id] || 0) > 0);
  const out = {};
  const cap = bp => Math.min(bp, s.maxTotalBp ?? 10000);
  for (const r of live) {
    if (r.kind === 'group' && (r.tiers || []).length) {
      const tiers = [...r.tiers].sort((a, b) => a.minTickets - b.minTickets).map(t => ({ minTickets: t.minTickets, percentBp: cap(t.percentBp) }));
      out.group = { minTickets: tiers[0].minTickets, maxPercentBp: Math.max(...tiers.map(t => t.percentBp)), tiers };
    }
    if (r.kind === 'early_bird' && r.percentBp > 0) {
      const end = earlyBirdEndsAt(r, match.kickoff);
      if (now <= end) out.earlyBird = { percentBp: cap(r.percentBp), endsAt: new Date(end).toISOString() };
    }
    if (r.kind === 'family' && r.percentBp > 0) {
      out.family = { percentBp: cap(r.percentBp), ...{ minAdults: 1, maxAdults: 2, minChildren: 1, maxChildren: 4, childMaxAge: 16, ...(r.config || {}) }, text: familyText(r) };
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Checks rule edits from the admin. Returns null or the problem. */
export function ruleProblem(rule) {
  const okBp = v => Number.isInteger(v) && v >= 0 && v <= 10000;
  if (!KINDS.includes(rule.kind)) return 'Unknown discount type.';
  if (!String(rule.name || '').trim()) return 'Give the discount a name.';
  if (rule.kind !== 'group' && !okBp(rule.percentBp)) return 'The percent is between 0 and 100.';
  if (rule.validFrom && Number.isNaN(Date.parse(rule.validFrom))) return 'Enter a real start date.';
  if (rule.validUntil && Number.isNaN(Date.parse(rule.validUntil))) return 'Enter a real end date.';
  if (rule.validFrom && rule.validUntil && Date.parse(rule.validFrom) >= Date.parse(rule.validUntil)) return 'The start date must be before the end date.';
  if (rule.maxPerMatch != null && (!Number.isInteger(rule.maxPerMatch) || rule.maxPerMatch < 0 || rule.maxPerMatch > 100000)) return 'The limit of discounted tickets per match is a whole number (empty = no limit).';
  if (rule.kind === 'group') {
    const t = rule.tiers || [];
    if (!t.length) return 'Add at least one group tier.';
    for (let i = 0; i < t.length; i++) {
      if (!Number.isInteger(t[i].minTickets) || t[i].minTickets < 2 || t[i].minTickets > 500) return 'Each group tier starts at 2 to 500 tickets.';
      if (!okBp(t[i].percentBp)) return 'Each group tier percent is between 0 and 100.';
      if (i && t[i].minTickets <= t[i - 1].minTickets) return 'Group tiers must go up: each tier needs more tickets than the one before.';
      if (i && t[i].percentBp < t[i - 1].percentBp) return 'A bigger group should not get a smaller discount.';
    }
  }
  if (rule.kind === 'early_bird') {
    const d = rule.config?.daysBefore;
    if (!Number.isInteger(d) || d < 1 || d > 365) return 'Early bird: days before kick-off is 1 to 365.';
  }
  if (rule.kind === 'family') {
    const c = rule.config || {};
    const ints = ['minAdults', 'maxAdults', 'minChildren', 'maxChildren', 'childMaxAge'].every(k => Number.isInteger(c[k]));
    if (!ints) return 'Family bundle: fill in every number.';
    if (c.minAdults < 1 || c.maxAdults < c.minAdults || c.maxAdults > 6) return 'Family bundle: at least 1 adult, and the most adults is not below the least (6 at most).';
    if (c.minChildren < 1 || c.maxChildren < c.minChildren || c.maxChildren > 10) return 'Family bundle: at least 1 child, and the most children is not below the least (10 at most).';
    if (c.childMaxAge < 2 || c.childMaxAge > 18) return 'Family bundle: the child age limit is 2 to 18.';
  }
  return null;
}
