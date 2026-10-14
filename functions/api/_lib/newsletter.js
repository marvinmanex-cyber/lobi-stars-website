// The Lobi Stars Weekly: newsletter issues written in the admin, sponsor
// adverts (any number, each with a logo, link and text), the branded email
// template, sending to subscribers (Resend) and click counting for sponsors.
//
// Who receives it: everyone in the fan database who agreed to club news by
// email (marketing consent, not unsubscribed), unless they switched the
// weekly newsletter off in their newsletter options.
import { ensureContactsSchema } from './contacts.js';
import { randomId } from './crypto.js';
import { logoFile } from './logoFiles.js';

export const SITE = 'https://lobistarsfc.com';
const RED = '#E31E24', GOLD = '#FFC72C', INK = '#15181D';

let ready = false;
export async function ensureNewsletterSchema(db) {
  if (ready) return;
  await ensureContactsSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
       email TEXT PRIMARY KEY, source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS newsletter_sponsors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo TEXT,                     -- image address (uploaded: /api/newsletter/asset/<id>)
      link TEXT,                     -- their website
      headline TEXT,                 -- e.g. "Official Banking Partner"
      text TEXT,                     -- short advert text
      button_text TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT, updated_by TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS newsletter_issues (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE,              -- web version: /newsletter/<slug>/
      subject TEXT NOT NULL,
      preheader TEXT,
      headline TEXT, intro TEXT,
      hero_image TEXT, hero_button_text TEXT, hero_button_url TEXT,
      include_match INTEGER NOT NULL DEFAULT 1,
      stories TEXT,                  -- JSON [{ title, text, image, url }]
      sponsor_ids TEXT,              -- JSON, in display order
      top_sponsor_id TEXT,           -- "In partnership with" at the top
      status TEXT NOT NULL DEFAULT 'draft',   -- draft / sending / sent
      created_at TEXT NOT NULL, created_by TEXT,
      updated_at TEXT, updated_by TEXT,
      sent_at TEXT, sent_by TEXT, sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0,
      html_snapshot TEXT             -- the issue as sent (web version)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS newsletter_deliveries (
      issue_id TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL,
      PRIMARY KEY (issue_id, email)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS newsletter_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS newsletter_clicks_issue ON newsletter_clicks (issue_id, kind, ref)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS newsletter_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS newsletter_assets (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, bytes INTEGER, created_at TEXT NOT NULL)`),
  ]);
  // Sponsor contact details, offer and featured banner (added later).
  const spCols = new Set((await db.prepare(`PRAGMA table_info(newsletter_sponsors)`).all()).results.map(r => r.name));
  for (const [name, type] of [['address', 'TEXT'], ['phone', 'TEXT'], ['email', 'TEXT'], ['offer', 'TEXT'], ['banner_image', 'TEXT'], ['featured', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!spCols.has(name)) await db.prepare(`ALTER TABLE newsletter_sponsors ADD COLUMN ${name} ${type}`).run();
  }
  // Newsletter options on each subscriber (added to the existing table).
  const cols = new Set((await db.prepare(`PRAGMA table_info(newsletter_subscribers)`).all()).results.map(r => r.name));
  for (const [name, type] of [['full_name', 'TEXT'], ['phone_e164', 'TEXT'], ['consent_at', 'TEXT'], ['updated_at', 'TEXT'],
    ['pref_weekly', 'INTEGER NOT NULL DEFAULT 1'], ['pref_matchday', 'INTEGER NOT NULL DEFAULT 0'], ['pref_offers', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!cols.has(name)) await db.prepare(`ALTER TABLE newsletter_subscribers ADD COLUMN ${name} ${type}`).run();
  }
  ready = true;
}

// ── Helpers ──
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const absFrom = (u, base = SITE) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `${base}${u.startsWith('/') ? '' : '/'}${u}`);
const abs = u => absFrom(logoFile(u));
export const safeUrl = u => { const s = String(u || '').trim(); return /^(https?:\/\/|\/)/i.test(s) ? s.slice(0, 500) : ''; };
const paras = (text, style) => String(text || '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).filter(Boolean)
  .map(p => `<p style="${style}">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
export const parseIssue = r => r && ({ ...r, stories: JSON.parse(r.stories || '[]'), sponsor_ids: JSON.parse(r.sponsor_ids || '[]'), include_match: !!r.include_match });
export const newId = p => randomId(p, 10);
export function slugFor(subject, date = new Date()) {
  return `${date.toISOString().slice(0, 10)}-${String(subject || 'newsletter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'newsletter'}`;
}

// ── Template settings (Admin › Newsletter › Template & settings) ──
export const NL_DEFAULTS = {
  title: 'The Weekly Newsletter',
  matchLabel: 'Next match',
  storiesLabel: 'This week at the club',
  partnersLabel: 'Our partners',
  partnersText: 'Thank you to the partners who support Lobi Stars FC.',
  featuredLabel: 'From our partners',
  footerAddress: 'Lobi Stars FC, McCarthy Stadium, Makurdi, Benue State, Nigeria',
  footerNote: "You're receiving this because you signed up for Lobi Stars FC news by email.",
  facebook: 'https://www.facebook.com/LobiStars', x: 'https://x.com/LobiStars', instagram: 'https://www.instagram.com/lobistarsfc',
  youtube: '', tiktok: '', whatsapp: '',
};
export const NL_LIMITS = { title: 60, matchLabel: 40, storiesLabel: 40, partnersLabel: 40, partnersText: 200, featuredLabel: 40, footerAddress: 160, footerNote: 300 };
export const NL_LINKS = ['facebook', 'x', 'instagram', 'youtube', 'tiktok', 'whatsapp'];
export async function newsletterSettings(db) {
  await ensureNewsletterSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM newsletter_settings`).all();
  const s = { ...NL_DEFAULTS };
  for (const r of results) if (r.key in NL_DEFAULTS && r.value != null) s[r.key] = r.value;
  return s;
}
export async function saveNewsletterSettings(db, values, by) {
  const now = new Date().toISOString();
  const stmts = [];
  for (const k of Object.keys(NL_DEFAULTS)) {
    if (!(k in values)) continue;
    let v = String(values[k] ?? '').trim();
    if (NL_LINKS.includes(k)) { if (v && !/^https:\/\//i.test(v)) throw new Error(`The ${k === 'x' ? 'X' : k} link must start with https://`); v = v.slice(0, 300); }
    else { v = v.slice(0, NL_LIMITS[k]); if (!v) v = NL_DEFAULTS[k]; }
    stmts.push(db.prepare(`INSERT INTO newsletter_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(k, v, now, by || ''));
  }
  if (stmts.length) await db.batch(stmts);
  return newsletterSettings(db);
}

/** The next Lobi Stars match (for the "Next match" block). */
export async function nextMatch(db) {
  try {
    const row = await db.prepare(`SELECT * FROM events WHERE active = 1 AND event_date > ? ORDER BY event_date LIMIT 1`).bind(new Date().toISOString()).first();
    return row || null;
  } catch { return null; }
}

/**
 * Click-through link: counted for the sponsor report, then on to the real
 * address (looked up on the server, so it can't be used to send people elsewhere).
 * Previews link straight to the address.
 */
function tracked(issue, kind, ref, url, preview) {
  if (!url) return '';
  if (preview || !issue.id) return abs(url);
  return `${SITE}/api/newsletter/c?i=${encodeURIComponent(issue.id)}&k=${kind}&r=${encodeURIComponent(ref)}`;
}

/**
 * The email (and web version). `recipient` = { firstName, unsubscribeUrl,
 * optionsUrl } (empty for the web version / previews).
 */
export function renderNewsletter({ issue, sponsors = [], match = null, recipient = {}, preview = false, web = false, base = SITE, settings = NL_DEFAULTS }) {
  const T = { ...NL_DEFAULTS, ...settings };
  // Pictures: from this site's address in admin previews (so new uploads show before going live).
  const abs = u => absFrom(logoFile(u), base);
  const byId = new Map(sponsors.map(s => [s.id, s]));
  const list = (issue.sponsor_ids || []).map(id => byId.get(id)).filter(Boolean);
  const top = issue.top_sponsor_id ? byId.get(issue.top_sponsor_id) : null;
  const date = new Date(issue.sent_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });
  const webUrl = issue.slug && issue.status === 'sent' ? `${SITE}/newsletter/${issue.slug}/` : `${SITE}/newsletter/`;
  const P = 'margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2B2F36;';
  const btn = (href, text, bg = RED, color = '#ffffff') => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 0"><tr><td style="background:${bg};border-radius:8px"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${color};text-decoration:none">${esc(text)}</a></td></tr></table>`;
  const section = (inner, pad = '28px 32px', bg = '#ffffff') => `<tr><td class="px" style="padding:${pad};background:${bg}">${inner}</td></tr>`;
  const label = t => `<p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${RED}">${esc(t)}</p>`;

  const rows = [];
  // Header with the club badge.
  rows.push(`<tr><td style="background:${INK};padding:22px 32px;border-bottom:4px solid ${RED}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="68" valign="middle"><img src="${SITE}/images/lobi-stars-badge.png" width="60" height="60" alt="Lobi Stars FC" style="display:block;border:0"></td>
      <td valign="middle" style="padding-left:12px">
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;letter-spacing:1px;color:#ffffff">LOBI STARS FC</p>
        <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${GOLD}">${esc(T.title)} &middot; ${esc(date)}</p>
      </td>
    </tr></table></td></tr>`);
  // "In partnership with" headline sponsor.
  if (top) {
    const href = tracked(issue, 's', top.id, safeUrl(top.link), preview);
    const logo = top.logo ? `<img src="${esc(abs(top.logo))}" alt="${esc(top.name)}" height="34" style="display:inline-block;height:34px;max-width:160px;vertical-align:middle;border:0">` : `<b style="color:${INK}">${esc(top.name)}</b>`;
    rows.push(`<tr><td style="background:#F7F7F8;padding:10px 32px;border-bottom:1px solid #E6E8EB;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5B6472;text-align:center">
      In partnership with&nbsp;&nbsp;${href ? `<a href="${esc(href)}" style="text-decoration:none">${logo}</a>` : logo}</td></tr>`);
  }
  // Hero.
  if (issue.hero_image) rows.push(`<tr><td style="background:#ffffff"><img src="${esc(abs(issue.hero_image))}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`);
  const greet = recipient.firstName ? `<p style="${P}">Hi ${esc(recipient.firstName)},</p>` : '';
  const heroBtn = issue.hero_button_text && safeUrl(issue.hero_button_url) ? btn(tracked(issue, 'h', '0', safeUrl(issue.hero_button_url), preview), issue.hero_button_text) : '';
  rows.push(section(`${issue.headline ? `<h1 style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;color:${INK}">${esc(issue.headline)}</h1>` : ''}${greet}${paras(issue.intro, P)}${heroBtn}`));
  // Next match.
  if (issue.include_match && match) {
    const when = new Date(match.event_date);
    const day = when.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' });
    const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
    const home = /lobi stars/i.test(match.home_team);
    rows.push(section(`${label(T.matchLabel)}
      <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:${INK}">${esc(match.home_team)} vs ${esc(match.away_team)}</p>
      <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#5B6472">${esc(day)}, ${esc(time)}${match.venue ? `<br>${esc(match.venue)}` : ''}</p>
      ${btn(tracked(issue, 'm', '0', home ? '/tickets/' : '/fixtures/', preview), home ? 'Get your tickets' : 'Match details', INK)}`, '24px 32px', '#FFF8E1'));
  }
  // Stories.
  const stories = (issue.stories || []).filter(s => s && s.title);
  if (stories.length) {
    const items = stories.map((s, i) => {
      const href = safeUrl(s.url) ? tracked(issue, 't', String(i), safeUrl(s.url), preview) : '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td>
        ${s.image ? `${href ? `<a href="${esc(href)}">` : ''}<img src="${esc(abs(s.image))}" width="536" alt="" style="display:block;width:100%;max-width:536px;height:auto;max-height:320px;object-fit:cover;border-radius:10px;border:0;margin:0 0 12px">${href ? '</a>' : ''}` : ''}
        <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:bold;line-height:1.3;color:${INK}">${href ? `<a href="${esc(href)}" style="color:${INK};text-decoration:none">${esc(s.title)}</a>` : esc(s.title)}</p>
        ${s.text ? `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#4B5563">${esc(s.text)}</p>` : ''}
        ${href ? `<a href="${esc(href)}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${RED};text-decoration:none">Read more &rarr;</a>` : ''}
      </td></tr></table>`;
    }).join('');
    rows.push(section(`${label(T.storiesLabel)}${items}`, '26px 32px 6px'));
  }
  // Sponsor extras shared by both advert styles: offer / promo code and contact details.
  const extras = s => `${s.offer ? `<p style="margin:0 0 12px"><span style="display:inline-block;padding:8px 12px;border:2px dashed ${GOLD};border-radius:8px;background:#FFF8E1;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${INK}">${esc(s.offer)}</span></p>` : ''}
    ${s.address || s.phone || s.email ? `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6B7280">${[s.address ? esc(s.address) : '', s.phone ? `<a href="tel:${esc(String(s.phone).replace(/[^\d+]/g, ''))}" style="color:#6B7280">${esc(s.phone)}</a>` : '', s.email ? `<a href="mailto:${esc(s.email)}" style="color:#6B7280">${esc(s.email)}</a>` : ''].filter(Boolean).join('<br>')}</p>` : ''}`;
  // Featured sponsors: a full-width advert with a wide banner picture.
  const featured = list.filter(s => s.featured);
  if (featured.length) {
    const banner = s => {
      const href = tracked(issue, 's', s.id, safeUrl(s.link), preview);
      const img = s.banner_image || s.logo;
      const pic = s.banner_image
        ? `<img src="${esc(abs(img))}" width="536" alt="${esc(s.name)}" style="display:block;width:100%;max-width:536px;height:auto;border-radius:10px;border:0;margin:0 0 14px">`
        : (s.logo ? `<img src="${esc(abs(s.logo))}" alt="${esc(s.name)}" height="64" style="display:block;height:64px;max-width:240px;margin:0 auto 14px;border:0">` : '');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#ffffff;border:1px solid #E6E8EB;border-radius:12px"><tr><td style="padding:18px;text-align:center">
        ${href && pic ? `<a href="${esc(href)}">${pic}</a>` : pic}
        ${s.headline ? `<p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#8A6D00">${esc(s.headline)}</p>` : ''}
        <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:${INK}">${esc(s.name)}</p>
        ${s.text ? `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#4B5563">${esc(s.text)}</p>` : ''}
        ${extras(s)}
        ${href ? btn(href, s.button_text || 'Visit website') : ''}
      </td></tr></table>`;
    };
    rows.push(`<tr><td class="px" style="padding:24px 32px 8px;background:#F4F5F7">${label(T.featuredLabel)}${featured.map(banner).join('')}</td></tr>`);
  }
  // Sponsor adverts (two per row on computers, one per row on phones).
  const grid2 = list.filter(s => !s.featured);
  if (grid2.length) {
    const card = s => {
      const href = tracked(issue, 's', s.id, safeUrl(s.link), preview);
      const logo = s.logo ? `<img src="${esc(abs(s.logo))}" alt="${esc(s.name)}" height="56" style="display:block;height:56px;max-width:200px;margin:0 auto 12px;border:0">` : '';
      return `<td class="sp" width="50%" valign="top" style="padding:8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E6E8EB;border-radius:12px"><tr><td style="padding:18px 16px;text-align:center">
          ${href && logo ? `<a href="${esc(href)}">${logo}</a>` : logo}
          ${s.headline ? `<p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#8A6D00">${esc(s.headline)}</p>` : ''}
          <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:${INK}">${esc(s.name)}</p>
          ${s.text ? `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#4B5563">${esc(s.text)}</p>` : ''}
          ${extras(s)}
          ${href ? `<a href="${esc(href)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${INK};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">${esc(s.button_text || 'Visit website')}</a>` : ''}
        </td></tr></table></td>`;
    };
    let grid = '';
    for (let i = 0; i < grid2.length; i += 2) grid += `<tr>${card(grid2[i])}${grid2[i + 1] ? card(grid2[i + 1]) : '<td class="sp" width="50%"></td>'}</tr>`;
    rows.push(`<tr><td class="px" style="padding:24px 24px 18px;background:#F4F5F7">
      <p style="margin:0 0 6px;padding:0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${RED}">${esc(T.partnersLabel)}</p>
      <p style="margin:0 0 6px;padding:0 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5B6472">${esc(T.partnersText)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${grid}</table></td></tr>`);
  }
  // Footer.
  const unsub = recipient.unsubscribeUrl
    ? `<a href="${esc(recipient.unsubscribeUrl)}" style="color:#C9CDD3">Unsubscribe</a>${recipient.optionsUrl ? ` &middot; <a href="${esc(recipient.optionsUrl)}" style="color:#C9CDD3">Newsletter options</a>` : ''}`
    : `<a href="${SITE}/newsletter/" style="color:#C9CDD3">Newsletter options</a>`;
  rows.push(`<tr><td style="background:${INK};padding:24px 32px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#C9CDD3">
    <p style="margin:0 0 8px"><a href="${SITE}/" style="color:${GOLD};font-weight:bold;text-decoration:none">lobistarsfc.com</a>${[['facebook', 'Facebook'], ['x', 'X'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['whatsapp', 'WhatsApp']].filter(([k]) => safeUrl(T[k])).map(([k, n]) => ` &middot; <a href="${esc(T[k])}" style="color:#ffffff;text-decoration:none">${n}</a>`).join('')}</p>
    ${T.footerAddress ? `<p style="margin:0 0 8px">${esc(T.footerAddress)}</p>` : ''}
    <p style="margin:0">${esc(T.footerNote)} ${unsub}</p>
  </td></tr>`);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<title>${esc(issue.subject)}</title>
<style>@media (max-width:620px){.px{padding-left:18px!important;padding-right:18px!important}.sp{display:block!important;width:100%!important;box-sizing:border-box}}</style>${web ? '<meta name="robots" content="noindex">' : ''}</head>
<body style="margin:0;padding:0;background:#EEF0F3">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(issue.preheader || '')}&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F3"><tr><td align="center" style="padding:18px 10px">
  ${web ? '' : `<p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6B7280">Can't see this properly? <a href="${esc(webUrl)}" style="color:#6B7280">View it in your browser</a></p>`}
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(15,17,21,.08)">${rows.join('\n')}</table>
</td></tr></table></body></html>`;
}

/** Plain-text version for email apps that don't show HTML. */
export function renderText({ issue, sponsors = [], match = null, recipient = {} }) {
  const byId = new Map(sponsors.map(s => [s.id, s]));
  const lines = ['LOBI STARS FC - THE WEEKLY NEWSLETTER', ''];
  if (issue.headline) lines.push(issue.headline.toUpperCase(), '');
  if (recipient.firstName) lines.push(`Hi ${recipient.firstName},`, '');
  if (issue.intro) lines.push(issue.intro.trim(), '');
  if (issue.include_match && match) lines.push(`NEXT MATCH: ${match.home_team} vs ${match.away_team}, ${new Date(match.event_date).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'full', timeStyle: 'short' })}`, '');
  for (const s of issue.stories || []) if (s.title) lines.push(`- ${s.title}${s.url ? ` ${abs(s.url)}` : ''}`);
  const sp = (issue.sponsor_ids || []).map(id => byId.get(id)).filter(Boolean);
  if (sp.length) lines.push('', 'OUR PARTNERS', ...sp.map(s => `- ${s.name}${s.link ? `: ${s.link}` : ''}`));
  lines.push('', SITE, recipient.unsubscribeUrl ? `Unsubscribe: ${recipient.unsubscribeUrl}` : '');
  return lines.join('\n');
}

/** People who get the weekly newsletter. */
export async function recipients(db, issueId = null, limit = 100000) {
  await ensureNewsletterSchema(db);
  const { results } = await db.prepare(
    `SELECT c.id, c.email, c.first_name, c.unsub_token FROM contacts c
     LEFT JOIN newsletter_subscribers n ON n.email = c.email
     WHERE c.email IS NOT NULL AND c.email != '' AND c.email NOT LIKE '%@deleted.invalid'
       AND c.marketing_consent = 1 AND c.unsubscribed_at IS NULL AND COALESCE(n.pref_weekly, 1) = 1
       ${issueId ? 'AND NOT EXISTS (SELECT 1 FROM newsletter_deliveries d WHERE d.issue_id = ? AND d.email = c.email)' : ''}
     ORDER BY c.id LIMIT ?`
  ).bind(...(issueId ? [issueId] : []), limit).all();
  return results;
}

export async function loadSponsors(db, activeOnly = false) {
  await ensureNewsletterSchema(db);
  const { results } = await db.prepare(`SELECT * FROM newsletter_sponsors ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort, name`).all();
  return results;
}
