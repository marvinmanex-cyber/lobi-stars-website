import { checkOrigin, getFan, normaliseEmail } from '../_lib/fanCode.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import { addInbound } from '../_lib/inbox.js';

// POST /api/fan/delete-request { email? } -- "Delete my data". Lands in the
// admin Inbox as a message from the fan (staff then use Fan Database › Delete,
// which removes the person everywhere). Signed-in fans don't need to type an email.
export async function onRequestPost({ request, env }) {
  const bad = checkOrigin(request);
  if (bad) return bad;
  try {
    await ensureFanSchema(env.DB);
    if (!(await rateLimit(env.DB, `delreq:${clientIp(request)}`, 5, 3600))) return tooMany();
    const b = await request.json().catch(() => ({}));
    const fan = await getFan(request, env);
    const email = fan?.email || normaliseEmail(b.email);
    if (!email) return Response.json({ error: 'Please enter your email address.' }, { status: 400 });
    await addInbound(env, {
      from: email, to: 'info@lobistarsfc.com', subject: 'Data deletion request (Match Day Programme)',
      text: `Please delete my personal data held by Lobi Stars FC.\n\nEmail: ${email}\n${fan ? 'Sent while signed in to this account.' : 'Sent from the programme page (not signed in): confirm by replying to this email before deleting.'}\n\nStaff: use Admin › Fan Database › Delete for this person.`,
    });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[fan] delete request', err);
    return Response.json({ error: 'Something went wrong. Please email info@lobistarsfc.com.' }, { status: 500 });
  }
}
