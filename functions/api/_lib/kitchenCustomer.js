// MatchDay Kitchen: updates to the customer, by email if they gave one and by WhatsApp once a
// Meta account is connected.
//
// WhatsApp goes through Meta's WhatsApp Business Platform and stays switched off until both
// WHATSAPP_CLOUD_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set. A rejection never goes on WhatsApp:
// the reason shows on the tracking page and by email only. Staff names are never included.
// Nothing here ever throws to the caller: an update failing must never stop an order moving.
import { formatNaira, paymentMessage, foodSettings, REJECT_REASONS, trackUrl, whereText } from './foodOrders.js';
import { sendEmail } from './email.js';
import { waNumber } from './foodReceipt.js';

const SITE = env => String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const whatsappConnected = env => !!(env.WHATSAPP_CLOUD_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);

/** The words for one update: { subject, text }, or null when there is nothing to say. */
export function customerMessage(env, order, event, extra = {}) {
  const first = String(order.customer_name || '').trim().split(/\s+/)[0] || 'there';
  const hi = `Hi ${first}, this is MatchDay Kitchen.`;
  const link = order.view_token ? ` Track it here: ${trackUrl(SITE(env), order)}` : '';
  const ref = order.ref || order.id;
  const items = (() => { try { return JSON.parse(order.items_json).map(i => `${i.qty} × ${i.name}`).join(', '); } catch { return ''; } })();
  switch (event) {
    case 'payment': return extra.text ? { subject: `Your order ${ref}: how to pay`, text: extra.text } : null;
    case 'received': return { subject: `We have your order ${ref}`, text: `${hi} We have received your order ${ref}: ${items}. Total ${formatNaira(order.total_kobo)}. ${whereText(order)}.${order.delivery_code && order.fulfilment !== 'pickup' ? ` Your delivery code is ${order.delivery_code}: give it to our delivery staff when your food arrives.` : ''}${link}` };
    case 'accepted': return { subject: `Order ${ref} accepted`, text: `${hi} Your order ${ref} has been accepted and is going to the kitchen.${link}` };
    case 'out': return { subject: `Order ${ref} is on its way`, text: `${hi} Your order ${ref} is on its way to you.${order.delivery_code ? ` Have your delivery code ready: ${order.delivery_code}.` : ''}${link}` };
    case 'delivered': return { subject: `Order ${ref} delivered`, text: `${hi} Your order ${ref} has been delivered. Enjoy the match.${link ? ` Tell us how it went: ${trackUrl(SITE(env), order)}` : ''}` };
    case 'rejected': {
      const why = REJECT_REASONS[order.reject_reason] || 'We could not take it';
      const refund = order.payment_status === 'paid' ? ' Your payment will be refunded.' : '';
      return { subject: `Order ${ref} could not be accepted`, text: `${hi} Sorry, we could not accept your order ${ref}. Reason: ${why}.${refund}${link}` };
    }
    default: return null;
  }
}

/** Sends one text on WhatsApp through Meta. Returns true when Meta accepted it. */
export async function sendWhatsapp(env, phone, text) {
  const to = waNumber(phone || '');
  if (!to || !whatsappConnected(env)) return false;
  const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.WHATSAPP_CLOUD_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: text } }),
  });
  if (!r.ok) throw new Error(`WhatsApp ${r.status}`);
  return true;
}

/**
 * One update to the customer. Email only for accepted, rejected and on its way: the
 * "received" and "delivered" emails already go out with the order and its receipt.
 */
export async function customerUpdate(env, order, event, log = async () => {}) {
  try {
    let extra = {};
    if (event === 'payment') extra = { text: paymentMessage(await foodSettings(env.DB), order) };
    const m = customerMessage(env, order, event, extra);
    if (!m) return;
    if (event !== 'rejected' && whatsappConnected(env) && order.phone) {
      try { await sendWhatsapp(env, order.phone, m.text); await log('whatsapp', true); }
      catch (err) { await log('whatsapp', false, err.message); }
    }
    if (['accepted', 'rejected', 'out', 'payment'].includes(event) && order.email && env.RESEND_API_KEY) {
      try { await sendEmail(env, { to: order.email, subject: `MatchDay Kitchen: ${m.subject}`, html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5"><p>${esc(m.text)}</p></div>` }); await log('email', true); }
      catch (err) { await log('email', false, err.message); }
    }
  } catch (err) { console.error('[kitchen] customer update', err); }
}
