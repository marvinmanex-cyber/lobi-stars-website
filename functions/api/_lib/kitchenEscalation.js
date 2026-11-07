// MatchDay Kitchen: the every-minute check. Orders left too long at a step alert the right people
// (once per step), kick-off and half-time orders are released to the kitchen when due, and a new
// order nobody has opened gets a backup message to the supervisors on duty.
// Never throws: called from the cron job alongside other work.
import { ensureFoodSchema, whereText, recordOrderEvent } from './foodOrders.js';
import { getVenue, dueEscalations, dutyIds } from './kitchenOps.js';
import { notifyKitchen, ensureKitchenSchema } from './kitchenNotify.js';
import { sendWhatsapp, whatsappConnected } from './kitchenCustomer.js';

const OPEN = ['AWAITING_WHATSAPP', 'PAID', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'];

async function claim(db, orderId, kind) {
  const r = await db.prepare(`INSERT OR IGNORE INTO order_escalations (order_id, kind, at) VALUES (?, ?, ?)`).bind(orderId, kind, new Date().toISOString()).run();
  return !!r.meta?.changes;
}

async function sendBackup(env, phone, text) {
  if (whatsappConnected(env)) return sendWhatsapp(env, phone, text);
  if (!env.TERMII_API_KEY) return false;
  const r = await fetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: env.TERMII_API_KEY, to: String(phone).replace(/^\+/, ''), from: env.TERMII_SENDER_ID || 'Kitchen', sms: text.slice(0, 300), type: 'plain', channel: 'generic' }),
  });
  return r.ok;
}

export async function runEscalations(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const done = { escalated: 0, backups: 0 };
  try {
    await ensureFoodSchema(db);
    await ensureKitchenSchema(db);
    const since = new Date(now - 12 * 3600e3).toISOString();
    const q = OPEN.map(() => '?').join(',');
    const { results } = await db.prepare(`SELECT * FROM food_orders WHERE order_status IN (${q}) AND created_iso >= ? ORDER BY created_iso LIMIT 200`).bind(...OPEN, since).all();
    if (!results.length) return done;
    const venues = new Map();
    const settingsOf = async id => { if (!venues.has(id)) venues.set(id, (await getVenue(db, id))?.settings || null); return venues.get(id); };
    for (const o of results) {
      const s = await settingsOf(o.venue_id);
      if (!s) continue;
      const sent = (await db.prepare(`SELECT kind FROM order_escalations WHERE order_id = ?`).bind(o.id).all()).results.map(r => r.kind);
      for (const kind of dueEscalations(o, s, now, sent)) {
        if (!(await claim(db, o.id, kind))) continue;
        await notifyKitchen(env, o.id, kind);
        await recordOrderEvent(db, o.id, { kind: 'escalation', note: kind, byName: 'System', byRole: 'system' });
        done.escalated++;
      }
      // A new order nobody has opened: a message to the supervisors on duty, if a channel is connected.
      const waiting = ['PAID', 'AWAITING_WHATSAPP'].includes(o.order_status);
      const age = (now - Date.parse(o.paid_iso || o.created_iso)) / 1000;
      if (waiting && age >= s.backupAfterSeconds && !sent.includes('backup') && (whatsappConnected(env) || env.TERMII_API_KEY)) {
        const opened = await db.prepare(`SELECT 1 FROM food_notification_log WHERE order_id = ? AND opened_at IS NOT NULL LIMIT 1`).bind(o.id).first();
        if (opened) continue;
        if (!(await claim(db, o.id, 'backup'))) continue;
        const duty = await dutyIds(db, o.venue_id);
        const { results: sups } = await db.prepare(`SELECT id, phone FROM mk_staff WHERE role = 'supervisor' AND is_active = 1 AND phone IS NOT NULL AND phone != '' AND COALESCE(venue_id, ?) = ?`).bind(o.venue_id, o.venue_id).all();
        for (const p of sups.filter(x => !duty || duty.includes(x.id))) {
          let ok = false, error = null;
          try { ok = await sendBackup(env, p.phone, `MatchDay Kitchen: new order ${o.ref} is waiting. ${whereText(o)}. Open the app to confirm or reject it.`); } catch (err) { error = err.message; }
          await db.prepare(`INSERT INTO food_notification_log (order_id, ref, channel, attempt, success, error, created_at, event, recipient) VALUES (?, ?, 'backup', 'backup', ?, ?, ?, 'ORDER_NEW', ?)`).bind(o.id, o.ref, ok ? 1 : 0, error, new Date(now).toISOString(), p.id).run();
          if (ok) done.backups++;
        }
      }
    }
  } catch (err) { console.error('[kitchen] escalations', err); }
  return done;
}
