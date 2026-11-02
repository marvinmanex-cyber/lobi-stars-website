// Media Centre › Press List: every journalist, photographer, broadcaster and media
// house the club deals with (one row per email, in mc_contacts), and "Send to press
// list": one email per person from media@lobistarsfc.com, each with a one-click
// unsubscribe link. People join the list by ticking the box on the accreditation
// form, or are added / imported by staff (who confirm the person agreed).
// Only subscribed people receive general sends (statements, matchday links,
// general messages); an accreditation notice may also reach people who applied
// for that match, because it is about their own accreditation.
import { sendEmail } from './email.js';
import { mcLog, mediaActor, oneLine, newId, parseJson, mcSettings } from './mediaCentre.js';
import { ensureAccreditationSchema, eventById, matchDay } from './mediaAccreditation.js';
import { matchSettings, SITE, MEDIA_FROM } from './accreditationCards.js';
import { matchSlug } from './matchSlug.js';
import { sanitizeHtml, textOf } from './mediaSanitize.js';
import { fileRow, fileBytes } from './mediaFiles.js';

export const MEDIA_TYPES = ['Newspaper', 'Radio', 'TV', 'Online', 'Freelance', 'Agency'];
export const SOURCES = { accreditation: 'Accreditation form', staff: 'Added by staff', import: 'Imported', interview: 'Interview request' };
export const TYPES = { statement: 'Club statement / press release', matchday: 'Matchday accreditation link', notice: 'Accreditation notice', general: 'General message' };
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const nowIso = () => new Date().toISOString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const BATCH = 8; // emails per "send" call (the page keeps calling until all are sent)

let ready = false;
export async function ensurePressSchema(db) {
  if (ready) return;
  await ensureAccreditationSchema(db);
  const cols = new Set((await db.prepare(`PRAGMA table_info(mc_contacts)`).all()).results.map(c => c.name));
  for (const [c, t] of [['media_type', 'TEXT'], ['notes', 'TEXT'], ['subscribed', 'INTEGER NOT NULL DEFAULT 0'], ['consent_at', 'TEXT'], ['consent_source', 'TEXT'], ['source', 'TEXT'],
    ['applications_count', 'INTEGER NOT NULL DEFAULT 0'], ['last_applied_at', 'TEXT'], ['last_contacted_at', 'TEXT'], ['unsubscribed_at', 'TEXT']]) {
    if (!cols.has(c)) await db.prepare(`ALTER TABLE mc_contacts ADD COLUMN ${c} ${t}`).run();
  }
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_press_messages (
      id TEXT PRIMARY KEY, sent_by_id TEXT, sent_by_name TEXT NOT NULL,
      type TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      attachments TEXT,                        -- JSON [{id, name}]
      press_item_id TEXT, event_id TEXT,
      recipients_count INTEGER NOT NULL DEFAULT 0, sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, finished_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_press_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, email TEXT NOT NULL, full_name TEXT, organisation TEXT,
      status TEXT NOT NULL DEFAULT 'queued',  -- queued / sending / sent / failed
      error TEXT, sent_at TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mc_press_recipients_msg ON mc_press_recipients (message_id, status)`),
  ]);
  // One-off backfill: everyone who already applied for accreditation (not subscribed: they never agreed).
  const done = await db.prepare(`SELECT value FROM mc_settings WHERE key = 'press_backfill_v1'`).first();
  if (!done) {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO mc_contacts (email, full_name, phone, organisation, employment, role, photo_id, accreditations, interviews, history, first_seen, last_seen, source)
        SELECT email, full_name, phone, organisation, employment, role, photo_id, 0, 0, '[]', MIN(created_at), MAX(created_at), 'Accreditation form' FROM mc_accreditations GROUP BY email`),
      db.prepare(`UPDATE mc_contacts SET applications_count = (SELECT COUNT(DISTINCT event_id) FROM mc_accreditations a WHERE a.email = mc_contacts.email),
        last_applied_at = (SELECT MAX(created_at) FROM mc_accreditations a WHERE a.email = mc_contacts.email)`),
      db.prepare(`UPDATE mc_contacts SET source = CASE WHEN applications_count > 0 THEN 'Accreditation form' ELSE 'Interview request' END WHERE source IS NULL`),
      db.prepare(`INSERT OR IGNORE INTO mc_settings (key, value) VALUES ('press_backfill_v1', ?)`).bind(nowIso()),
    ]);
  }
  ready = true;
}

/** An accreditation application: create or update the contact (email is the key). */
export async function recordApplicant(db, v, photoId, optIn) {
  await ensurePressSchema(db);
  const at = nowIso();
  await db.prepare(`INSERT INTO mc_contacts (email, full_name, phone, organisation, employment, role, photo_id, accreditations, interviews, history, first_seen, last_seen, source, applications_count, last_applied_at, subscribed, consent_at, consent_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, '[]', ?, ?, 'Accreditation form', (SELECT MAX(1, COUNT(DISTINCT event_id)) FROM mc_accreditations WHERE email = ?1), ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET full_name = excluded.full_name, phone = COALESCE(excluded.phone, mc_contacts.phone), organisation = COALESCE(excluded.organisation, mc_contacts.organisation),
      employment = COALESCE(excluded.employment, mc_contacts.employment), role = COALESCE(excluded.role, mc_contacts.role), photo_id = COALESCE(excluded.photo_id, mc_contacts.photo_id),
      applications_count = excluded.applications_count, last_applied_at = excluded.last_applied_at, last_seen = excluded.last_seen,
      subscribed = CASE WHEN excluded.subscribed = 1 THEN 1 ELSE mc_contacts.subscribed END,
      consent_at = CASE WHEN excluded.subscribed = 1 THEN excluded.consent_at ELSE mc_contacts.consent_at END,
      consent_source = CASE WHEN excluded.subscribed = 1 THEN excluded.consent_source ELSE mc_contacts.consent_source END,
      unsubscribed_at = CASE WHEN excluded.subscribed = 1 THEN NULL ELSE mc_contacts.unsubscribed_at END`)
    .bind(v.email, v.fullName, v.phone || null, v.organisation || null, v.employment || null, v.role || null, photoId || null, at, at, at, optIn ? 1 : 0, optIn ? at : null, optIn ? 'Accreditation form' : null).run();
}

const contactView = (c, applied) => ({ email: c.email, fullName: c.full_name, phone: c.phone, organisation: c.organisation, mediaType: c.media_type, employment: c.employment, role: c.role,
  notes: c.notes, subscribed: !!c.subscribed, source: c.source || SOURCES.interview, consentAt: c.consent_at, consentSource: c.consent_source, unsubscribedAt: c.unsubscribed_at,
  applications: c.applications_count || 0, lastAppliedAt: c.last_applied_at, lastContactedAt: c.last_contacted_at, photo: c.photo_id ? `/api/media-file/${c.photo_id}` : null, applied: applied || [] });

export async function listContacts(db) {
  await ensurePressSchema(db);
  const rows = (await db.prepare(`SELECT * FROM mc_contacts ORDER BY COALESCE(full_name, email) COLLATE NOCASE LIMIT 5000`).all()).results;
  const applied = new Map((await db.prepare(`SELECT email, GROUP_CONCAT(DISTINCT event_id) AS ev FROM mc_accreditations GROUP BY email`).all()).results.map(r => [r.email, String(r.ev || '').split(',').filter(Boolean)]));
  const evIds = [...new Set([...applied.values()].flat())];
  const matches = [];
  for (const id of evIds) { const e = await eventById(db, id); if (e) matches.push({ id: e.id, label: `${e.home_team} v ${e.away_team}`, date: e.event_date }); }
  matches.sort((a, b) => b.date.localeCompare(a.date));
  return { contacts: rows.map(c => contactView(c, applied.get(c.email))), matches };
}

function cleanContact(b) {
  return { email: oneLine(b.email, 254).toLowerCase(), fullName: oneLine(b.fullName, 80), phone: oneLine(b.phone, 24), organisation: oneLine(b.organisation, 120),
    mediaType: MEDIA_TYPES.includes(b.mediaType) ? b.mediaType : '', role: oneLine(b.role, 40), notes: oneLine(b.notes, 500) };
}
/** Staff add or edit a contact. Adding needs the person's agreement to receive club media emails. */
export async function saveStaffContact(db, user, b, request) {
  await ensurePressSchema(db);
  const v = cleanContact(b), at = nowIso();
  if (!EMAIL.test(v.email)) return { error: 'Enter a valid email address.' };
  if (v.fullName.length < 2) return { error: 'Enter the full name.' };
  const old = await db.prepare(`SELECT email, subscribed FROM mc_contacts WHERE email = ?`).bind(b.originalEmail ? String(b.originalEmail).toLowerCase() : v.email).first();
  if (!b.originalEmail) {
    if (old) return { error: 'This email is already on the press list.' };
    if (!(b.consent === true || b.consent === 'on')) return { error: 'Tick "This person agreed to receive club media emails".' };
    await db.prepare(`INSERT INTO mc_contacts (email, full_name, phone, organisation, media_type, role, notes, accreditations, interviews, history, first_seen, last_seen, source, subscribed, consent_at, consent_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, '[]', ?, ?, ?, 1, ?, ?)`).bind(v.email, v.fullName, v.phone || null, v.organisation || null, v.mediaType || null, v.role || null, v.notes || null, at, at, SOURCES.staff, at, `Added by ${user.fullName}`).run();
    await mcLog(db, mediaActor(user), 'press_contact_add', { section: 'presslist', itemType: 'contact', itemId: v.email, itemTitle: v.fullName, request });
    return { ok: true };
  }
  if (!old) return { error: 'That contact was not found.' };
  if (v.email !== old.email && await db.prepare(`SELECT 1 FROM mc_contacts WHERE email = ?`).bind(v.email).first()) return { error: 'Another contact already has this email.' };
  // Subscribe again only with the person's agreement; unsubscribe any time.
  let sub = old.subscribed;
  if (b.subscribed === false) sub = 0;
  if (b.subscribed === true && !old.subscribed) { if (!(b.consent === true || b.consent === 'on')) return { error: 'To subscribe this person again, tick that they agreed.' }; sub = 1; }
  await db.prepare(`UPDATE mc_contacts SET email = ?, full_name = ?, phone = ?, organisation = ?, media_type = ?, role = ?, notes = ?, subscribed = ?,
      consent_at = CASE WHEN ? = 1 AND subscribed = 0 THEN ? ELSE consent_at END, consent_source = CASE WHEN ? = 1 AND subscribed = 0 THEN ? ELSE consent_source END,
      unsubscribed_at = CASE WHEN ? = 0 AND subscribed = 1 THEN ? WHEN ? = 1 THEN NULL ELSE unsubscribed_at END WHERE email = ?`)
    .bind(v.email, v.fullName, v.phone || null, v.organisation || null, v.mediaType || null, v.role || null, v.notes || null, sub, sub, at, sub, `Confirmed by ${user.fullName}`, sub, at, sub, old.email).run();
  if (v.email !== old.email) await db.prepare(`UPDATE mc_press_recipients SET email = ? WHERE email = ?`).bind(v.email, old.email).run();
  await mcLog(db, mediaActor(user), 'press_contact_edit', { section: 'presslist', itemType: 'contact', itemId: v.email, itemTitle: v.fullName, details: sub ? 'subscribed' : 'not subscribed', request });
  return { ok: true };
}
export async function deleteContact(db, user, email, request) {
  await ensurePressSchema(db);
  const r = await db.prepare(`DELETE FROM mc_contacts WHERE email = ?`).bind(String(email || '').toLowerCase()).run();
  if (!r.meta?.changes) return { error: 'That contact was not found.' };
  await mcLog(db, mediaActor(user), 'press_contact_delete', { section: 'presslist', itemType: 'contact', itemId: email, itemTitle: email, request });
  return { ok: true };
}
/** CSV import (already parsed by the page): name, email, phone, organisation, media_type. */
export async function importContacts(db, user, rows, consent, request) {
  await ensurePressSchema(db);
  let added = 0, updated = 0, skipped = 0;
  const at = nowIso(), seen = new Set();
  for (const raw of (Array.isArray(rows) ? rows : []).slice(0, 2000)) {
    const v = cleanContact({ email: raw.email, fullName: raw.name, phone: raw.phone, organisation: raw.organisation, mediaType: MEDIA_TYPES.find(t => t.toLowerCase() === String(raw.media_type || '').trim().toLowerCase()) });
    if (!EMAIL.test(v.email) || seen.has(v.email)) { skipped++; continue; }
    seen.add(v.email);
    const old = await db.prepare(`SELECT email, unsubscribed_at FROM mc_contacts WHERE email = ?`).bind(v.email).first();
    if (old) {
      // Fill gaps only; someone who unsubscribed is never subscribed again by an import.
      await db.prepare(`UPDATE mc_contacts SET full_name = COALESCE(NULLIF(?, ''), full_name), phone = COALESCE(phone, NULLIF(?, '')), organisation = COALESCE(organisation, NULLIF(?, '')), media_type = COALESCE(media_type, NULLIF(?, '')),
          subscribed = CASE WHEN ? = 1 AND unsubscribed_at IS NULL THEN 1 ELSE subscribed END, consent_at = CASE WHEN ? = 1 AND unsubscribed_at IS NULL AND subscribed = 0 THEN ? ELSE consent_at END,
          consent_source = CASE WHEN ? = 1 AND unsubscribed_at IS NULL AND subscribed = 0 THEN ? ELSE consent_source END WHERE email = ?`)
        .bind(v.fullName, v.phone, v.organisation, v.mediaType, consent ? 1 : 0, consent ? 1 : 0, at, consent ? 1 : 0, `CSV import by ${user.fullName}`, v.email).run();
      updated++;
    } else {
      await db.prepare(`INSERT INTO mc_contacts (email, full_name, phone, organisation, media_type, accreditations, interviews, history, first_seen, last_seen, source, subscribed, consent_at, consent_source)
        VALUES (?, ?, ?, ?, ?, 0, 0, '[]', ?, ?, ?, ?, ?, ?)`).bind(v.email, v.fullName || v.email, v.phone || null, v.organisation || null, v.mediaType || null, at, at, SOURCES.import, consent ? 1 : 0, consent ? at : null, consent ? `CSV import by ${user.fullName}` : null).run();
      added++;
    }
  }
  await mcLog(db, mediaActor(user), 'press_import', { section: 'presslist', itemType: 'contact', itemTitle: 'CSV import', details: `${added} added, ${updated} updated, ${skipped} skipped${consent ? ' (agreed)' : ''}`, request });
  return { ok: true, added, updated, skipped };
}

// ── Unsubscribe (signed link, no login) ──
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(env, email) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${env.SESSION_SECRET || 'lobi'}|press-unsubscribe`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email.toLowerCase())))).slice(0, 32);
}
export async function unsubscribeUrl(env, email) {
  return `${SITE}/media/unsubscribe/?e=${b64url(new TextEncoder().encode(email.toLowerCase()))}&t=${await sign(env, email)}`;
}
export async function unsubscribe(env, e, t) {
  let email = '';
  try { email = new TextDecoder().decode(Uint8Array.from(atob(String(e || '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))).toLowerCase(); } catch { return { error: true }; }
  if (!EMAIL.test(email) || String(t || '') !== await sign(env, email)) return { error: true };
  await ensurePressSchema(env.DB);
  await env.DB.prepare(`UPDATE mc_contacts SET subscribed = 0, unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE email = ?`).bind(nowIso(), email).run();
  await mcLog(env.DB, { kind: 'public', id: null, name: email }, 'press_unsubscribe', { section: 'presslist', itemType: 'contact', itemId: email, itemTitle: email });
  return { ok: true };
}

// ── The email ──
const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'there';
const merge = (html, c) => html.replace(/\{first_name\}/g, esc(firstName(c.full_name))).replace(/\{full_name\}/g, esc(c.full_name || '')).replace(/\{organisation\}/g, esc(c.organisation || ''));
const mergeText = (t, c) => String(t).replace(/\{first_name\}/g, firstName(c.full_name)).replace(/\{full_name\}/g, c.full_name || '').replace(/\{organisation\}/g, c.organisation || '');
export async function matchLine(db, eventId) {
  const e = eventId ? await eventById(db, eventId) : null;
  if (!e) return null;
  const ms = await matchSettings(db, e);
  return { e, ms, text: `Lobi Stars FC vs ${ms.opponent}, ${ms.competition}${ms.matchday ? `, Matchday ${ms.matchday}` : ''}, ${matchDay(e.event_date)}, KO ${ms.kickoff}, ${ms.venue}`, link: `${SITE}/media/accreditation/?match=${encodeURIComponent(matchSlug(e))}` };
}
const button = (href, label) => `<p style="margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:#D62839;color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:8px">${esc(label)}</a></p>`;
/** The finished email for one person (msg: {type, subject, body, extra}). */
export function emailHtml(msg, c, unsubUrl) {
  return `<!doctype html><html><body style="margin:0;background:#EEF1F6;font-family:Arial,Helvetica,sans-serif;color:#15181D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F6"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0E2A55;padding:18px 22px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td><img src="${SITE}/images/lobi-stars-fc-transparent-256.png" width="56" height="56" alt="Lobi Stars FC" style="display:block"></td>
<td style="padding-left:14px;color:#fff"><div style="font-size:20px;font-weight:bold;letter-spacing:1px">LOBI STARS FC</div><div style="font-size:12px;letter-spacing:2px;color:#F5C11A">MEDIA DEPARTMENT</div></td></tr></table></td></tr>
<tr><td style="background:#F5C11A;height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:24px 24px 8px;font-size:16px;line-height:1.6">${msg.label ? `<p style="margin:0 0 10px;font-size:12px;font-weight:bold;letter-spacing:2px;color:#D62839;text-transform:uppercase">${esc(msg.label)}</p>` : ''}${merge(msg.body, c)}${msg.extra || ''}</td></tr>
<tr><td style="padding:16px 24px 22px;border-top:1px solid #E3E6EB;font-size:12px;line-height:1.6;color:#5B6472">Lobi Stars FC · Media Department · <a href="${SITE}/media/" style="color:#0E2A55">lobistarsfc.com/media</a><br>
You receive this because you are on the Lobi Stars FC press list or applied for media accreditation. <a href="${esc(unsubUrl)}" style="color:#0E2A55">Unsubscribe from the press list</a></td></tr>
</table></td></tr></table></body></html>`;
}

/** What a send will contain: the extra block (match link or release link) and the label. */
export async function messageParts(env, { type, eventId, pressItemId }) {
  const db = env.DB;
  if (type === 'matchday' || type === 'notice') {
    const m = await matchLine(db, eventId);
    if (!m) return type === 'matchday' ? { error: 'Choose an upcoming home match.' } : { error: 'Choose the match this notice is about.' };
    return { label: type === 'matchday' ? 'Matchday accreditation' : 'Accreditation notice', m,
      extra: type === 'matchday' ? `<p style="margin:16px 0 0;padding:12px 14px;background:#F4F7FD;border-left:4px solid #0E2A55;border-radius:6px"><b>${esc(m.text)}</b></p>${button(m.link, 'Apply for accreditation')}` : `<p style="margin:16px 0 0;font-size:14px;color:#5B6472">Match: ${esc(m.text)}</p>` };
  }
  if (type === 'statement') {
    const { publishedReleases } = await import('./mediaPress.js');
    const r = (await publishedReleases(db)).find(x => x.id === pressItemId);
    if (!r) return { error: 'Choose a published press release.' };
    const url = `${SITE}/media/press-releases/${r.slug}/`;
    return { label: r.statement ? 'Official statement' : 'Press release', release: r, extra: `${button(url, 'Read the release on lobistarsfc.com')}<p style="font-size:13px;color:#5B6472;margin:0">The branded PDF is attached.</p>` };
  }
  if (type === 'general') return { label: '', extra: '' };
  return { error: 'Choose the message type.' };
}

/**
 * Who will receive it. General sends (statement, matchday, general) only go to
 * subscribed people. An accreditation notice may also go to people who applied
 * for that match (it is about their own accreditation).
 */
export async function resolveRecipients(db, type, emails, eventId) {
  await ensurePressSchema(db);
  const want = [...new Set((Array.isArray(emails) ? emails : []).map(x => String(x).toLowerCase()))].slice(0, 3000);
  const ok = [], excluded = [];
  const appliedSet = type === 'notice' && eventId ? new Set((await db.prepare(`SELECT DISTINCT email FROM mc_accreditations WHERE event_id = ?`).bind(eventId).all()).results.map(r => r.email)) : new Set();
  for (let i = 0; i < want.length; i += 90) {
    const part = want.slice(i, i + 90);
    const rows = (await db.prepare(`SELECT email, full_name, organisation, subscribed FROM mc_contacts WHERE email IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results;
    for (const c of rows) {
      if (c.subscribed || appliedSet.has(c.email)) ok.push(c);
      else excluded.push({ email: c.email, fullName: c.full_name, why: type === 'notice' ? 'Not subscribed and did not apply for this match' : 'Not subscribed' });
    }
  }
  return { ok, excluded };
}

async function cleanBody(b) {
  const body = await sanitizeHtml(String(b.body || ''), { max: 40000 });
  return textOf(body).length < 3 ? '' : body;
}
/** Preview / test: the email as the first recipient would see it. */
export async function preview(env, b) {
  const parts = await messageParts(env, b); if (parts.error) return parts;
  const subject = oneLine(b.subject, 160), body = await cleanBody(b);
  const { ok, excluded } = await resolveRecipients(env.DB, b.type, b.emails, b.eventId);
  const sample = ok[0] || { email: 'sample@example.com', full_name: 'Sample Journalist', organisation: 'Media House' };
  return { ok: true, subject: mergeText(subject, sample), html: emailHtml({ body: body || '<p>(Your message)</p>', extra: parts.extra, label: parts.label }, sample, `${SITE}/media/unsubscribe/`), recipients: ok.length, excluded, attachPdf: !!parts.release };
}
async function releaseAttachment(env, release) {
  const { releasePdf } = await import('./mediaPress.js');
  const settings = await mcSettings(env.DB);
  const pdf = await releasePdf(env, release, { publishedAt: release.publishedAt, contact: release.contact || settings.press_contact }).catch(() => null);
  if (!pdf) return null;
  let x = ''; for (let i = 0; i < pdf.length; i += 0x8000) x += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
  return { filename: `${release.slug}.pdf`, content: btoa(x) };
}
async function fileAttachment(env, a) {
  const row = await fileRow(env.DB, a.id); const bytes = row && await fileBytes(env, row);
  if (!bytes) return null;
  const u8 = new Uint8Array(bytes); let x = ''; for (let i = 0; i < u8.length; i += 0x8000) x += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { filename: a.name || `attachment.${row.mime === 'application/pdf' ? 'pdf' : 'jpg'}`, content: btoa(x) };
}
async function deliver(env, { to, c, subject, html, attachments }) {
  const unsub = await unsubscribeUrl(env, to);
  const finalHtml = html.replace('__UNSUB__', esc(unsub));
  if (!env.RESEND_API_KEY) { if (String(env.FANS_DEV_LINKS) === '1') return true; throw new Error('The email service is not set up.'); }
  await sendEmail(env, { to, from: MEDIA_FROM, replyTo: 'media@lobistarsfc.com', subject, html: finalHtml, text: textOf(finalHtml.replace(/<br>/g, '\n')).slice(0, 20000),
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, attachments: attachments?.length ? attachments : undefined });
  void c;
  return true;
}
/** "Send test to me". */
export async function sendTest(env, user, b, request) {
  const to = oneLine(b.testTo, 254).toLowerCase();
  if (!EMAIL.test(to)) return { error: 'Enter your email address for the test.' };
  const parts = await messageParts(env, b); if (parts.error) return parts;
  const body = await cleanBody(b); if (!body) return { error: 'Write the message first.' };
  const subject = oneLine(b.subject, 160); if (!subject) return { error: 'Write the subject.' };
  const sample = { email: to, full_name: user.fullName, organisation: 'Lobi Stars FC' };
  const attachments = [];
  if (parts.release) { const a = await releaseAttachment(env, parts.release); if (a) attachments.push(a); }
  for (const a of (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 1)) { const f = await fileAttachment(env, a); if (f) attachments.push(f); }
  try { await deliver(env, { to, c: sample, subject: `[TEST] ${mergeText(subject, sample)}`, html: emailHtml({ body, extra: parts.extra, label: parts.label }, sample, '__UNSUB__'), attachments }); }
  catch (err) { return { error: String(err.message || err).slice(0, 200) }; }
  await mcLog(env.DB, mediaActor(user), 'press_test', { section: 'presslist', itemType: 'message', itemTitle: subject, details: `Test to ${to}`, request });
  return { ok: true };
}
/** Creates the send (one row per person, queued). The page then calls sendBatch until done. */
export async function createSend(env, user, b, request) {
  const db = env.DB;
  await ensurePressSchema(db);
  const parts = await messageParts(env, b); if (parts.error) return parts;
  const subject = oneLine(b.subject, 160); if (!subject) return { error: 'Write the subject.' };
  const body = await cleanBody(b); if (!body) return { error: 'Write the message.' };
  const { ok } = await resolveRecipients(db, b.type, b.emails, b.eventId);
  if (!ok.length) return { error: 'Nobody to send to (people who are not subscribed are left out).' };
  const atts = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 1).filter(a => /^[a-z0-9_]{4,40}$/.test(a?.id || '')).map(a => ({ id: a.id, name: oneLine(a.name, 120) }));
  const id = newId('pm'), at = nowIso();
  await db.prepare(`INSERT INTO mc_press_messages (id, sent_by_id, sent_by_name, type, subject, body, attachments, press_item_id, event_id, recipients_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.id, user.fullName, b.type, subject, body, JSON.stringify(atts), parts.release?.id || null, parts.m?.e.id || null, ok.length, at).run();
  for (let i = 0; i < ok.length; i += 25) {
    const part = ok.slice(i, i + 25);
    await db.batch(part.map(c => db.prepare(`INSERT INTO mc_press_recipients (message_id, email, full_name, organisation) VALUES (?, ?, ?, ?)`).bind(id, c.email, c.full_name, c.organisation)));
  }
  await mcLog(db, mediaActor(user), 'press_send', { section: 'presslist', itemType: 'message', itemId: id, itemTitle: subject, details: `${TYPES[b.type]} to ${ok.length}`, request });
  return { ok: true, id, recipients: ok.length };
}
/** Sends the next few queued emails of a send (one email per person). */
export async function sendBatch(env, id) {
  const db = env.DB;
  await ensurePressSchema(db);
  const msg = await db.prepare(`SELECT * FROM mc_press_messages WHERE id = ?`).bind(id).first();
  if (!msg) return { error: 'That message was not found.' };
  // Rows stuck in "sending" for 10 minutes (a closed page) go back to the queue.
  await db.prepare(`UPDATE mc_press_recipients SET status = 'queued' WHERE message_id = ? AND status = 'sending' AND sent_at < ?`).bind(id, new Date(Date.now() - 600e3).toISOString()).run();
  const rows = (await db.prepare(`SELECT * FROM mc_press_recipients WHERE message_id = ? AND status = 'queued' ORDER BY id LIMIT ?`).bind(id, BATCH).all()).results;
  if (rows.length) {
    const parts = await messageParts(env, { type: msg.type, eventId: msg.event_id, pressItemId: msg.press_item_id });
    const attachments = [];
    if (parts.release) { const a = await releaseAttachment(env, parts.release); if (a) attachments.push(a); }
    for (const a of parseJson(msg.attachments, [])) { const f = await fileAttachment(env, a); if (f) attachments.push(f); }
    for (const r of rows) {
      const claim = await db.prepare(`UPDATE mc_press_recipients SET status = 'sending', sent_at = ? WHERE id = ? AND status = 'queued'`).bind(nowIso(), r.id).run();
      if (!claim.meta?.changes) continue;
      const c = { email: r.email, full_name: r.full_name, organisation: r.organisation };
      try {
        await deliver(env, { to: r.email, c, subject: mergeText(msg.subject, c), html: emailHtml({ body: msg.body, extra: parts.extra || '', label: parts.label || '' }, c, '__UNSUB__'), attachments });
        const at = nowIso();
        await db.batch([db.prepare(`UPDATE mc_press_recipients SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?`).bind(at, r.id), db.prepare(`UPDATE mc_contacts SET last_contacted_at = ? WHERE email = ?`).bind(at, r.email)]);
      } catch (err) {
        await db.prepare(`UPDATE mc_press_recipients SET status = 'failed', error = ?, sent_at = ? WHERE id = ?`).bind(String(err.message || err).slice(0, 300), nowIso(), r.id).run();
      }
    }
  }
  const n = (await db.prepare(`SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status IN ('queued', 'sending')) AS left FROM mc_press_recipients WHERE message_id = ?`).bind(id).first()) || {};
  await db.prepare(`UPDATE mc_press_messages SET sent_count = ?, failed_count = ?, finished_at = CASE WHEN ? = 0 THEN COALESCE(finished_at, ?) ELSE NULL END WHERE id = ?`).bind(n.sent || 0, n.failed || 0, n.left || 0, nowIso(), id).run();
  return { ok: true, sent: n.sent || 0, failed: n.failed || 0, remaining: n.left || 0, total: msg.recipients_count };
}
/** Sends everything at once (used when a press release is published). */
export async function sendAll(env, id) {
  for (let i = 0; i < 100; i++) { const r = await sendBatch(env, id); if (r.error || !r.remaining) return r; }
  return { ok: true };
}

export async function listMessages(db) {
  await ensurePressSchema(db);
  return (await db.prepare(`SELECT id, sent_by_name, type, subject, recipients_count, sent_count, failed_count, created_at, finished_at FROM mc_press_messages ORDER BY created_at DESC LIMIT 300`).all()).results
    .map(m => ({ id: m.id, sentBy: m.sent_by_name, type: m.type, typeLabel: TYPES[m.type] || m.type, subject: m.subject, recipients: m.recipients_count, sent: m.sent_count, failed: m.failed_count, createdAt: m.created_at, finished: !!m.finished_at }));
}
export async function messageDetail(env, id) {
  const db = env.DB;
  await ensurePressSchema(db);
  const m = await db.prepare(`SELECT * FROM mc_press_messages WHERE id = ?`).bind(id).first();
  if (!m) return null;
  const parts = await messageParts(env, { type: m.type, eventId: m.event_id, pressItemId: m.press_item_id });
  const recipients = (await db.prepare(`SELECT email, full_name, organisation, status, error, sent_at FROM mc_press_recipients WHERE message_id = ? ORDER BY id`).bind(id).all()).results
    .map(r => ({ email: r.email, fullName: r.full_name, organisation: r.organisation, status: r.status, error: r.error, sentAt: r.sent_at }));
  return { id: m.id, sentBy: m.sent_by_name, type: m.type, typeLabel: TYPES[m.type] || m.type, subject: m.subject, createdAt: m.created_at, finished: !!m.finished_at,
    recipients: m.recipients_count, sent: m.sent_count, failed: m.failed_count, attachments: parseJson(m.attachments, []).map(a => ({ name: a.name, url: `/api/media-file/${a.id}` })),
    html: emailHtml({ body: m.body, extra: parts.extra || '', label: parts.label || '' }, { full_name: '{full_name}', organisation: '{organisation}' }, `${SITE}/media/unsubscribe/`), list: recipients };
}

/** A press release published for the first time: emailed to everyone subscribed (recorded under Sent messages). */
export async function sendReleaseToList(env, { releaseId, subject, body, url, label, attachment }) {
  const db = env.DB;
  await ensurePressSchema(db);
  const list = (await db.prepare(`SELECT email, full_name, organisation FROM mc_contacts WHERE subscribed = 1 ORDER BY email LIMIT 2000`).all()).results;
  if (!list.length) return { sent: 0 };
  const id = newId('pm'), at = nowIso();
  await db.prepare(`INSERT INTO mc_press_messages (id, sent_by_id, sent_by_name, type, subject, body, attachments, press_item_id, recipients_count, created_at) VALUES (?, 'system', 'Automatic (press release published)', 'statement', ?, ?, '[]', ?, ?, ?)`)
    .bind(id, subject, body, releaseId, list.length, at).run();
  for (let i = 0; i < list.length; i += 25) await db.batch(list.slice(i, i + 25).map(c => db.prepare(`INSERT INTO mc_press_recipients (message_id, email, full_name, organisation) VALUES (?, ?, ?, ?)`).bind(id, c.email, c.full_name, c.organisation)));
  const extra = `${button(url, 'Read the release on lobistarsfc.com')}${attachment ? '<p style="font-size:13px;color:#5B6472;margin:0">The branded PDF is attached.</p>' : ''}`;
  let sent = 0;
  for (const c of list) {
    try {
      await deliver(env, { to: c.email, c, subject, html: emailHtml({ body, extra, label }, c, '__UNSUB__'), attachments: attachment ? [attachment] : [] });
      sent++;
      await db.batch([db.prepare(`UPDATE mc_press_recipients SET status = 'sent', sent_at = ? WHERE message_id = ? AND email = ?`).bind(nowIso(), id, c.email), db.prepare(`UPDATE mc_contacts SET last_contacted_at = ? WHERE email = ?`).bind(nowIso(), c.email)]);
    } catch (err) {
      await db.prepare(`UPDATE mc_press_recipients SET status = 'failed', error = ?, sent_at = ? WHERE message_id = ? AND email = ?`).bind(String(err.message || err).slice(0, 300), nowIso(), id, c.email).run();
    }
  }
  await db.prepare(`UPDATE mc_press_messages SET sent_count = ?, failed_count = ?, finished_at = ? WHERE id = ?`).bind(sent, list.length - sent, nowIso(), id).run();
  return { sent };
}
