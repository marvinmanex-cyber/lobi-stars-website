// media@lobistarsfc.com: each email goes to the media team's Gmail (FORWARD_TO)
// and into the website's admin Inbox ("Media email" conversation), where the
// media team can read and answer it from media@. If the website can't be
// reached, the Gmail copy still arrives.
import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    // 1. Gmail copy (Cloudflare forwards the original email untouched).
    try { await message.forward(env.FORWARD_TO); } catch (err) { console.error('forward failed', err); }

    // 2. Website Inbox.
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      const mail = await PostalMime.parse(raw);
      const from = mail.from ? (mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address) : message.from;
      const body = {
        from, to: message.to, subject: mail.subject || '(no subject)',
        text: mail.text || '', html: mail.html || '',
      };
      const site = env.SITE_URL || 'https://lobistarsfc.com';
      const r = await fetch(`${site}/api/inbox/inbound?box=media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-inbox-key': env.MEDIA_INBOUND_KEY },
        body: JSON.stringify(body),
      });
      if (!r.ok) console.error('inbox', r.status, await r.text());
    } catch (err) {
      console.error('inbox failed', err);
    }
  },
};
