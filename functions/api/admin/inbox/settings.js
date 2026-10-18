import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { normEmail } from '../../_lib/contacts.js';
import { inboxSettings, saveInboxSetting } from '../../_lib/inbox.js';
import { inboxSources, can } from '../../_lib/adminRoles.js';

// POST /api/admin/inbox/settings { alertsEmail, dailySummary, extraEmails }
//   alertsEmail   email the relevant staff about each new message
//                 (contact form → Fan Support / CRM; sponsorship / hospitality → Commercial; media@ → Media)
//   dailySummary  one email a day listing messages still waiting for a reply
//   extraEmails   other addresses that also get both (comma separated)
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  // Only people who see every kind of message (CRM Manager, Super Admin) change the alerts for everyone.
  if (inboxSources(admin) !== null && !can(admin, 'staff.manage')) return Response.json({ error: 'Only the CRM Manager and Super Admins change the Inbox alerts.' }, { status: 403 });
  const db = env.DB;
  const b = await request.json().catch(() => ({}));
  const extra = String(b.extraEmails || '').split(/[\s,;]+/).filter(Boolean);
  const bad = extra.filter(e => !normEmail(e));
  if (bad.length) return Response.json({ error: `Not a valid email: ${bad.join(', ')}` }, { status: 400 });
  await inboxSettings(db);
  await saveInboxSetting(db, 'alerts_email', b.alertsEmail ? '1' : '0', admin.name);
  await saveInboxSetting(db, 'daily_summary', b.dailySummary ? '1' : '0', admin.name);
  await saveInboxSetting(db, 'extra_emails', extra.map(normEmail).slice(0, 10).join(','), admin.name);
  await logAdminAction(db, admin, 'inbox_settings', `alerts ${b.alertsEmail ? 'on' : 'off'}, daily summary ${b.dailySummary ? 'on' : 'off'}${extra.length ? `, +${extra.length} address(es)` : ''}`);
  const s = await inboxSettings(db);
  return Response.json({ ok: true, settings: { alertsEmail: s.alertsEmail, dailySummary: s.dailySummary, extraEmails: s.extraEmails.join(', ') } });
}
