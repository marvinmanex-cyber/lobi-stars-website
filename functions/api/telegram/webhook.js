import { moveOrder } from '../_lib/foodOrders.js';
import { ensureKitchenSchema, telegramApi, escHtml, clearTelegramButtons } from '../_lib/kitchenNotify.js';

// POST /api/telegram/webhook -- Telegram calls this when someone in the kitchen
// group presses "✅ Accept" under an order. Public address, but only Telegram
// knows the secret (X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET),
// and only button presses from the kitchen group are used.
// Always answers 200 quickly so Telegram doesn't retry.
const ok = () => new Response('ok', { status: 200 });

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }
  let update;
  try { update = await request.json(); } catch { return ok(); }
  const cb = update?.callback_query;
  if (!cb || String(cb.message?.chat?.id) !== String(env.TELEGRAM_KITCHEN_CHAT_ID)) return ok();
  const data = String(cb.data || '');
  if (!data.startsWith('ack:')) return ok();

  const job = (async () => {
    const answer = text => telegramApi(env, 'answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {});
    try {
      await ensureKitchenSchema(env.DB);
      const ref = data.slice(4, 40);
      const name = String(cb.from?.first_name || cb.from?.username || 'kitchen').slice(0, 40);
      const order = await env.DB.prepare(`SELECT * FROM food_orders WHERE ref = ?`).bind(ref).first();
      if (!order) return answer('Order not found');
      if (order.order_status !== 'PAID') {
        await answer(order.kitchen_ack_by ? `Already accepted by ${order.kitchen_ack_by}` : `This order is ${String(order.order_status).toLowerCase().replace(/_/g, ' ')}`);
        return;
      }
      const err = await moveOrder(env.DB, order, 'ACCEPTED', `Telegram: ${name}`);
      if (err) { await answer('Already accepted'); return; }
      await answer('Accepted ✅');
      const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
      // Show who accepted it on the message and remove the button.
      const original = escHtml(cb.message?.text || '');
      await telegramApi(env, 'editMessageText', {
        chat_id: cb.message.chat.id, message_id: cb.message.message_id, parse_mode: 'HTML',
        text: `${original}\n\n✅ <b>Accepted by ${escHtml(name)} at ${time}</b>`, reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      await clearTelegramButtons(env, env.DB, order.id); // earlier repeat messages too
    } catch (e) {
      console.error('[telegram] webhook', e);
      await answer('Sorry, that did not work. Use the Kitchen Screen.');
    }
  })();
  if (waitUntil) waitUntil(job); else await job;
  return ok();
}
