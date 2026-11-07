// MatchDay Kitchen: the rules of the order workflow, in one place and with no database or
// network, so every rule can be tested on its own.
//   canMove            who may move an order from one status to another
//   reasonProblem      the reasons a rejection or a cancellation needs
//   recipientsFor      who is told about an event, after mute settings and the safety rule
//
// The statuses: PAID is the spec's NEW. WhatsApp orders wait as AWAITING_WHATSAPP and CONFIRMED
// until they are paid. PAID -> ACCEPTED -> PREPARING -> READY -> OUT_FOR_DELIVERY -> DELIVERED,
// with REJECTED, CANCELLED, FAILED_DELIVERY and REFUNDED at the side. ACCEPTED does not move to
// PREPARING by itself: the club wants the Start cooking press, so it knows a cook has the order.
import { STAFF_MOVES, REJECT_REASONS } from './foodOrders.js';

export const STAFF = { SA: 'super_admin', SUP: 'supervisor', PASS: 'pass', COOK: 'cook', RUN: 'delivery' };
const { SA, SUP, PASS, COOK, RUN } = STAFF;
const key = (from, to) => `${from}>${to}`;

// Moves each role other than supervisors and Super Admins can make.
const KITCHEN = [key('ACCEPTED', 'PREPARING'), key('PREPARING', 'READY')];
const DELIVERY = [key('READY', 'OUT_FOR_DELIVERY'), key('READY', 'DELIVERED'), key('OUT_FOR_DELIVERY', 'DELIVERED'), key('OUT_FOR_DELIVERY', 'FAILED_DELIVERY')];
const ROLE_MOVES = { [COOK]: KITCHEN, [RUN]: DELIVERY, [PASS]: [...KITCHEN, ...DELIVERY] };

// What each role sees on its screen.
export const ROLE_VIEW = {
  [COOK]: ['ACCEPTED', 'PREPARING'],
  [RUN]: ['READY', 'OUT_FOR_DELIVERY'],
};
/** Cooks and runners don't see totals, payment details or the fan's phone number. */
export const seesMoney = role => [SA, SUP, PASS].includes(role);

/**
 * May this person make this move on this order? Returns null when yes, or { error, status } when
 * no: status 403 for the wrong role, 409 for a move the order can't make from where it is.
 */
export function canMove(role, order, to, { userId = null } = {}) {
  const from = order?.order_status;
  const labelled = `An order that is ${String(from || 'unknown').toLowerCase().replace(/_/g, ' ')} can't be moved to ${String(to).toLowerCase().replace(/_/g, ' ')}.`;
  if (!(STAFF_MOVES[from] || []).includes(to)) return { error: labelled, status: 409 };
  // The kitchen area goes through READY. The direct step stays only for the website admin's own screens.
  if (from === 'PREPARING' && to === 'OUT_FOR_DELIVERY') return { error: labelled, status: 409 };
  // Only a pickup order goes from Ready straight to Delivered: a seat order goes through a runner.
  if (from === 'READY' && to === 'DELIVERED' && order.fulfilment !== 'pickup') return { error: labelled, status: 409 };
  if (to === 'REFUNDED') return role === SA ? null : { error: 'Only a Super Admin can mark a refund.', status: 403 };
  if (role === SA || role === SUP) return null;
  // Once a runner has taken an order, only they (or a supervisor) finish it.
  if (from === 'OUT_FOR_DELIVERY' && order.claimed_by && userId && order.claimed_by !== userId) return { error: `${order.claimed_name || 'Another delivery person'} has this order.`, status: 403 };
  if ((ROLE_MOVES[role] || []).includes(key(from, to))) return null;
  return { error: "Your role can't do this. Ask a kitchen supervisor or a super admin.", status: 403 };
}

/** The reason a move needs: null when it is fine. */
export function reasonProblem(to, { reason, note } = {}) {
  if (to === 'REJECTED') {
    if (!REJECT_REASONS[reason]) return 'Choose why this order is being rejected.';
    if (reason === 'other' && !String(note || '').trim()) return 'Write a short note saying why.';
  }
  if (to === 'CANCELLED' && !String(reason || '').trim() && !String(note || '').trim()) return 'Write why this order is being cancelled.';
  return null;
}

// ── Delivery zones: a venue's sections grouped, so runners get only their own part of the ground ──
/** The zone a stand or section belongs to: its id, or null when zones don't cover it. */
export function zoneOf(stand, zones = []) {
  const s = String(stand || '').trim().toLowerCase();
  if (!s) return null;
  return (zones || []).find(z => (z.sections || []).some(x => String(x).trim().toLowerCase() === s))?.id || null;
}
/** Does this runner handle this order? No zone on either side means yes, so nothing can go unseen. */
export const runnerCovers = (runnerZone, orderZone) => !runnerZone || !orderZone || runnerZone === orderZone;
/** "Zone name: Stand A, Stand B", one per line. */
export function parseZones(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const name = line.slice(0, i).replace(/\s+/g, ' ').trim().slice(0, 40);
    const sections = line.slice(i + 1).split(',').map(x => x.replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 30);
    if (name && sections.length) out.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `zone-${out.length + 1}`, name, sections });
  }
  return out.slice(0, 20);
}

// ── Who is told about what ──
// loud: sound and vibration that keep going. The rest get one quiet notification.
// 'screen' is a device set up on the website admin's Kitchen Screen.
export const EVENTS = {
  ORDER_NEW: { roles: [SA, SUP, 'screen'], loud: [SA, SUP, 'screen'] },
  ORDER_ACCEPTED: { roles: [SA, SUP, COOK, PASS], loud: [COOK, PASS] },
  ORDER_REJECTED: { roles: [SA, SUP], loud: [] },
  ORDER_READY: { roles: [SA, SUP, RUN, PASS], loud: [RUN, PASS] },
  ORDER_OUT_FOR_DELIVERY: { roles: [SA, SUP], loud: [] },
  ORDER_DELIVERED: { roles: [SA, SUP], loud: [] },
  ORDER_CANCELLED: { roles: [SA, SUP, 'screen'], loud: [] },
  ORDER_FAILED_DELIVERY: { roles: [SA, SUP], loud: [SUP] },
  MISSING_INGREDIENT: { roles: [SA, SUP], loud: [SUP] },
  // Escalations.
  ESCALATION_NEW: { roles: [SA, SUP], loud: [SA, SUP] },
  ESCALATION_PREPARING: { roles: [SUP], loud: [SUP] },
  ESCALATION_READY: { roles: [RUN, PASS, SUP], loud: [RUN, PASS, SUP] },
  ESCALATION_OUT: { roles: [SUP], loud: [SUP] },
};
// A Super Admin on "urgent only" still gets these.
export const URGENT = ['ORDER_NEW', 'ORDER_CANCELLED', 'ORDER_FAILED_DELIVERY', 'MISSING_INGREDIENT', 'ESCALATION_NEW'];
export const ALERT_LEVELS = ['all', 'urgent', 'off'];

/** What this attempt at alerting the kitchen means as an event. */
export const eventOf = attempt => ({ initial: 'ORDER_NEW', repeat: 'ORDER_NEW', whatsapp: 'ORDER_NEW', cook: 'ORDER_ACCEPTED', ready: 'ORDER_READY', out: 'ORDER_OUT_FOR_DELIVERY', delivered: 'ORDER_DELIVERED', rejected: 'ORDER_REJECTED', cancel: 'ORDER_CANCELLED', failed: 'ORDER_FAILED_DELIVERY', flag: 'MISSING_INGREDIENT', release: 'ORDER_ACCEPTED', esc_new: 'ESCALATION_NEW', esc_preparing: 'ESCALATION_PREPARING', esc_ready: 'ESCALATION_READY', esc_out: 'ESCALATION_OUT' }[attempt] || null);

export const hearsEvent = (role, level, event) => {
  if (role !== SA) return true;
  if (level === 'off') return false;
  return level === 'urgent' ? URGENT.includes(event) : true;
};

/**
 * Which devices to alert. devices: [{ endpoint, role, staffId }]. levels: { staffId: level } for
 * Super Admins. Safety rule: if nobody who can act would hear a new order or an emergency, the
 * designated fallback Super Admin hears it anyway, or else every Super Admin.
 */
export function recipientsFor(event, devices, { levels = {}, fallbackId = null, cookWasPreparing = false, duty = null, venueId = null, orderZone = null } = {}) {
  const rule = EVENTS[event];
  if (!rule) return [];
  const roles = [...rule.roles];
  if (cookWasPreparing && ['ORDER_CANCELLED', 'ORDER_FAILED_DELIVERY'].includes(event)) roles.push(COOK);
  // Staff at another venue never hear this order. While a match-day shift is running, only those clocked in do (duty is null otherwise).
  const here = devices.filter(d => d.role === SA || d.role === 'screen' || !venueId || !d.venueId || d.venueId === venueId);
  const onDuty = here.filter(d => d.role === SA || d.role === 'screen' || !duty || duty.includes(d.staffId));
  // A new "ready" alert goes to the runners for that zone. An overdue one goes to every runner on duty.
  const zoned = event === 'ORDER_READY' ? onDuty.filter(d => d.role !== RUN || runnerCovers(d.zoneId, orderZone)) : onDuty;
  const wanted = zoned.filter(d => roles.includes(d.role));
  const chosen = wanted.filter(d => hearsEvent(d.role, levels[d.staffId] || 'all', event));
  const someoneCanAct = chosen.some(d => d.role === SUP || d.role === SA);
  if (!someoneCanAct && URGENT.includes(event)) {
    const admins = devices.filter(d => d.role === SA);
    const forced = admins.filter(d => d.staffId === fallbackId);
    return [...chosen, ...(forced.length ? forced : admins).filter(d => !chosen.includes(d))];
  }
  return chosen;
}
export const isLoud = (event, role) => (EVENTS[event]?.loud || []).includes(role);

/** What each alarm in the app is, for each role. */
export function alarmsFor(role, level, lists) {
  const empty = { newOrders: [], whatsapp: [], cook: [], ready: [], late: [], failed: [], flags: [] };
  if (role === SA && level === 'off') return empty;
  if (role === SA || role === SUP) {
    if (role === SA && level === 'urgent') return { ...empty, newOrders: lists.newOrders, whatsapp: lists.whatsapp, late: lists.late, failed: lists.failed, flags: lists.flags };
    return { ...empty, ...lists };
  }
  if (role === COOK) return { ...empty, cook: lists.cook };
  if (role === RUN) return { ...empty, ready: lists.ready };
  return { ...empty, cook: lists.cook, ready: lists.ready, late: lists.late };
}

/**
 * Turning alerts fully off, for a Super Admin. The last person who would hear a new order can't
 * switch off unless a fallback Super Admin is set. Returns an error text, or null.
 */
export function muteProblem(level, { supervisorOnDuty = false, otherAdminsHearing = 0, fallbackId = null, selfId = null } = {}) {
  if (level !== 'off' || supervisorOnDuty || otherAdminsHearing > 0) return null;
  if (fallbackId && fallbackId !== selfId) return null;
  return 'You can\'t switch off now: no supervisor is on shift and no other Super Admin would hear new orders. Set a different fallback Super Admin, or use "urgent only".';
}
