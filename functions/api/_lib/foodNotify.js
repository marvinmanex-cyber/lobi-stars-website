// MatchDay Kitchen: fan alerts for their own order ("Tell me when it's on the way").
// The fan's browser subscribes on the order page (POST /api/food/notify); the
// subscription is kept on that order only and is used for two messages: the
// kitchen started cooking, and the food is on the way (or ready to collect).
import { sendEncryptedPush } from './webPush.js';

const SITE = 'https://lobistarsfc.com';
const no = o => String(o.ref || o.id).split('-').pop();
const track = o => `${SITE}/kitchen/?ref=${encodeURIComponent(o.ref)}&t=${encodeURIComponent(o.view_token || '')}`;

function message(o, to) {
  const pickup = o.fulfilment === 'pickup';
  if (to === 'PREPARING') return { title: `Order #${no(o)}: cooking now 🍳`, body: 'The MatchDay Kitchen is preparing your food.' };
  if (to === 'READY') return { title: `Order #${no(o)} is ready to collect`, body: `Show number #${no(o)} at ${o.pickup_point || 'the pickup point'}.` };
  if (to === 'OUT_FOR_DELIVERY') return pickup
    ? { title: `Order #${no(o)} is ready to collect`, body: `Show number #${no(o)} at ${o.pickup_point || 'the pickup point'}.` }
    : { title: `Your food is on the way 🛵`, body: `Order #${no(o)} is coming to ${[o.stand, o.seat].filter(Boolean).join(', ') || 'your seat'}.` };
  return null;
}

/** Sends the fan their alert after a status change (only if they asked for alerts on this order). */
export async function notifyFan(env, order, to) {
  if (!order?.push_sub || !env?.VAPID_PUBLIC_KEY) return;
  const m = message(order, to);
  if (!m) return;
  let sub; try { sub = JSON.parse(order.push_sub); } catch { return; }
  const status = await sendEncryptedPush(env, sub, { kind: 'food', ...m, url: track(order), tag: `food-${order.id}` }, { ttl: 900, urgency: 'high', topic: `food${no(order)}` });
  // The fan turned notifications off or the subscription expired: forget it.
  if (status === 404 || status === 410) await env.DB.prepare(`UPDATE food_orders SET push_sub = NULL WHERE id = ?`).bind(order.id).run();
}
