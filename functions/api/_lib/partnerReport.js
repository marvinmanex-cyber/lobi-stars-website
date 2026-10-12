// Monthly partner reports: for each partner, the month's exposure on the
// club's channels (website impressions, clicks to their website, views of
// their partner page, newsletter sends and advert clicks, Match Day
// Programme reach), as a branded email and a printable page (save as PDF).
// Totals only: never any fan's personal data. Sent by staff, or
// automatically on the 2nd of each month (cron Worker), once per partner and
// month.
import { sendEmail } from './email.js';
import { ensureAnalyticsSchema } from './analytics.js';

export const SITE = 'https://lobistarsfc.com';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let ready = false;
export async function ensurePartnerReportSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS partner_report_contacts (
      partner_slug TEXT PRIMARY KEY,
      emails TEXT NOT NULL DEFAULT '',     -- comma separated
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT, updated_by TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS partner_report_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_slug TEXT NOT NULL,
      month TEXT NOT NULL,                 -- YYYY-MM
      status TEXT NOT NULL,                -- sent | failed
      recipients TEXT,
      error TEXT,
      sent_by TEXT,                        -- null = automatic
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_partner_report_sends ON partner_report_sends (partner_slug, month, status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS partner_report_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
    db.prepare(`INSERT OR IGNORE INTO partner_report_settings (key, value) VALUES ('auto_send', 'false')`),
  ]);
  ready = true;
}

/** "2026-09" -> { start, end } in Nigerian time (UTC+1) as DB timestamps, plus a label. */
export function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const startMs = Date.UTC(y, mo - 1, 1) - 3600e3, endMs = Date.UTC(y, mo, 1) - 3600e3;
  const sql = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  return { month: `${m[1]}-${m[2]}`, label: `${MONTHS[mo - 1]} ${y}`, start: sql(startMs), end: sql(endMs), startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}
/** The month before `now` in Nigerian time, as YYYY-MM. */
export function previousMonth(now = Date.now()) {
  const d = new Date(now + 3600e3);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const mo = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  return `${y}-${String(mo).padStart(2, '0')}`;
}
export const dayOfMonthWAT = (now = Date.now()) => new Date(now + 3600e3).getUTCDate();

export async function loadPartners(env, origin) {
  try {
    const list = await (await env.ASSETS.fetch(new URL('/data/partners.json', origin))).json();
    return (Array.isArray(list) ? list : []).filter(p => p && p.slug && p.active !== false);
  } catch { return []; }
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** All partners' numbers for one month. */
export async function buildReport(env, origin, month) {
  const db = env.DB;
  const r = monthRange(month);
  if (!r) throw new Error('Choose a month (YYYY-MM).');
  await ensureAnalyticsSchema(db);
  const partners = await loadPartners(env, origin);
  const t = async sql => db.prepare(sql).first().catch(() => null);
  const tableExists = async n => !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).bind(n).first());
  const S = [r.start, r.end];
  const site = await db.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM pageviews WHERE ts >= ? AND ts < ?`).bind(...S).first();
  const { results: clicks } = await db.prepare(`SELECT label, COUNT(*) AS n FROM track_events WHERE name = 'partner_click' AND ts >= ? AND ts < ? GROUP BY label`).bind(...S).all();
  const { results: pages } = await db.prepare(`SELECT path, COUNT(*) AS n FROM pageviews WHERE path LIKE '/partners/%' AND ts >= ? AND ts < ? GROUP BY path`).bind(...S).all();

  // Match Day Programme reach (totals only).
  let programme = { readers: 0, opens: 0, downloads: 0 };
  if (await tableExists('programme_events')) {
    const p = await db.prepare(`SELECT COUNT(DISTINCT fan_id) AS readers, SUM(type = 'open') AS opens, SUM(type = 'download') AS downloads
      FROM programme_events WHERE created_at >= ? AND created_at < ?`).bind(...S).first();
    programme = { readers: p?.readers || 0, opens: p?.opens || 0, downloads: p?.downloads || 0 };
  }

  // Newsletter: issues sent this month that carried the partner's advert (matched by name).
  let sponsors = [], issues = [], nlClicks = [];
  if (await tableExists('newsletter_issues')) {
    sponsors = (await db.prepare(`SELECT id, name FROM newsletter_sponsors`).all()).results;
    issues = (await db.prepare(`SELECT id, sponsor_ids, top_sponsor_id, sent_count FROM newsletter_issues WHERE status = 'sent' AND sent_at >= ? AND sent_at < ?`).bind(r.startIso, r.endIso).all()).results;
    nlClicks = (await db.prepare(`SELECT ref, COUNT(*) AS n FROM newsletter_clicks WHERE kind = 's' AND at >= ? AND at < ? GROUP BY ref`).bind(r.startIso, r.endIso).all()).results;
  }
  const views = site?.views || 0;
  return {
    month: r.month, label: r.label,
    site: { views, visitors: site?.visitors || 0 },
    programme,
    partners: partners.map(p => {
      const sp = sponsors.find(s => norm(s.name) === norm(p.name));
      const inIssues = sp ? issues.filter(i => { try { return JSON.parse(i.sponsor_ids || '[]').includes(sp.id) || i.top_sponsor_id === sp.id; } catch { return false; } }) : [];
      const c = clicks.find(x => x.label === p.slug)?.n || 0;
      return {
        slug: p.slug, name: p.name, tier: p.tier, logo: p.logo ? new URL(p.logo, SITE).href : null,
        impressions: views, clicks: c, clickRate: views ? c / views : 0,
        pageViews: pages.filter(x => x.path.replace(/\/$/, '') === `/partners/${p.slug}`).reduce((a, x) => a + x.n, 0),
        newsletter: { issues: inIssues.length, recipients: inIssues.reduce((a, i) => a + (i.sent_count || 0), 0), clicks: sp ? (nlClicks.find(x => x.ref === sp.id)?.n || 0) : 0 },
      };
    }),
  };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = n => Number(n || 0).toLocaleString('en-NG');

/** The report for one partner as { subject, html, text }. web = printable page version. */
export function renderPartnerReport(report, partner, { contactEmail = 'info@lobistarsfc.com', web = false } = {}) {
  const tiles = [
    ['Website impressions', nf(partner.impressions), 'Page views on lobistarsfc.com; your logo is on every page'],
    ['Visits to your website', nf(partner.clicks), `Clicks from our site to yours (${(partner.clickRate * 100).toFixed(2)}% of impressions)`],
    ['Views of your partner page', nf(partner.pageViews), `lobistarsfc.com/partners/${partner.slug}`],
    ['Fans who visited the site', nf(report.site.visitors), 'Different visitors this month'],
  ];
  if (partner.newsletter.issues) tiles.push(['Newsletter', `${nf(partner.newsletter.recipients)} sent`, `${partner.newsletter.issues} issue${partner.newsletter.issues === 1 ? '' : 's'} with your advert · ${nf(partner.newsletter.clicks)} click${partner.newsletter.clicks === 1 ? '' : 's'} on it`]);
  if (report.programme.opens || report.programme.downloads) tiles.push(['Match Day Programme', `${nf(report.programme.opens + report.programme.downloads)} reads`, `${nf(report.programme.readers)} registered fans read or downloaded the programme`]);
  const subject = `Lobi Stars FC partner report: ${report.label} (${partner.name})`;
  const tileHtml = tiles.map(([k, v, s]) => `<td style="width:50%;padding:6px;vertical-align:top"><div style="background:#F4F5F7;border-radius:12px;padding:14px 16px">
    <div style="font-size:13px;color:#5B6472;font-weight:bold">${esc(k)}</div><div style="font-size:28px;font-weight:bold;color:#15181D;margin:4px 0">${esc(v)}</div><div style="font-size:12px;color:#5B6472">${esc(s)}</div></div></td>`);
  const rows = [];
  for (let i = 0; i < tileHtml.length; i += 2) rows.push(`<tr>${tileHtml[i]}${tileHtml[i + 1] || '<td></td>'}</tr>`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title>
${web ? '<style>@media print{.np{display:none}} body{margin:0}</style>' : ''}</head>
<body style="margin:0;background:#E9EBEE;font-family:Arial,Helvetica,sans-serif;color:#15181D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="100%" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#15181D;padding:18px 24px"><table role="presentation" width="100%"><tr>
<td><img src="${SITE}/images/lobi-stars-badge.png" width="44" height="44" alt="Lobi Stars FC" style="vertical-align:middle;background:#fff;border-radius:50%;padding:3px"> <span style="color:#fff;font-size:20px;font-weight:bold;letter-spacing:1px;vertical-align:middle">LOBI STARS FC</span></td>
<td align="right" style="color:#FFC72C;font-size:12px;font-weight:bold;letter-spacing:1px">PARTNER REPORT</td></tr></table></td></tr>
<tr><td style="padding:24px 24px 6px">
${partner.logo ? `<img src="${esc(partner.logo)}" alt="${esc(partner.name)}" style="max-height:56px;max-width:200px;margin-bottom:12px">` : ''}
<div style="font-size:24px;font-weight:bold">${esc(partner.name)}</div>
<div style="font-size:15px;color:#5B6472;margin-top:4px">${esc(partner.tier)} · ${esc(report.label)}</div>
<p style="font-size:15px;line-height:1.55;margin:16px 0 8px">Thank you for supporting Lobi Stars FC. Here is how your partnership showed up on the club's channels in ${esc(report.label)}.</p>
</td></tr>
<tr><td style="padding:0 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>
<tr><td style="padding:14px 24px 24px;font-size:13px;line-height:1.55;color:#5B6472">
These are totals from the club's own website statistics (Nigerian time). They contain no personal details of fans.
Questions or ideas for next month: <a href="mailto:${esc(contactEmail)}" style="color:#B3161B">${esc(contactEmail)}</a>.
</td></tr>
<tr><td style="background:#E31E24;height:6px"></td></tr>
</table>
${web ? '<p class="np" style="font-size:13px;color:#5B6472"><button onclick="print()" style="padding:10px 18px;font-size:14px;cursor:pointer">Print or save as PDF</button></p>' : ''}
</td></tr></table></body></html>`;
  const text = `${subject}\n\n${tiles.map(([k, v, s]) => `${k}: ${v} (${s})`).join('\n')}\n\nTotals only, no personal details of fans. Questions: ${contactEmail}`;
  return { subject, html, text };
}

export const cleanEmails = s => [...new Set(String(s || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)))].slice(0, 10);

/**
 * Sends the month's report to partners that have email addresses. Skips any
 * partner already sent for that month unless force. Returns per-partner results.
 */
export async function sendPartnerReports(env, origin, month, { slugs = null, force = false, by = null, contactEmail } = {}) {
  const db = env.DB;
  await ensurePartnerReportSchema(db);
  if (!env.RESEND_API_KEY) throw new Error('Email is not set up yet (Resend), so reports cannot be sent. Use "Open report" to print or save them as PDF.');
  const report = await buildReport(env, origin, month);
  const { results: contacts } = await db.prepare(`SELECT * FROM partner_report_contacts WHERE enabled = 1`).all();
  const out = [];
  for (const p of report.partners) {
    if (slugs && !slugs.includes(p.slug)) continue;
    const c = contacts.find(x => x.partner_slug === p.slug);
    const to = cleanEmails(c?.emails);
    if (!to.length) { if (slugs) out.push({ slug: p.slug, ok: false, error: 'No email address for this partner.' }); continue; }
    if (!force && await db.prepare(`SELECT 1 FROM partner_report_sends WHERE partner_slug = ? AND month = ? AND status = 'sent'`).bind(p.slug, report.month).first()) {
      out.push({ slug: p.slug, ok: true, skipped: true }); continue;
    }
    const mail = renderPartnerReport(report, p, { contactEmail });
    try {
      await sendEmail(env, { to, subject: mail.subject, html: mail.html, text: mail.text, replyTo: contactEmail });
      await db.prepare(`INSERT INTO partner_report_sends (partner_slug, month, status, recipients, sent_by) VALUES (?, ?, 'sent', ?, ?)`).bind(p.slug, report.month, to.join(', '), by).run();
      out.push({ slug: p.slug, ok: true });
    } catch (err) {
      const error = String(err?.message || err).slice(0, 300);
      await db.prepare(`INSERT INTO partner_report_sends (partner_slug, month, status, recipients, error, sent_by) VALUES (?, ?, 'failed', ?, ?, ?)`).bind(p.slug, report.month, to.join(', '), error, by).run();
      out.push({ slug: p.slug, ok: false, error });
    }
  }
  return { month: report.month, label: report.label, results: out };
}

export async function clubContactEmail(env, origin) {
  try { return (await (await env.ASSETS.fetch(new URL('/data/site.json', origin))).json())?.contact?.email || 'info@lobistarsfc.com'; } catch { return 'info@lobistarsfc.com'; }
}
