import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureFoodSchema, saveFoodSetting } from '../../_lib/foodOrders.js';
import { alertSettings } from '../../_lib/foodAlerts.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// POST /api/admin/food-alerts/settings { push, emailPaid, emailUnpaid, emails[], sms, smsNumbers[], smsChannel }
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const list = v => (Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map(x => String(x).trim()).filter(Boolean).slice(0, 20);
  const emails = list(b.emails);
  const bad = emails.find(e => !EMAIL.test(e));
  if (bad) return Response.json({ error: `"${bad}" is not a valid email address.` }, { status: 400 });
  const numbers = list(b.smsNumbers).map(n => n.replace(/[\s-]/g, ''));
  const badN = numbers.find(n => !/^\+?\d{10,15}$/.test(n));
  if (badN) return Response.json({ error: `"${badN}" is not a valid phone number (use +234…).` }, { status: 400 });
  await ensureFoodSchema(env.DB);
  const flag = v => (v ? '1' : '0');
  const values = [
    ['push', flag(b.push)], ['emailPaid', flag(b.emailPaid)], ['emailUnpaid', flag(b.emailUnpaid)], ['emails', JSON.stringify(emails)],
    ['sms', flag(b.sms)], ['smsNumbers', JSON.stringify(numbers)], ['smsChannel', b.smsChannel === 'whatsapp' ? 'whatsapp' : 'generic'],
  ];
  for (const [k, v] of values) await saveFoodSetting(env.DB, `alert.${k}`, v, admin.name);
  await logAdminAction(env.DB, admin, 'food_alert_settings', `push ${flag(b.push)}, email paid ${flag(b.emailPaid)}, unpaid ${flag(b.emailUnpaid)}, ${emails.length} emails, sms ${flag(b.sms)}`);
  return Response.json({ ok: true, settings: await alertSettings(env.DB) });
}
