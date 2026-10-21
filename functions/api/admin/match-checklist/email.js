import { guard, json } from '../../_lib/checklistApi.js';
import { loadChecklist, logActivity, parseEmails, EMAIL_RE } from '../../_lib/matchChecklist.js';
import { checklistPdf, checklistEmail, pdfFilename, siteBase } from '../../_lib/checklistOutput.js';
import { sendEmail } from '../../_lib/email.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { logoJpeg } from './pdf.js';

// POST /api/admin/match-checklist/email { id, to: "a@x.com, b@y.com", message, mode }
// Emails the checklist PDF (attached) with a short progress summary. Logged.
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await guard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const to = parseEmails(b.to);
  if (!to.length) return json({ error: 'Enter at least one email address.' }, 400);
  if (to.length > 20) return json({ error: 'At most 20 addresses at a time.' }, 400);
  const bad = to.filter(e => !EMAIL_RE.test(e));
  if (bad.length) return json({ error: `Not a valid email address: ${bad.join(', ')}` }, 400);
  if (!env.RESEND_API_KEY) return json({ error: 'Email is not set up on this server (RESEND_API_KEY).' }, 503);
  const base = siteBase(env);
  const c = await loadChecklist(env.DB, Number(b.id), Date.now(), { env, base });
  if (!c) return json({ error: 'Checklist not found' }, 404);
  const pdf = checklistPdf(c, { mode: b.mode === 'print' ? 'print' : 'report', generatedBy: admin.name, base, logo: await logoJpeg(env, request) });
  const { subject, html } = checklistEmail(c, { from: admin.name, message: String(b.message || '').slice(0, 2000), base });
  try {
    await sendEmail(env, { to, subject, html, attachments: [{ filename: pdfFilename(c), content: b64(pdf) }] });
  } catch (err) {
    console.error('[checklist] email', err);
    return json({ error: 'The email could not be sent. Please try again.' }, 502);
  }
  await logActivity(env.DB, { checklistId: c.id, admin, action: 'emailed', newValue: to.join(', ') });
  await logAdminAction(env.DB, admin, 'checklist_emailed', `Match checklist ${c.match.home} vs ${c.match.away} emailed to ${to.join(', ')}`);
  return json({ ok: true, sentTo: to });
}
