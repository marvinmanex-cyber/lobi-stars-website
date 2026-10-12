// Share Hub: staff share a Match Day Programme to the club's social platforms.
// Every shared link is a tracked share page lobistarsfc.com/m/<slug>?src=<platform>&v=<n>
// that shows a proper link card (og: tags) and sends people on to the scan
// page, where they sign in to read or download. Each platform is also a QR
// campaign (same code), so visits, sign-ins and downloads are counted per
// platform in qr_events. Stats are totals only.
import { validSrc, ensureQrSchema } from './qr.js';
import { ensureProgrammeSchema } from './programme.js';

export const SITE = 'https://lobistarsfc.com';
const HASHTAGS = '#LobiStarsFC #LobiStars #MatchDay #NPFL';
const LIVE = `📖 The Match Day Programme for {title} is OUT!

🗓 {kickoff_date} · ⏰ {kickoff_time} · 📍 {venue}

Free for fans. Sign in with your email to read online or download the PDF 👇
{link}

{hashtags}`;
const LIVE_BIO = LIVE.replace(/Free for fans\.[^\n]*\n\{link\}/, 'Free for fans. Sign in with your email to read online or download the PDF.\n🔗 Link in bio to read or download');
const UPCOMING = `📖 The Match Day Programme for {title} drops {drop_date} at {drop_time}!

🗓 {kickoff_date} · ⏰ {kickoff_time} · 📍 {venue}

Register now so it's waiting for you 👇
{link}

{hashtags}`;
const UPCOMING_BIO = UPCOMING.replace(/Register now so it's waiting for you 👇\n\{link\}/, "Register now so it's waiting for you.\n🔗 Link in bio");
const X_LIVE = '📖 {title} Match Day Programme is OUT! Free for fans, sign in to read or download 👇 {link} {hashtags}';
const X_UPCOMING = "📖 {title} Match Day Programme drops {drop_date}, {drop_time}! Register now so it's waiting for you 👇 {link} {hashtags}";

// key, name, mode, live template, upcoming template
export const PLATFORM_SEED = [
  ['telegram', 'Telegram', 'auto', LIVE, UPCOMING],
  ['facebook', 'Facebook', 'intent', LIVE, UPCOMING],
  ['twitter', 'X', 'intent', X_LIVE, X_UPCOMING],
  ['whatsapp', 'WhatsApp', 'intent', LIVE, UPCOMING],
  ['instagram', 'Instagram', 'manual', LIVE_BIO, UPCOMING_BIO],
  ['tiktok', 'TikTok', 'manual', LIVE_BIO, UPCOMING_BIO],
  ['youtube', 'YouTube', 'manual', LIVE, UPCOMING],
];

let ready = false;
export async function ensureShareSchema(db) {
  if (ready) return;
  await ensureProgrammeSchema(db);
  await ensureQrSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS social_platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      profile_url TEXT,
      campaign_code TEXT NOT NULL,
      share_mode TEXT NOT NULL,
      caption_live TEXT NOT NULL,
      caption_upcoming TEXT NOT NULL,
      hashtags TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS programme_captions (
      programme_id INTEGER NOT NULL,
      platform_key TEXT NOT NULL,
      caption TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (programme_id, platform_key)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS social_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      programme_id INTEGER NOT NULL,
      platform_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      error TEXT,
      staff_email TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_social_posts ON social_posts (programme_id, platform_key, created_at)`),
    ...PLATFORM_SEED.map(([key, name, mode, live, upcoming], i) => db.prepare(`INSERT OR IGNORE INTO social_platforms
        (key, name, campaign_code, share_mode, caption_live, caption_upcoming, hashtags, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(key, name, key, mode, live, upcoming, HASHTAGS, i)),
    ...PLATFORM_SEED.map(([key, name]) => db.prepare(`INSERT OR IGNORE INTO qr_campaigns (code, label, channel, created_by) VALUES (?, ?, 'social', 'setup')`).bind(key, `${name} posts`)),
    db.prepare(`INSERT OR IGNORE INTO qr_campaigns (code, label, channel, created_by) VALUES ('fanshare', 'Fan share button', 'social', 'setup')`),
  ]);
  ready = true;
}

export const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const escapeAttr = escapeHtml;
export const validSlug = s => (typeof s === 'string' && /^[a-z0-9-]{1,120}$/.test(s) ? s : null);

/** The tracked link for a platform: /m/<slug>?src=<code>&v=<n> */
export function shareUrl(slug, src, version) {
  const u = new URL(`/m/${slug}`, SITE);
  const s = validSrc(src);
  if (s) u.searchParams.set('src', s);
  u.searchParams.set('v', String(Number(version) || 0));
  return u.href;
}
/** The evergreen link for a profile bio (always the current programme). */
export const bioUrl = code => `${SITE}/p/${code}`;
/** ?v= for a programme's shared links (changes when its link card changes). */
export const shareVersion = p => p.share_assets_version || p.version || 0;

export const formatDateLagos = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long' }) : '');
export const formatTimeLagos = iso => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true }) : '');

/** live | upcoming | unavailable */
export function programmeState(p, now = new Date()) {
  if (!p || !p.pdf_key) return 'unavailable';
  if (p.status === 'published') return 'live';
  if (p.status === 'scheduled' && p.publish_at) return new Date(p.publish_at) <= now ? 'live' : 'upcoming';
  return 'unavailable';
}

/** Fills {title} {kickoff_date} {kickoff_time} {venue} {link} {hashtags} {drop_date} {drop_time}. */
export function renderCaption(template, p, platform, state) {
  const vals = {
    title: p.title || '', kickoff_date: formatDateLagos(p.kickoff_at), kickoff_time: formatTimeLagos(p.kickoff_at),
    venue: p.venue || 'McCarthy Stadium', link: shareUrl(p.slug, platform.campaign_code, shareVersion(p)), hashtags: platform.hashtags || '',
    drop_date: formatDateLagos(p.publish_at), drop_time: formatTimeLagos(p.publish_at),
  };
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const templateFor = (platform, state) => (state === 'upcoming' ? platform.caption_upcoming : platform.caption_live);

export const CAPTION_LIMITS = { twitter: 280, telegram: 1024, instagram: 2200 };
const URL_RE = /https?:\/\/[^\s]+/g;
/** { length, limit, over }; on X every link counts as 23 characters. */
export function captionLength(key, text) {
  const t = String(text || '');
  const length = key === 'twitter' ? [...t.replace(URL_RE, 'x'.repeat(23))].length : [...t].length;
  const limit = CAPTION_LIMITS[key] || 2200;
  return { length, limit, over: length > limit };
}
export const withoutLink = (text, url) => String(text || '').split(url).join('').replace(URL_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** The platform's own "share" window, or null where there is none. */
export function intentUrl(key, caption, url) {
  const e = encodeURIComponent;
  if (key === 'facebook') return `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`;
  if (key === 'twitter') return `https://x.com/intent/post?text=${e(withoutLink(caption, url))}&url=${e(url)}`;
  if (key === 'whatsapp') return `https://wa.me/?text=${e(caption.includes(url) ? caption : `${caption}\n${url}`)}`;
  if (key === 'telegram') return `https://t.me/share/url?url=${e(url)}&text=${e(withoutLink(caption, url))}`;
  return null;
}

/** Auto-posting is only possible when all of the platform's secrets are set. */
export function configured(env, key) {
  if (key === 'telegram') return !!(env.TELEGRAM_PUBLIC_BOT_TOKEN && env.TELEGRAM_PUBLIC_CHANNEL);
  if (key === 'facebook') return !!(env.FACEBOOK_PAGE_ID && env.FACEBOOK_PAGE_TOKEN);
  return false;
}
export const AUTO_CAPABLE = ['telegram', 'facebook'];
/** auto (only when configured), otherwise intent where a share window exists, else manual. */
export function effectiveMode(env, platform) {
  if (AUTO_CAPABLE.includes(platform.key) && configured(env, platform.key)) return 'auto';
  if (platform.share_mode === 'manual') return 'manual';
  return intentUrl(platform.key, '', SITE) ? 'intent' : 'manual';
}

export async function platforms(db, enabledOnly = true) {
  await ensureShareSchema(db);
  const { results } = await db.prepare(`SELECT * FROM social_platforms ${enabledOnly ? 'WHERE is_enabled = 1' : ''} ORDER BY sort_order, id`).all();
  return results;
}

/** The caption to post: the saved override, or the platform's template for the programme's state. */
export async function captionFor(db, p, platform, state) {
  const o = await db.prepare(`SELECT caption FROM programme_captions WHERE programme_id = ? AND platform_key = ?`).bind(p.id, platform.key).first();
  return o?.caption || renderCaption(templateFor(platform, state), p, platform, state);
}

export const cleanCaption = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').slice(0, 2200);
export const httpsUrl = u => { try { const x = new URL(String(u || '').trim()); return x.protocol === 'https:' ? x.href.slice(0, 300) : null; } catch { return null; } };
