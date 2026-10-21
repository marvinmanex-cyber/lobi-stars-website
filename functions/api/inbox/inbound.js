import { addInbound } from '../_lib/inbox.js';
import { ingestMessage } from '../_lib/scores/extract.js';

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
  // INBOX_INBOUND_KEY: Resend (replies). MEDIA_INBOUND_KEY: the media-mail Worker (emails to media@), its own key.
  const mediaKey = !!env.MEDIA_INBOUND_KEY && key === env.MEDIA_INBOUND_KEY;
  if (!env.INBOX_INBOUND_KEY && !env.MEDIA_INBOUND_KEY) return Response.json({ error: 'Inbound email is not set up (INBOX_INBOUND_KEY).' }, { status: 503 });
  if (!mediaKey && (!env.INBOX_INBOUND_KEY || key !== env.INBOX_INBOUND_KEY)) return Response.json({ error: 'Forbidden' }, { status: 403 });

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
  // Emails to the scores address (scores@lobistarsfc.com, or SCORES_EMAIL) are score reports, not Inbox conversations.
  const scoresAddr = String(env.SCORES_EMAIL || 'scores@lobistarsfc.com').toLowerCase();
  if (new URL(request.url).searchParams.get('box') === 'scores' || String(m.to || '').toLowerCase().includes(scoresAddr)) {
    const text = m.text || String(m.html || '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    const name = (String(m.from || '').match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || '';
    const r = await ingestMessage(env, { channel: 'EMAIL', from: m.from, fromName: name, subject: m.subject, text });
    return Response.json(r.error ? r : { ok: true, scores: true, messageId: r.messageId, status: r.status }, { status: r.error ? 400 : 200 });
  }
  // Emails to media@lobistarsfc.com (passed on by the media-mail Worker) are marked for the media team.
  const box = mediaKey || new URL(request.url).searchParams.get('box') === 'media' || /(^|[\s<,])media@lobistarsfc\.com/i.test(m.to || '') ? 'media' : null;
  const result = await addInbound(env, { ...m, mailbox: box });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
