// Sharing any page of the site: the public Share button's anonymous click
// counts (page_share_events: page and platform only, never who), the club's
// own posts of a page (page_share_posts), link-card checks and captions.
// Tables are made on first use, like the rest of the site (the same SQL is in
// migrations/0001_page_sharing.sql for anyone who prefers wrangler migrations).
import { SITE, captionLength, withoutLink } from './share.js';

export const SHARE_PLATFORMS = ['native', 'whatsapp', 'facebook', 'twitter', 'telegram', 'email', 'copy'];
export const CLUB_PLATFORMS = ['telegram', 'facebook', 'twitter', 'whatsapp', 'instagram', 'tiktok', 'youtube'];
export const DEFAULT_HASHTAGS = '#LobiStarsFC #LobiStars';

let ready = false;
export async function ensurePageShareSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS page_share_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_page_share_events_path ON page_share_events (path, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_page_share_events_platform ON page_share_events (platform, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS page_share_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT,
      platform_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      external_id TEXT, external_url TEXT, error TEXT, staff_email TEXT,
      created_at TEXT DEFAULT (datetime('now')))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_page_share_posts_url ON page_share_posts (path, platform_key, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('page_share_hashtags', ?)`).bind(DEFAULT_HASHTAGS),
  ]);
  ready = true;
}

export async function shareHashtags(db) {
  await ensurePageShareSchema(db);
  const r = await db.prepare(`SELECT value FROM settings WHERE key = 'page_share_hashtags'`).first();
  return (r?.value || DEFAULT_HASHTAGS).trim();
}

/** A public page path a visitor shared: "/news/story/", no query, no admin or API. */
export function validSharePath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.length > 200) return null;
  if (!/^\/[A-Za-z0-9\-._~/%]*$/.test(p) || p.includes('//') || p.includes('..')) return null;
  if (/^\/(admin|api)(\/|$)/i.test(p)) return null;
  return p;
}

/** The site's own host names: the address this request came in on, and the live domain. */
export function siteHosts(request) {
  const own = new URL(request.url).hostname;
  return new Set([own, new URL(SITE).hostname, `www.${new URL(SITE).hostname}`]);
}
const LOCAL = h => h === 'localhost' || h === '127.0.0.1';

/**
 * A page address staff may check or post: https on our own host name only
 * (plain http is allowed only for local testing). Returns a URL or null.
 * Tracking parameters and the #fragment are dropped.
 */
export function ownPageUrl(raw, request) {
  let u;
  try { u = new URL(String(raw || '').trim(), request.url); } catch { return null; }
  if (!siteHosts(request).has(u.hostname)) return null;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL(u.hostname))) return null;
  if (u.username || u.password || (u.port && !LOCAL(u.hostname))) return null;
  if (/^\/(admin|api)(\/|$)/i.test(u.pathname)) return null;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|src$)/i.test(k)) u.searchParams.delete(k);
  return u;
}

export const withUtm = (url, source, campaign) => {
  const u = new URL(url);
  u.searchParams.set('utm_source', source); u.searchParams.set('utm_medium', 'social'); u.searchParams.set('utm_campaign', campaign);
  return u.toString();
};

const ellipsis = (s, n) => ([...s].length <= n ? s : [...s].slice(0, Math.max(0, n - 1)).join('').trimEnd() + '…');

/**
 * Caption for posting a page on one of the club's accounts.
 *  - Telegram, Facebook, WhatsApp, YouTube: title, description, link, hashtags.
 *  - X: title, link and hashtags in 280 characters (a link counts as 23).
 *  - Instagram, TikTok: no clickable links there, so "Link in bio".
 */
export function buildPageCaption(key, { title = '', description = '', url = '', hashtags = DEFAULT_HASHTAGS }) {
  const t = String(title).trim(), d = String(description).trim(), h = String(hashtags).trim();
  const join = parts => parts.filter(Boolean).join('\n\n');
  if (key === 'twitter') {
    const tail = [url, h].filter(Boolean).join(' ');
    const room = 280 - captionLength('twitter', ` ${tail}`).length;
    return `${ellipsis(t, room)} ${tail}`.trim();
  }
  if (key === 'instagram' || key === 'tiktok') return join([t, d, 'Link in bio', h]);
  return join([t, d, url, h]);
}

export { captionLength, withoutLink };

/** Pull title, description, canonical, robots, og:* and twitter:* from a page's HTML. */
export function parseHead(html, pageUrl) {
  const head = String(html).split(/<\/head>/i)[0].slice(0, 400_000);
  const decode = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')); return m ? decode(m[2] ?? m[3]) : null; };
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'property') || attr(m[0], 'name') || '').toLowerCase();
    const content = attr(m[0], 'content');
    if (key && content != null && !(key in meta)) meta[key] = content;
  }
  let canonical = null;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) if (/rel\s*=\s*["']?canonical/i.test(m[0])) { canonical = attr(m[0], 'href'); break; }
  const title = decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim() || null;
  const abs = v => { try { return v ? new URL(v, pageUrl).toString() : null; } catch { return null; } };
  return {
    title, description: meta.description || null, canonical: abs(canonical), robots: meta.robots || null,
    ogTitle: meta['og:title'] || null, ogDescription: meta['og:description'] || null, ogUrl: abs(meta['og:url']),
    image: abs(meta['og:image'] || meta['twitter:image']), imageRaw: meta['og:image'] || null, imageAlt: meta['og:image:alt'] || null,
    imageWidth: meta['og:image:width'] || null, imageHeight: meta['og:image:height'] || null,
    siteName: meta['og:site_name'] || null, twitterCard: meta['twitter:card'] || null,
  };
}

/** The link-card checklist: [{ level: 'ok'|'warn'|'bad', text }]. */
export function cardWarnings({ status, signIn, head, imageBytes, imageType }) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  if (status !== 200) add('bad', `The page answered ${status}, not 200.`);
  if (signIn) add('bad', 'The page sends visitors to a sign-in page, so the link card will be the sign-in page.');
  if (head.robots && /noindex/i.test(head.robots)) add('warn', 'The page is marked noindex (hidden from search engines). Is it meant to be shared?');
  const t = head.ogTitle || head.title;
  if (!t) add('bad', 'No title.'); else if ([...t].length > 70) add('warn', `The title is ${[...t].length} characters; over 70 may be cut off.`); else add('ok', 'Title');
  const d = head.ogDescription || head.description;
  if (!d) add('bad', 'No description.');
  else if ([...d].length < 70) add('warn', `The description is short (${[...d].length} characters; aim for 70 to 160).`);
  else if ([...d].length > 160) add('warn', `The description is long (${[...d].length} characters; aim for 70 to 160).`);
  else add('ok', 'Description');
  if (!head.image) add('bad', 'No link-card image (og:image).');
  else {
    if (!/^https:\/\//.test(head.imageRaw || '')) add('warn', 'The image address is not a full https:// address.');
    if (imageBytes == null) add('warn', 'Could not check the image.');
    else if (imageBytes > 300 * 1024) add('warn', `The image is ${Math.round(imageBytes / 1024)} KB; WhatsApp ignores images over about 300 KB.`);
    if (imageType && !/^image\/(jpeg|png)/i.test(imageType)) add('warn', `The image is ${imageType}; JPEG or PNG works everywhere.`);
    if (imageBytes != null && imageBytes <= 300 * 1024 && (!imageType || /^image\/(jpeg|png)/i.test(imageType))) add('ok', 'Image');
  }
  if (head.ogUrl && head.canonical && head.ogUrl !== head.canonical) add('warn', 'og:url is different from the canonical address.');
  if (head.image && !head.imageAlt) add('warn', 'The image has no description (og:image:alt).');
  return out;
}
