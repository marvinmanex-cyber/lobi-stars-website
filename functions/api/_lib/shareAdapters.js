// Auto-posting for the Share Hub. postToPlatform(env, key, { caption, programme, url, cardKey })
// returns { ok, externalId, externalUrl } or throws an Error with a clean,
// human-readable message. Secrets come from env only and are never logged or
// returned. SOCIAL_POST_FAKE=1 is for local tests only (never in production).
import { escapeHtml, withoutLink, configured } from './share.js';
import { bucket } from './programme.js';

const clean = (msg, token) => new Error(String(msg || 'Unknown error').split(token || '\u0000').join('***').slice(0, 300));

export async function postToPlatform(env, key, { caption, programme, url, cardKey }) {
  if (!configured(env, key)) throw new Error('Auto-posting is not set up for this platform.');
  if (String(env.SOCIAL_POST_FAKE) === '1') {
    const id = String(Date.now());
    return { ok: true, externalId: id, externalUrl: key === 'telegram' ? `https://t.me/test_channel/${id}` : `https://www.facebook.com/${id}` };
  }
  if (key === 'telegram') return telegram(env, { caption, programme, url, cardKey });
  if (key === 'facebook') return facebook(env, { caption, url });
  throw new Error('This platform cannot post automatically.');
}

/**
 * A link-only post of any page of the site (Admin › Share any page). The
 * platform builds the card from the page's own og: tags.
 *  - Telegram: a message with a large link preview and an "Open" button.
 *  - Facebook: a Page feed post with the link (re-scraped first).
 */
export async function postLink(env, key, { caption, url }) {
  if (!configured(env, key)) throw new Error('Auto-posting is not set up for this platform.');
  if (String(env.SOCIAL_POST_FAKE) === '1') {
    const id = String(Date.now());
    return { ok: true, externalId: id, externalUrl: key === 'telegram' ? `https://t.me/test_channel/${id}` : `https://www.facebook.com/${id}` };
  }
  if (key === 'facebook') return facebook(env, { caption, url });
  if (key !== 'telegram') throw new Error('This platform cannot post automatically.');
  const token = env.TELEGRAM_PUBLIC_BOT_TOKEN, chat = String(env.TELEGRAM_PUBLIC_CHANNEL);
  let r;
  try {
    r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      chat_id: chat, text: escapeHtml([...caption].slice(0, 4096).join('')), parse_mode: 'HTML',
      link_preview_options: { url, prefer_large_media: true },
      reply_markup: { inline_keyboard: [[{ text: 'Open', url }]] },
    }) });
  } catch (e) { throw clean(`Could not reach Telegram: ${e.message}`, token); }
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw clean(`Telegram: ${d.description || `error ${r.status}`}`, token);
  const name = chat.startsWith('@') ? chat.slice(1) : null;
  return { ok: true, externalId: String(d.result.message_id), externalUrl: name ? `https://t.me/${name}/${d.result.message_id}` : null };
}

async function cardBlob(env, cardKey, programme) {
  const b = bucket(env);
  const obj = b ? (cardKey && await b.get(cardKey)) || (programme.cover_key && await b.get(programme.cover_key)) : null;
  return obj ? new Blob([await obj.arrayBuffer()], { type: 'image/jpeg' }) : null;
}

/** Telegram: the link card as a photo in the public channel, with a "Get the programme" button. */
async function telegram(env, { caption, programme, url, cardKey }) {
  const token = env.TELEGRAM_PUBLIC_BOT_TOKEN, chat = String(env.TELEGRAM_PUBLIC_CHANNEL);
  const api = async (method, body, isForm = false) => {
    let r;
    try {
      r = await fetch(`https://api.telegram.org/bot${token}/${method}`, isForm ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { throw clean(`Could not reach Telegram: ${e.message}`, token); }
    const d = await r.json().catch(() => ({}));
    if (!d.ok) throw clean(`Telegram: ${d.description || `error ${r.status}`}`, token);
    return d.result;
  };
  const keyboard = JSON.stringify({ inline_keyboard: [[{ text: '📖 Get the programme', url }]] });
  const html = escapeHtml(caption);
  const long = [...caption].length > 1024;
  const photoCaption = long ? `<b>${escapeHtml(programme.title)}</b>\nMatch Day Programme` : html;
  const img = await cardBlob(env, cardKey, programme);
  let msg;
  if (img) {
    const f = new FormData();
    f.append('chat_id', chat); f.append('photo', img, 'programme.jpg');
    f.append('caption', photoCaption); f.append('parse_mode', 'HTML'); f.append('reply_markup', keyboard);
    msg = await api('sendPhoto', f, true);
  } else {
    msg = await api('sendMessage', { chat_id: chat, text: long ? photoCaption : html, parse_mode: 'HTML', reply_markup: JSON.parse(keyboard) });
  }
  if (long) await api('sendMessage', { chat_id: chat, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  const name = chat.startsWith('@') ? chat.slice(1) : null;
  return { ok: true, externalId: String(msg.message_id), externalUrl: name ? `https://t.me/${name}/${msg.message_id}` : null };
}

/** Facebook Page: refresh the link card, then a link post on the Page feed. */
async function facebook(env, { caption, url }) {
  const token = env.FACEBOOK_PAGE_TOKEN, ver = env.FACEBOOK_GRAPH_VERSION || 'v26.0', page = env.FACEBOOK_PAGE_ID;
  const base = `https://graph.facebook.com/${ver}`;
  // Best effort: make Facebook read the latest og: tags for this link.
  try { await fetch(`${base}/?${new URLSearchParams({ id: url, scrape: 'true', access_token: token })}`, { method: 'POST' }); } catch {}
  let r;
  try {
    r = await fetch(`${base}/${encodeURIComponent(page)}/feed`, { method: 'POST', body: new URLSearchParams({ message: withoutLink(caption, url), link: url, access_token: token }) });
  } catch (e) { throw clean(`Could not reach Facebook: ${e.message}`, token); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id) {
    const e = d.error || {};
    const hint = e.code === 190 ? ' The Page token has expired or was revoked; make a new one (DEPLOYMENT.md, Share Hub).' : e.code === 200 || e.code === 10 ? ' The token is missing the pages_manage_posts permission.' : '';
    throw clean(`Facebook: ${e.message || `error ${r.status}`}.${hint}`, token);
  }
  return { ok: true, externalId: d.id, externalUrl: `https://www.facebook.com/${d.id}` };
}
