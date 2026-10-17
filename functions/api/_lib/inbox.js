// Inbox: every Contact Form, Sponsorship and Hospitality message as an email
// conversation ("thread") that staff answer from the admin. Replies are sent
// by email (Resend) from the club address with the staff member's name, and
// the subject carries the conversation reference, e.g. [LS-2026-00123].
// When the fan replies, the email comes back through the inbound webhook
// (/api/inbox/inbound) and is added to the same conversation.
//
// Each conversation is linked to the original form record (enquiries table),
// which links to the person in the fan database, so merging people and
// deleting a person's data (erasure) carry over to their messages.
import { ensureContactsSchema, captureContact, normEmail } from './contacts.js';
import { ensureAdminSchema } from './adminSession.js';
import { ROLES } from './adminRoles.js';
import { sendEmail } from './email.js';
import { randomId } from './crypto.js';

export const INBOX_SOURCES = { contact_form: 'Contact Form', sponsorship: 'Sponsorship', hospitality: 'Hospitality', media_email: 'Media email' };
// The media team's mailbox: emails to it come in as "Media email" conversations and replies go out from it.
export const MEDIA_EMAIL = 'media@lobistarsfc.com';
export const STATUSES = ['new', 'open', 'replied', 'closed'];
const SITE = 'https://lobistarsfc.com';
export const SPAM_KEEP_DAYS = 30;

let ready = false;
export async function ensureInboxSchema(db) {
  if (ready) return;
  await ensureContactsSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS inbox_threads (
      id TEXT PRIMARY KEY,
      ref TEXT NOT NULL UNIQUE,              -- LS-2026-00123, shown in email subjects
      enquiry_id TEXT UNIQUE,                -- the original form record
      source TEXT NOT NULL,                  -- contact_form / sponsorship / hospitality
      subject TEXT, name TEXT, email TEXT, phone TEXT,
      details TEXT,                          -- JSON: company, interest, category...
      status TEXT NOT NULL DEFAULT 'new',    -- new / open / replied / closed
      unread INTEGER NOT NULL DEFAULT 1,
      assigned_to TEXT, assigned_name TEXT,
      preview TEXT,
      spam_at TEXT,
      created_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      last_in_at TEXT,                       -- the fan's latest message (age indicator)
      last_out_at TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS inbox_threads_last ON inbox_threads (last_message_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inbox_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      direction TEXT NOT NULL,               -- in (fan) / out (staff reply) / note (internal, never emailed)
      author_id TEXT, author_name TEXT,
      body_html TEXT NOT NULL,               -- always sanitised
      attachments TEXT,                      -- JSON [{name, type, size}] (files are emailed, not stored)
      delivery TEXT,                         -- out: sent / dev / not_sent
      email_id TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS inbox_messages_thread ON inbox_messages (thread_id, id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inbox_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, body_html TEXT NOT NULL, updated_at TEXT, updated_by TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inbox_ref_counter (year TEXT PRIMARY KEY, n INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inbox_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
  ]);
  // Starter templates (staff can edit or delete them).
  const any = await db.prepare(`SELECT 1 FROM inbox_templates LIMIT 1`).first();
  if (!any) {
    const now = new Date().toISOString();
    const t = (name, body) => db.prepare(`INSERT OR IGNORE INTO inbox_templates (id, name, body_html, updated_at, updated_by) VALUES (?, ?, ?, ?, 'System')`).bind(randomId('TPL', 8), name, body, now);
    await db.batch([
      t('Thanks for getting in touch', '<p>Hi {first_name},</p><p>Thank you for getting in touch with Lobi Stars FC. We have received your message and will come back to you shortly.</p>'),
      t('Sponsorship: next steps', '<p>Hi {first_name},</p><p>Thank you for your interest in partnering with Lobi Stars FC. Could you tell us a little more about your organisation and what you would like to achieve? We will then arrange a call to talk through the options.</p>'),
      t('Hospitality: details', '<p>Hi {first_name},</p><p>Thank you for your hospitality enquiry. Please let us know which match you are interested in and how many guests, and we will confirm availability and prices.</p>'),
    ]);
  }
  ready = true;
}

// ── Settings (alert emails, daily summary) ──

const SETTING_DEFAULTS = { alerts_email: '1', daily_summary: '1', extra_emails: '', daily_last: '' };
export async function inboxSettings(db) {
  await ensureInboxSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM inbox_settings`).all();
  const s = { ...SETTING_DEFAULTS, ...Object.fromEntries(results.map(r => [r.key, r.value ?? ''])) };
  return {
    alertsEmail: s.alerts_email === '1',
    dailySummary: s.daily_summary === '1',
    extraEmails: s.extra_emails.split(/[\s,;]+/).map(e => normEmail(e)).filter(Boolean),
    dailyLast: s.daily_last,
  };
}
export async function saveInboxSetting(db, key, value, by) {
  await db.prepare(`INSERT INTO inbox_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, String(value), new Date().toISOString(), by || '').run();
}

// ── Sanitising ──

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Plain text to safe HTML (paragraphs, line breaks, clickable links). */
export function textToHtml(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!t) return '';
  const link = s => s.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, u => `<a href="${u}">${u}</a>`);
  return t.split(/\n{2,}/).map(p => `<p>${link(esc(p)).replace(/\n/g, '<br>')}</p>`).join('');
}

const KEEP = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'div', 'span', 'blockquote']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'head', 'title', 'meta', 'link', 'img', 'video', 'audio', 'template', 'noscript', 'base', 'frame', 'frameset']);

/**
 * Only simple formatting survives (bold, italic, links, lists, paragraphs);
 * scripts, styles, images, event handlers and every other attribute are
 * removed. Links must be http(s) or mailto.
 */
export async function sanitizeHtml(html) {
  const input = String(html || '').slice(0, 200000);
  if (!input.trim()) return '';
  const out = await new HTMLRewriter()
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (DROP.has(tag)) { el.remove(); return; }
        if (!KEEP.has(tag)) { el.removeAndKeepContent(); return; }
        const href = tag === 'a' ? (el.getAttribute('href') || '').trim() : '';
        for (const [name] of [...el.attributes]) el.removeAttribute(name);
        if (tag === 'a') {
          if (/^(https?:|mailto:)/i.test(href)) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
          else el.removeAndKeepContent();
        }
      },
    })
    .onDocument({ comments(c) { c.remove(); }, doctype() {} })
    .transform(new Response(input, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
    .text();
  return out.trim().slice(0, 100000);
}

export const htmlToText = html => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|blockquote)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
  .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, h, t) => (t === h ? h : `${t} (${h})`))
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim();

const preview = html => htmlToText(html).replace(/\s+/g, ' ').slice(0, 140);

/** The new part of an emailed reply: drops the quoted earlier conversation. */
export function stripQuoted(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const cut = lines.findIndex(l => /^\s*On .{3,200}wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^\s*From:\s.+/i.test(l) && /^\s*(Sent|Date):/i.test(lines[lines.indexOf(l) + 1] || '') || /^_{10,}$/.test(l));
  let keep = cut > 0 ? lines.slice(0, cut) : lines;
  while (keep.length && /^\s*(>.*)?$/.test(keep[keep.length - 1])) keep = keep.slice(0, -1);
  return keep.join('\n').trim() || String(text || '').trim();
}

// ── References ──

/** Reserves `k` new conversation references for a year, e.g. LS-2026-00123. */
async function nextRefs(db, year, k) {
  const row = await db.prepare(`INSERT INTO inbox_ref_counter (year, n) VALUES (?, ?) ON CONFLICT (year) DO UPDATE SET n = n + excluded.n RETURNING n`).bind(year, k).first();
  const last = row.n;
  return Array.from({ length: k }, (_, i) => `LS-${year}-${String(last - k + 1 + i).padStart(5, '0')}`);
}
export const REF_RE = /LS-\d{4}-\d{5,}/i;

// ── Form messages to conversations (new ones and the backfill) ──

function sourceOf(e) {
  if (INBOX_SOURCES[e.src]) return e.src;
  if (e.kind === 'partnership') return 'sponsorship';
  return /^Hospitality/i.test(e.interest || '') ? 'hospitality' : 'contact_form';
}
function subjectOf(e, source) {
  if (e.subject) return e.subject;
  if (source === 'sponsorship') return e.interest ? `Sponsorship enquiry: ${e.interest}` : 'Sponsorship enquiry';
  if (source === 'hospitality') return e.interest || 'Hospitality enquiry';
  return 'Message from the website';
}

/**
 * Makes sure every Contact Form / Sponsorship / Hospitality record has a
 * conversation. With `enquiryId`, only that record. Returns the new threads.
 */
export async function syncEnquiries(db, enquiryId = null) {
  await ensureInboxSchema(db);
  const { results } = await db.prepare(
    `SELECT e.*, MAX(s.source) AS src FROM enquiries e
     LEFT JOIN inbox_threads t ON t.enquiry_id = e.id
     LEFT JOIN contact_sources s ON s.ref_table = 'enquiries' AND s.ref_id = e.id
     WHERE t.id IS NULL ${enquiryId ? 'AND e.id = ?' : ''} GROUP BY e.id ORDER BY e.created_at LIMIT 500`
  ).bind(...(enquiryId ? [enquiryId] : [])).all();
  if (!results.length) return [];
  const byYear = new Map();
  for (const e of results) { const y = String(e.created_at || new Date().toISOString()).slice(0, 4); byYear.set(y, [...(byYear.get(y) || []), e]); }
  const made = [];
  const stmts = [];
  for (const [year, list] of byYear) {
    const refs = await nextRefs(db, year, list.length);
    list.forEach((e, i) => {
      const source = sourceOf(e);
      const at = e.created_at || new Date().toISOString();
      const details = Object.fromEntries(Object.entries({ Company: e.company, Interest: e.interest, Category: e.category }).filter(([, v]) => v));
      const body = textToHtml(e.message) || '<p><em>(No message text, see the details.)</em></p>';
      const th = { id: randomId('THR', 12), ref: refs[i], enquiry_id: e.id, source, subject: subjectOf(e, source), name: [e.first_name, e.surname].filter(Boolean).join(' '), email: e.email, phone: e.phone || '' };
      stmts.push(db.prepare(
        `INSERT OR IGNORE INTO inbox_threads (id, ref, enquiry_id, source, subject, name, email, phone, details, status, unread, preview, created_at, last_message_at, last_in_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 1, ?, ?, ?, ?)`
      ).bind(th.id, th.ref, th.enquiry_id, th.source, th.subject, th.name, th.email, th.phone, JSON.stringify(details), preview(body), at, at, at));
      // Only if this call's thread was the one saved (two requests at once can't double up).
      stmts.push(db.prepare(
        `INSERT INTO inbox_messages (thread_id, direction, author_name, body_html, created_at) SELECT ?, 'in', ?, ?, ? WHERE EXISTS (SELECT 1 FROM inbox_threads WHERE id = ?)`
      ).bind(th.id, th.name || th.email, body, at, th.id));
      made.push(th);
    });
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  return made;
}

/** Spam is kept for 30 days, then deleted with the form record it came from. */
export async function purgeSpam(db) {
  const cutoff = new Date(Date.now() - SPAM_KEEP_DAYS * 864e5).toISOString();
  const { results } = await db.prepare(`SELECT id, enquiry_id FROM inbox_threads WHERE spam_at IS NOT NULL AND spam_at < ? LIMIT 200`).bind(cutoff).all();
  if (!results.length) return 0;
  const stmts = [];
  for (const t of results) {
    stmts.push(db.prepare(`DELETE FROM inbox_messages WHERE thread_id = ?`).bind(t.id));
    stmts.push(db.prepare(`DELETE FROM inbox_threads WHERE id = ?`).bind(t.id));
    if (t.enquiry_id) {
      stmts.push(db.prepare(`DELETE FROM enquiries WHERE id = ?`).bind(t.enquiry_id));
      stmts.push(db.prepare(`DELETE FROM contact_sources WHERE ref_table = 'enquiries' AND ref_id = ?`).bind(t.enquiry_id));
    }
  }
  // People who only ever sent spam disappear from the fan database too.
  stmts.push(db.prepare(`DELETE FROM contacts WHERE id NOT IN (SELECT contact_id FROM contact_sources)`));
  await db.batch(stmts);
  return results.length;
}

/** Statements that delete every conversation for these form records / this email (erasure). */
export async function erasureStatements(db, enquiryIds, email) {
  if (!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='inbox_threads'`).first())) return [];
  const stmts = [];
  for (const id of enquiryIds) {
    stmts.push(db.prepare(`DELETE FROM inbox_messages WHERE thread_id IN (SELECT id FROM inbox_threads WHERE enquiry_id = ?)`).bind(id));
    stmts.push(db.prepare(`DELETE FROM inbox_threads WHERE enquiry_id = ?`).bind(id));
  }
  if (email) {
    stmts.push(db.prepare(`DELETE FROM inbox_messages WHERE thread_id IN (SELECT id FROM inbox_threads WHERE email = ?)`).bind(email));
    stmts.push(db.prepare(`DELETE FROM inbox_threads WHERE email = ?`).bind(email));
  }
  return stmts;
}

// ── Staff ──

/** Active staff who can open the Inbox (for "Assign to"), plus the owner. */
export async function inboxStaff(db) {
  await ensureAdminSchema(db);
  const roles = Object.entries(ROLES).filter(([, r]) => r.areas.includes('inbox') || r.areas.includes('fans')).map(([k]) => k);
  const { results } = await db.prepare(`SELECT id, name, email, role FROM admin_users WHERE active = 1 AND role IN (${roles.map(() => '?').join(',')}) ORDER BY name`).bind(...roles).all();
  return [{ id: 'owner', name: 'Owner (admin code)', email: '', role: 'super_admin' }, ...results];
}

/** Who gets the alert for a new message: Fan Relations for the contact form, Commercial for sponsorship / hospitality. */
async function alertRecipients(db, source, settings) {
  const role = source === 'contact_form' ? 'fan_relations' : 'commercial';
  await ensureAdminSchema(db);
  const { results } = await db.prepare(`SELECT email FROM admin_users WHERE active = 1 AND role = ?`).bind(role).all();
  return [...new Set([...results.map(r => normEmail(r.email)).filter(Boolean), ...settings.extraEmails])];
}

const shell = inner => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#14171c;max-width:620px">${inner}</div>`;

/** Email alert to the relevant staff about a new conversation. Never throws. */
export async function alertNewThread(env, thread) {
  try {
    if (!env.RESEND_API_KEY) return 'no-email-service';
    const s = await inboxSettings(env.DB);
    if (!s.alertsEmail) return 'off';
    const to = await alertRecipients(env.DB, thread.source, s);
    if (!to.length) return 'no-recipients';
    const t = await env.DB.prepare(`SELECT * FROM inbox_threads WHERE id = ?`).bind(thread.id).first();
    if (!t) return 'gone';
    await sendEmail(env, {
      to, subject: `New ${INBOX_SOURCES[t.source]} message: ${t.subject} [${t.ref}]`,
      html: shell(`<p><b>${esc(t.name || t.email)}</b> sent a new ${esc(INBOX_SOURCES[t.source])} message.</p>
        <p style="background:#f4f5f7;border-radius:8px;padding:12px">${esc(t.preview)}</p>
        <p><a href="${SITE}/admin/inbox/?t=${encodeURIComponent(t.id)}" style="display:inline-block;background:#E31E24;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open in the Inbox</a></p>
        <p style="color:#888;font-size:12px">Please answer from the website Inbox (not by replying to this alert) so the conversation is kept in one place.</p>`),
    });
    return 'sent';
  } catch (err) {
    console.log('[inbox] alert failed', err.message);
    return 'failed';
  }
}

const lagosDay = (ms = Date.now()) => new Date(ms + 3600e3).toISOString().slice(0, 10);
const ageText = iso => { const h = Math.floor((Date.now() - Date.parse(iso)) / 3600e3); return h < 1 ? 'under an hour' : h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h / 24)} days`; };

/**
 * Daily summary of unanswered messages, once a day after 8am (Nigerian time).
 * Pages Functions have no timer, so it goes out the first time any staff
 * member opens the admin (the bell checks) or a new message arrives after 8am.
 */
export async function maybeDailySummary(env) {
  try {
    if (!env.RESEND_API_KEY) return 'no-email-service';
    const hourLagos = (new Date().getUTCHours() + 1) % 24;
    if (hourLagos < 8) return 'too-early';
    const db = env.DB;
    const s = await inboxSettings(db);
    const today = lagosDay();
    if (!s.dailySummary || s.dailyLast === today) return 'skip';
    // Claim today's summary (only one request sends it).
    const claim = await db.prepare(`INSERT INTO inbox_settings (key, value, updated_at, updated_by) VALUES ('daily_last', ?, ?, 'System')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE inbox_settings.value IS NOT excluded.value`).bind(today, new Date().toISOString()).run();
    if (!claim.meta?.changes) return 'skip';
    const { results } = await db.prepare(`SELECT * FROM inbox_threads WHERE spam_at IS NULL AND status IN ('new', 'open') ORDER BY last_in_at LIMIT 30`).all();
    if (!results.length) return 'nothing';
    const total = (await db.prepare(`SELECT COUNT(*) AS n FROM inbox_threads WHERE spam_at IS NULL AND status IN ('new', 'open')`).first()).n;
    const to = [...new Set([...(await alertRecipients(db, 'contact_form', s)), ...(await alertRecipients(db, 'sponsorship', s))])];
    if (!to.length) return 'no-recipients';
    const rows = results.map(t => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(t.ref)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(INBOX_SOURCES[t.source])}</td><td style="padding:6px 8px;border-bottom:1px solid #eee"><b>${esc(t.name || t.email)}</b><br>${esc(t.subject)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap">${esc(ageText(t.last_in_at || t.created_at))}</td></tr>`).join('');
    await sendEmail(env, {
      to, subject: `Inbox: ${total} message${total === 1 ? '' : 's'} waiting for a reply`,
      html: shell(`<p><b>${total}</b> message${total === 1 ? ' is' : 's are'} waiting for a reply in the Lobi Stars FC Inbox.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="text-align:left;background:#f4f5f7"><th style="padding:6px 8px">Ref</th><th style="padding:6px 8px">Type</th><th style="padding:6px 8px">From</th><th style="padding:6px 8px">Waiting</th></tr>${rows}</table>
        <p><a href="${SITE}/admin/inbox/" style="display:inline-block;background:#E31E24;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open the Inbox</a></p>
        <p style="color:#888;font-size:12px">You can turn this daily email off in the Inbox settings.</p>`),
    });
    return 'sent';
  } catch (err) {
    console.log('[inbox] daily summary failed', err.message);
    return 'failed';
  }
}

// ── Replies ──

export const fromAddress = (env, thread = null) => (thread?.source === 'media_email' ? env.MEDIA_FROM_EMAIL || MEDIA_EMAIL : env.INBOX_FROM_EMAIL || 'info@lobistarsfc.com');
const cleanName = s => String(s || '').replace(/[<>"\\,;]/g, '').trim();
export const staffFirstName = admin => (admin.id === 'owner' ? '' : cleanName(admin.name).split(/\s+/)[0]);
export const fill = (html, vars) => String(html || '').replace(/\{(first_name|staff_name|ref)\}/g, (_, k) => esc(vars[k] || ''));
const niceDate = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The email a fan receives: reply, signature, reference and the quoted original message. */
export function composeReply(env, { thread, admin, bodyHtml, quoted }) {
  const first = staffFirstName(admin);
  const fromName = first ? `${first} from Lobi Stars FC` : 'Lobi Stars FC';
  const subject = `${/^re:/i.test(thread.subject || '') ? '' : 'Re: '}${thread.subject || 'Your message'} [${thread.ref}]`;
  const replyTo = env.INBOX_REPLY_DOMAIN ? `reply+${thread.ref}@${env.INBOX_REPLY_DOMAIN}` : fromAddress(env, thread);
  const quote = quoted ? `<div style="margin-top:22px;border-left:3px solid #d6d9de;padding-left:12px;color:#555">
      <p style="margin:0 0 6px;font-size:13px">On ${esc(niceDate(quoted.created_at))}, ${esc(quoted.author_name || thread.name || thread.email)} wrote:</p>${quoted.body_html}</div>` : '';
  const html = shell(`${bodyHtml}
    <p style="margin-top:18px">${first ? `${esc(first)}<br>` : ''}<b>Lobi Stars FC</b><br><a href="${SITE}" style="color:#E31E24">lobistarsfc.com</a></p>
    <p style="color:#8a8f98;font-size:12px">Reference: ${esc(thread.ref)}. To continue the conversation, just reply to this email.</p>${quote}`);
  return { from: `${thread.source === 'media_email' ? fromName.replace('Lobi Stars FC', 'Lobi Stars FC Media') : fromName} <${fromAddress(env, thread)}>`, replyTo, subject, html, text: htmlToText(html) };
}

// ── Fan replies (inbound email) ──

/**
 * Adds an emailed reply to its conversation: found by the reference in the
 * reply address (reply+LS-2026-00123@...) or the subject; otherwise the
 * sender's latest conversation; otherwise a new conversation.
 */
/** skipContact: don't add the sender to the fan database (e.g. an unverified "delete my data" request). */
export async function addInbound(env, { from, to, subject, text, html, skipContact = false, mailbox = null }) {
  const db = env.DB;
  await ensureInboxSchema(db);
  const fromEmail = normEmail((String(from || '').match(/<([^>]+)>/) || [])[1] || from);
  if (!fromEmail) return { ok: false, error: 'No sender address' };
  const fromName = cleanName(String(from || '').replace(/<[^>]*>/, '').replace(/"/g, '')) || fromEmail;
  const ref = (String(to || '').match(REF_RE) || String(subject || '').match(REF_RE) || [])[0]?.toUpperCase();
  let t = ref ? await db.prepare(`SELECT * FROM inbox_threads WHERE ref = ?`).bind(ref).first() : null;
  // A new email to the media mailbox joins the sender's media conversation, never a contact-form one (and the other way round).
  if (!t) t = await db.prepare(`SELECT * FROM inbox_threads WHERE email = ? AND spam_at IS NULL AND ${mailbox === 'media' ? "source = 'media_email'" : "source != 'media_email'"} ORDER BY last_message_at DESC LIMIT 1`).bind(fromEmail).first();
  const body = text ? textToHtml(stripQuoted(text)) : await sanitizeHtml(html);
  const safeBody = body || '<p><em>(Empty email)</em></p>';
  const now = new Date().toISOString();
  if (!t) {
    // A brand-new email: saved like a contact form message so it is in the fan database too.
    const id = randomId('ENQ', 10);
    const [firstName, ...rest] = fromName.includes('@') ? [''] : fromName.split(/\s+/);
    await db.prepare(`INSERT INTO enquiries (id, kind, first_name, surname, email, subject, message, privacy_consent) VALUES (?, 'contact', ?, ?, ?, ?, ?, 0)`)
      .bind(id, firstName || null, rest.join(' ') || null, fromEmail, String(subject || '').slice(0, 200) || 'Email', htmlToText(safeBody).slice(0, 5000)).run();
    if (!skipContact) await captureContact(env, { source: 'contact_form', refTable: 'enquiries', refId: id, email: fromEmail, firstName, surname: rest.join(' '), label: String(subject || '').slice(0, 120) });
    const [made] = await syncEnquiries(db, id);
    if (mailbox === 'media' && made?.id) await db.prepare(`UPDATE inbox_threads SET source = 'media_email' WHERE id = ?`).bind(made.id).run();
    return { ok: true, threadId: made?.id, created: true };
  }
  const other = fromEmail !== normEmail(t.email);
  await db.batch([
    db.prepare(`INSERT INTO inbox_messages (thread_id, direction, author_name, body_html, created_at) VALUES (?, 'in', ?, ?, ?)`)
      .bind(t.id, other ? `${fromName} (${fromEmail}, a different address)` : (t.name || fromName), safeBody, now),
    db.prepare(`UPDATE inbox_threads SET status = 'open', unread = 1, spam_at = NULL, preview = ?, last_message_at = ?, last_in_at = ? WHERE id = ?`)
      .bind(preview(safeBody), now, now, t.id),
  ]);
  return { ok: true, threadId: t.id, created: false };
}
