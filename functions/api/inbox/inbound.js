import { addInbound } from '../_lib/inbox.js';

// POST /api/inbox/inbound?key=INBOX_INBOUND_KEY -- fans' email replies.
// The email provider calls this when an email arrives at
// reply+LS-2026-00123@<INBOX_REPLY_DOMAIN>; the reply is added to that
// conversation (status Open, unread dot). Works with:
//   Resend inbound ("email.received" webhook; the email is fetched from Resend)
//   Postmark inbound (JSON), SendGrid Inbound Parse / Mailgun routes (form posts)
//   or any forwarder that posts JSON { from, to, subject, text, html }.
// Refused unless the secret key matches, so nobody else can post messages.
export async function onRequestPost({ request, env }) {
  const key = new URL(request.url).searchParams.get('key') || request.headers.get('x-inbox-key') || '';
  if (!env.INBOX_INBOUND_KEY) return Response.json({ error: 'Inbound email is not set up (INBOX_INBOUND_KEY).' }, { status: 503 });
  if (key !== env.INBOX_INBOUND_KEY) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const type = request.headers.get('Content-Type') || '';
  let m = {};
  if (/json/i.test(type)) {
    const b = await request.json().catch(() => ({}));
    if (b.type === 'email.received' && b.data) {
      // Resend: the webhook only says an email arrived; fetch its content.
      const d = b.data;
      let full = {};
      if (d.email_id && env.RESEND_API_KEY) {
        const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(d.email_id)}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
        if (r.ok) full = await r.json();
      }
      m = { from: full.from || d.from, to: [].concat(full.to || d.to || []).join(','), subject: full.subject || d.subject, text: full.text, html: full.html };
    } else if (b.From || b.TextBody || b.HtmlBody) {
      m = { from: b.From, to: [b.OriginalRecipient, b.To].filter(Boolean).join(','), subject: b.Subject, text: b.TextBody, html: b.HtmlBody };
    } else {
      m = { from: b.from, to: [].concat(b.to || []).join(','), subject: b.subject, text: b.text, html: b.html };
    }
  } else {
    const f = await request.formData().catch(() => null);
    if (!f) return Response.json({ error: 'Unreadable email' }, { status: 400 });
    const g = k => (typeof f.get(k) === 'string' ? f.get(k) : '');
    m = { from: g('from') || g('sender'), to: [g('to'), g('recipient')].filter(Boolean).join(','), subject: g('subject'), text: g('text') || g('body-plain'), html: g('html') || g('body-html') };
  }
  // Emails to media@lobistarsfc.com (passed on by the media-mail Worker) are marked for the media team.
  const box = new URL(request.url).searchParams.get('box') === 'media' || /(^|[\s<,])media@lobistarsfc\.com/i.test(m.to || '') ? 'media' : null;
  const result = await addInbound(env, { ...m, mailbox: box });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
