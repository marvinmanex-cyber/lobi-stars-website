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
export function canMove(role, order, to) {
  const from = order?.order_status;
  const labelled = `An order that is ${String(from || 'unknown').toLowerCase().replace(/_/g, ' ')} can't be moved to ${String(to).toLowerCase().replace(/_/g, ' ')}.`;
  if (!(STAFF_MOVES[from] || []).includes(to)) return { error: labelled, status: 409 };
  // The kitchen area goes through READY. The direct step stays only for the website admin's own screens.
  if (from === 'PREPARING' && to === 'OUT_FOR_DELIVERY') return { error: labelled, status: 409 };
  // Only a pickup order goes from Ready straight to Delivered: a seat order goes through a runner.
  if (from === 'READY' && to === 'DELIVERED' && order.fulfilment !== 'pickup') return { error: labelled, status: 409 };
  if (to === 'REFUNDED') return role === SA ? null : { error: 'Only a Super Admin can mark a refund.', status: 403 };
  if (role === SA || role === SUP) return null;
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
};
// A Super Admin on "urgent only" still gets these.
export const URGENT = ['ORDER_NEW', 'ORDER_CANCELLED', 'ORDER_FAILED_DELIVERY', 'MISSING_INGREDIENT'];
export const ALERT_LEVELS = ['all', 'urgent', 'off'];

/** What this attempt at alerting the kitchen means as an event. */
export const eventOf = attempt => ({ initial: 'ORDER_NEW', repeat: 'ORDER_NEW', whatsapp: 'ORDER_NEW', cook: 'ORDER_ACCEPTED', ready: 'ORDER_READY', out: 'ORDER_OUT_FOR_DELIVERY', delivered: 'ORDER_DELIVERED', rejected: 'ORDER_REJECTED', cancel: 'ORDER_CANCELLED', failed: 'ORDER_FAILED_DELIVERY', flag: 'MISSING_INGREDIENT' }[attempt] || null);

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
export function recipientsFor(event, devices, { levels = {}, fallbackId = null, cookWasPreparing = false } = {}) {
  const rule = EVENTS[event];
  if (!rule) return [];
  const roles = [...rule.roles];
  if (cookWasPreparing && ['ORDER_CANCELLED', 'ORDER_FAILED_DELIVERY'].includes(event)) roles.push(COOK);
  const wanted = devices.filter(d => roles.includes(d.role));
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
