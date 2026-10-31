// Media Centre › Accreditation. Journalists apply on the public form
// (/media/accreditation/) for ONE upcoming Lobi Stars HOME match; applications
// close 48 hours before kick-off (a Super Admin setting). Any Media Centre user
// decides (the one exception to Super Admin approval): approve (with the access
// zone), reject with a reason, or ask for more information. The per-match limit
// is enforced. Approval makes an ID-card-sized PDF card with a QR code that
// opens the public verification page (VALID / REVOKED / EXPIRED; never the
// phone or email). The applicant gets an email at every step. Super Admins can
// revoke any accreditation in the admin. Approved journalists are saved to the
// media contacts list; returning applicants are recognised by email.
import qrcodeGenerator from 'qrcode-generator';
import { PdfDoc, pdfSafe, wrap } from './pdfLite.js';
import { sendEmail } from './email.js';
import { ensureMediaSchema, mcSettings, mcLog, newId, randomToken, oneLine, clean, parseJson } from './mediaCentre.js';
import { fileRow, fileBytes } from './mediaFiles.js';
import { matchSlug } from './matchSlug.js';
import { isHomeGame } from './matchCentre.js';

export const ROLES = ['Writer', 'Photographer', 'TV Camera', 'Radio Commentator', 'Digital/Social Media'];
export const ZONES = ['Press Box', 'Pitchside', 'Mixed Zone'];
export const SITE = 'https://lobistarsfc.com';
const STADIUM = 'McCarthy Stadium, Makurdi';
const nowIso = () => new Date().toISOString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lagos = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', ...opts });
export const matchDay = iso => lagos(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const kickOff = iso => lagos(iso, { hour: '2-digit', minute: '2-digit' });

let ready = false;
export async function ensureAccreditationSchema(db) {
  if (ready) return;
  await ensureMediaSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_accreditations (
      id TEXT PRIMARY KEY,
      number TEXT UNIQUE,                    -- e.g. LSA-2627-0007 (on approval)
      verify_token TEXT UNIQUE,              -- in the QR code: /media/accreditation/verify/<token>
      update_token TEXT UNIQUE,              -- emailed link when more information is needed
      event_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending / info / approved / rejected / revoked
      full_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL, organisation TEXT NOT NULL,
      employment TEXT NOT NULL,              -- staff / freelance
      role TEXT NOT NULL, press_doc_id TEXT, photo_id TEXT, equipment TEXT, needs TEXT,
      agreed_at TEXT NOT NULL, zone TEXT, info_request TEXT, reason TEXT,
      decided_by_id TEXT, decided_by_name TEXT, decided_at TEXT,
      revoked_by TEXT, revoked_at TEXT, revoke_reason TEXT,
      invite_token TEXT, ip TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mc_accreditations_event ON mc_accreditations (event_id, status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS mc_accreditations_email ON mc_accreditations (email)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_contacts (
      email TEXT PRIMARY KEY, full_name TEXT, phone TEXT, organisation TEXT, employment TEXT, role TEXT, photo_id TEXT,
      accreditations INTEGER NOT NULL DEFAULT 0, interviews INTEGER NOT NULL DEFAULT 0, history TEXT,
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mc_invites (token TEXT PRIMARY KEY, event_id TEXT NOT NULL, created_by TEXT, created_by_name TEXT, sent_to TEXT, created_at TEXT NOT NULL)`),
  ]);
  ready = true;
}

// ── Matches open for accreditation ──
export async function eventById(db, idOrSlug) {
  if (!idOrSlug) return null;
  const s = String(idOrSlug).toLowerCase();
  const direct = await db.prepare(`SELECT * FROM events WHERE id = ?`).bind(String(idOrSlug)).first().catch(() => null);
  if (direct) return direct;
  const { results } = await db.prepare(`SELECT * FROM events WHERE active = 1 AND event_date >= ?`).bind(new Date(Date.now() - 86400e3).toISOString()).all();
  return results.find(e => matchSlug(e) === s) || null;
}
export function closesAt(event, settings) { return new Date(Date.parse(event.event_date) - Number(settings.accreditation_close_hours || 48) * 3600e3).toISOString(); }
export const matchLabel = e => `${e.home_team} v ${e.away_team}`;
/** Upcoming Lobi Stars HOME matches, with whether applications are still open. */
export async function openMatches(db, settings) {
  const { results } = await db.prepare(`SELECT * FROM events WHERE active = 1 AND event_date > ? ORDER BY event_date LIMIT 40`).bind(nowIso()).all();
  return results.filter(e => isHomeGame(e) && !/postponed|cancel/i.test(e.status || '')).map(e => ({
    id: e.id, slug: matchSlug(e), label: matchLabel(e), date: e.event_date, day: matchDay(e.event_date), kickOff: kickOff(e.event_date),
    competition: e.competition || 'Nigeria National League', closesAt: closesAt(e, settings), open: Date.now() < Date.parse(closesAt(e, settings)),
  }));
}

// ── Emails ──
function emailHtml(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;color:#16181D"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 10px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
  <tr><td style="background:#4C76B2;padding:18px 24px;border-bottom:4px solid #EE343C"><img src="${SITE}/images/lobi-stars-badge.png" width="48" height="48" alt="Lobi Stars FC" style="vertical-align:middle;border:0"> <b style="color:#fff;font-size:18px;vertical-align:middle;margin-left:8px">LOBI STARS FC · MEDIA</b></td></tr>
  <tr><td style="padding:24px"><h1 style="margin:0 0 14px;font-size:22px">${esc(title)}</h1>${body}<p style="margin:22px 0 0;font-size:13px;color:#4A505C">Lobi Stars FC Media Department · ${STADIUM}</p></td></tr></table></td></tr></table></body></html>`;
}
const p = t => `<p style="margin:0 0 12px;font-size:16px;line-height:1.5">${t}</p>`;
async function mail(env, to, subject, title, body, attachments) {
  if (!env.RESEND_API_KEY) { console.log('[accreditation] email skipped (no RESEND_API_KEY):', subject); return false; }
  try { await sendEmail(env, { to, subject, html: emailHtml(title, body), text: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), attachments, replyTo: 'media@lobistarsfc.com' }); return true; }
  catch (e) { console.error('[accreditation] email failed', e); return false; }
}

// ── Public: apply ──
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
export function checkApplication(b) {
  const v = {
    eventId: oneLine(b.eventId, 80), fullName: oneLine(b.fullName, 80), phone: oneLine(b.phone, 24), email: oneLine(b.email, 254).toLowerCase(),
    organisation: oneLine(b.organisation, 120), employment: b.employment === 'freelance' ? 'freelance' : b.employment === 'staff' ? 'staff' : '',
    role: ROLES.includes(b.role) ? b.role : '', equipment: clean(b.equipment, 500), needs: clean(b.needs, 500), agree: b.agree === true || b.agree === 'on' || b.agree === '1' || b.agree === 'true',
  };
  if (!v.eventId) return { error: 'Choose the match.' };
  if (v.fullName.length < 3) return { error: 'Enter your full name.' };
  if (!PHONE.test(v.phone)) return { error: 'Enter a phone number.' };
  if (!EMAIL.test(v.email)) return { error: 'Enter a valid email address.' };
  if (v.organisation.length < 2) return { error: 'Enter your media organisation (or "Freelance").' };
  if (!v.employment) return { error: 'Say whether you are staff or freelance.' };
  if (!v.role) return { error: 'Choose your role.' };
  if (!v.agree) return { error: 'Please agree to the club\'s media rules.' };
  return { value: v };
}
/** Returning applicant (recognised by email): business details only, never the phone. */
export async function prefill(db, email) {
  await ensureAccreditationSchema(db);
  const c = await db.prepare(`SELECT full_name, organisation, employment, role, photo_id FROM mc_contacts WHERE email = ?`).bind(String(email || '').trim().toLowerCase()).first();
  return c ? { known: true, fullName: c.full_name, organisation: c.organisation, employment: c.employment, role: c.role, hasPhoto: !!c.photo_id } : { known: false };
}
export async function apply(env, request, v, { pressDocId, photoId, inviteToken = null }) {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  const settings = await mcSettings(db);
  const e = await eventById(db, v.eventId);
  if (!e || !isHomeGame(e) || Date.parse(e.event_date) < Date.now()) return { error: 'Accreditation is only for upcoming Lobi Stars home matches.' };
  if (Date.now() >= Date.parse(closesAt(e, settings))) return { error: `Applications for this match closed ${settings.accreditation_close_hours} hours before kick-off.` };
  const dup = await db.prepare(`SELECT id, status FROM mc_accreditations WHERE event_id = ? AND email = ? AND status IN ('pending', 'info', 'approved')`).bind(e.id, v.email).first();
  if (dup) return { error: dup.status === 'approved' ? 'You are already accredited for this match.' : 'You have already applied for this match. We will email you.' };
  // A returning journalist may reuse the passport photo on file.
  let photo = photoId;
  if (!photo) photo = (await db.prepare(`SELECT photo_id FROM mc_contacts WHERE email = ?`).bind(v.email).first())?.photo_id || null;
  if (!photo) return { error: 'Add a passport photo.' };
  if (!pressDocId) return { error: 'Add your press ID or a letter from your organisation.' };
  const id = newId('acc'), at = nowIso();
  await db.prepare(`INSERT INTO mc_accreditations (id, event_id, status, full_name, phone, email, organisation, employment, role, press_doc_id, photo_id, equipment, needs, agreed_at, invite_token, ip, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, e.id, v.fullName, v.phone, v.email, v.organisation, v.employment, v.role, pressDocId, photo, v.equipment || null, v.needs || null, at, inviteToken, request.headers.get('CF-Connecting-IP') || null, at, at).run();
  await mcLog(db, { kind: 'public', id: null, name: `${v.fullName} (${v.organisation})` }, 'accreditation_request', { section: 'accreditation', itemType: 'accreditation', itemId: id, itemTitle: `${v.fullName} · ${matchLabel(e)}`, details: v.role, request });
  await mail(env, v.email, `Accreditation request received: ${matchLabel(e)}`, 'We have your accreditation request',
    `${p(`Dear ${esc(v.fullName)},`)}${p(`Thank you for applying for media accreditation for <b>${esc(matchLabel(e))}</b> on ${esc(matchDay(e.event_date))} (kick-off ${esc(kickOff(e.event_date))}, ${STADIUM}).`)}${p('Our media team will review it and email you. Please do not come to the stadium expecting accreditation until you receive your card.')}`);
  return { ok: true, id };
}

// ── Media Centre: decisions ──
export async function listFor(db, eventId) {
  await ensureAccreditationSchema(db);
  const rows = (await db.prepare(`SELECT * FROM mc_accreditations ${eventId ? 'WHERE event_id = ?' : ''} ORDER BY created_at DESC LIMIT 300`).bind(...(eventId ? [eventId] : [])).all()).results;
  return rows.map(view);
}
export function view(r) {
  return r && { id: r.id, number: r.number, status: r.status, eventId: r.event_id, fullName: r.full_name, phone: r.phone, email: r.email, organisation: r.organisation, employment: r.employment, role: r.role,
    photo: r.photo_id ? `/api/media-file/${r.photo_id}` : null, pressDoc: r.press_doc_id ? `/api/media-file/${r.press_doc_id}` : null, equipment: r.equipment, needs: r.needs, zone: r.zone,
    infoRequest: r.info_request, reason: r.reason, decidedBy: r.decided_by_name, decidedAt: r.decided_at, revokedAt: r.revoked_at, revokedBy: r.revoked_by, revokeReason: r.revoke_reason,
    createdAt: r.created_at, updatedAt: r.updated_at, verifyUrl: r.verify_token ? `${SITE}/media/accreditation/verify/${r.verify_token}/` : null };
}
async function nextNumber(db, event) {
  const y = new Date(event.event_date), season = y.getUTCMonth() >= 7 ? `${String(y.getUTCFullYear()).slice(2)}${String(y.getUTCFullYear() + 1).slice(2)}` : `${String(y.getUTCFullYear() - 1).slice(2)}${String(y.getUTCFullYear()).slice(2)}`;
  const n = ((await db.prepare(`SELECT COUNT(*) AS n FROM mc_accreditations WHERE number LIKE ?`).bind(`LSA-${season}-%`).first())?.n || 0) + 1;
  return `LSA-${season}-${String(n).padStart(4, '0')}`;
}
/** decision: approve (zone) | reject (reason) | info (message). user: the Media Centre user deciding. */
export async function decideAccreditation(env, request, user, id, { decision, zone, reason, message }) {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  const r = await db.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(id).first();
  if (!r) return { error: 'Not found.', status: 404 };
  const e = await eventById(db, r.event_id);
  if (!e) return { error: 'The match no longer exists.' };
  const A = { kind: 'media', id: user.id, name: `${user.fullName} (${user.loginId})` }, at = nowIso();
  const meta = { section: 'accreditation', itemType: 'accreditation', itemId: r.id, itemTitle: `${r.full_name} · ${matchLabel(e)}`, request };
  if (!['pending', 'info'].includes(r.status)) return { error: 'This request has already been decided.' };
  if (decision === 'approve') {
    if (!ZONES.includes(zone)) return { error: 'Choose the access zone.' };
    if (Date.parse(e.event_date) < Date.now()) return { error: 'This match has already been played.' };
    const settings = await mcSettings(db), max = Number(settings.accreditation_max) || 20;
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM mc_accreditations WHERE event_id = ? AND status = 'approved'`).bind(r.event_id).first())?.n || 0;
    if (n >= max) return { error: `This match already has ${n} accredited journalists (the limit is ${max}; a Super Admin can change it).` };
    const number = await nextNumber(db, e), token = randomToken(18);
    await db.prepare(`UPDATE mc_accreditations SET status = 'approved', number = ?, verify_token = ?, zone = ?, decided_by_id = ?, decided_by_name = ?, decided_at = ?, updated_at = ?, update_token = NULL WHERE id = ?`)
      .bind(number, token, zone, user.id, user.fullName, at, at, r.id).run();
    const fresh = await db.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(r.id).first();
    await saveContact(db, fresh, 'accreditations', `Accredited for ${matchLabel(e)} (${number})`);
    await mcLog(db, A, 'approve', { ...meta, details: `${number}, ${zone}` });
    const pdf = await cardPdf(env, fresh, e).catch(err => { console.error('[accreditation] card', err); return null; });
    const sent = await mail(env, r.email, `Your media accreditation: ${matchLabel(e)}`, 'You are accredited',
      `${p(`Dear ${esc(r.full_name)},`)}${p(`Your media accreditation for <b>${esc(matchLabel(e))}</b> on ${esc(matchDay(e.event_date))} (kick-off ${esc(kickOff(e.event_date))}, ${STADIUM}) is approved.`)}${p(`Accreditation number: <b>${esc(number)}</b> · Access: <b>${esc(zone)}</b>`)}${p('Your card is attached as a PDF. Print it (ID-card size) or show it on your phone with a photo ID. It is valid for this match only.')}${p(`Check it at any time: <a href="${SITE}/media/accreditation/verify/${token}/">${SITE}/media/accreditation/verify/…</a>`)}`,
      pdf ? [{ filename: `Lobi-Stars-accreditation-${number}.pdf`, content: b64(pdf) }] : undefined);
    return { ok: true, number, emailed: sent };
  }
  if (decision === 'reject') {
    const why = oneLine(reason, 500);
    if (why.length < 3) return { error: 'Give a reason (it is emailed to the applicant).' };
    await db.prepare(`UPDATE mc_accreditations SET status = 'rejected', reason = ?, decided_by_id = ?, decided_by_name = ?, decided_at = ?, updated_at = ?, update_token = NULL WHERE id = ?`).bind(why, user.id, user.fullName, at, at, r.id).run();
    await mcLog(db, A, 'reject', { ...meta, details: why });
    const sent = await mail(env, r.email, `Accreditation request: ${matchLabel(e)}`, 'About your accreditation request',
      `${p(`Dear ${esc(r.full_name)},`)}${p(`We are sorry: we cannot accredit you for <b>${esc(matchLabel(e))}</b>.`)}${p(`Reason: ${esc(why)}`)}${p('You are welcome to apply for future home matches.')}`);
    return { ok: true, emailed: sent };
  }
  if (decision === 'info') {
    const msg = oneLine(message, 800);
    if (msg.length < 3) return { error: 'Write what you need from the applicant.' };
    const token = randomToken(18);
    await db.prepare(`UPDATE mc_accreditations SET status = 'info', info_request = ?, update_token = ?, decided_by_id = ?, decided_by_name = ?, decided_at = ?, updated_at = ? WHERE id = ?`).bind(msg, token, user.id, user.fullName, at, at, r.id).run();
    await mcLog(db, A, 'request_info', { ...meta, details: msg });
    const link = `${SITE}/media/accreditation/?update=${token}`;
    const sent = await mail(env, r.email, `More information needed: accreditation for ${matchLabel(e)}`, 'We need a little more information',
      `${p(`Dear ${esc(r.full_name)},`)}${p(`About your accreditation request for <b>${esc(matchLabel(e))}</b>, our media team asks:`)}<p style="margin:0 0 12px;padding:10px 12px;border-left:4px solid #EE343C;background:#FFF6F6">${esc(msg)}</p>${p(`Please update your request here: <a href="${link}">${link}</a>`)}`);
    return { ok: true, emailed: sent, link };
  }
  return { error: 'Unknown decision.' };
}
/** The applicant answers a request for more information (the emailed link). */
export async function updateApplication(env, request, token, v, { pressDocId, photoId }) {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  const r = await db.prepare(`SELECT * FROM mc_accreditations WHERE update_token = ? AND status = 'info'`).bind(String(token || '')).first();
  if (!r) return { error: 'This link has already been used or is no longer valid.', status: 404 };
  const e = await eventById(db, r.event_id);
  const at = nowIso();
  await db.prepare(`UPDATE mc_accreditations SET status = 'pending', full_name = ?, phone = ?, organisation = ?, employment = ?, role = ?, equipment = ?, needs = ?, press_doc_id = COALESCE(?, press_doc_id), photo_id = COALESCE(?, photo_id), update_token = NULL, updated_at = ? WHERE id = ?`)
    .bind(v.fullName, v.phone, v.organisation, v.employment, v.role, v.equipment || null, v.needs || null, pressDocId || null, photoId || null, at, r.id).run();
  await mcLog(db, { kind: 'public', id: null, name: `${v.fullName} (${v.organisation})` }, 'accreditation_update', { section: 'accreditation', itemType: 'accreditation', itemId: r.id, itemTitle: `${v.fullName} · ${e ? matchLabel(e) : r.event_id}`, request });
  return { ok: true };
}
export async function publicByUpdateToken(db, token) {
  await ensureAccreditationSchema(db);
  const r = await db.prepare(`SELECT * FROM mc_accreditations WHERE update_token = ? AND status = 'info'`).bind(String(token || '')).first();
  if (!r) return null;
  return { eventId: r.event_id, fullName: r.full_name, phone: r.phone, email: r.email, organisation: r.organisation, employment: r.employment, role: r.role, equipment: r.equipment, needs: r.needs, infoRequest: r.info_request };
}
/** Super Admins: revoke an approved accreditation. */
export async function revoke(env, request, admin, id, reason) {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  const r = await db.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(id).first();
  if (!r || r.status !== 'approved') return { error: 'Only approved accreditations can be revoked.' };
  const why = oneLine(reason, 300) || 'Revoked by the club';
  const at = nowIso();
  await db.prepare(`UPDATE mc_accreditations SET status = 'revoked', revoked_by = ?, revoked_at = ?, revoke_reason = ?, updated_at = ? WHERE id = ?`).bind(admin.name || admin.email, at, why, at, id).run();
  const e = await eventById(db, r.event_id);
  await mcLog(db, { kind: 'admin', id: admin.id || admin.email, name: `${admin.name || admin.email} (admin)` }, 'revoke', { section: 'accreditation', itemType: 'accreditation', itemId: id, itemTitle: `${r.full_name} · ${e ? matchLabel(e) : ''}`, details: why, request });
  await mail(env, r.email, `Accreditation withdrawn: ${e ? matchLabel(e) : 'Lobi Stars FC'}`, 'Your accreditation has been withdrawn',
    `${p(`Dear ${esc(r.full_name)},`)}${p(`Your media accreditation ${esc(r.number)} ${e ? `for <b>${esc(matchLabel(e))}</b>` : ''} has been withdrawn by the club.`)}${p(`Reason: ${esc(why)}`)}`);
  return { ok: true };
}

// ── Media contacts ──
export async function saveContact(db, r, counter = null, note = '') {
  await ensureAccreditationSchema(db);
  const at = nowIso(), old = await db.prepare(`SELECT history FROM mc_contacts WHERE email = ?`).bind(r.email).first();
  const history = [...parseJson(old?.history, []), { at, note }].slice(-40);
  await db.prepare(`INSERT INTO mc_contacts (email, full_name, phone, organisation, employment, role, photo_id, accreditations, interviews, history, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET full_name = excluded.full_name, phone = COALESCE(excluded.phone, mc_contacts.phone), organisation = COALESCE(excluded.organisation, mc_contacts.organisation),
      employment = COALESCE(excluded.employment, mc_contacts.employment), role = COALESCE(excluded.role, mc_contacts.role), photo_id = COALESCE(excluded.photo_id, mc_contacts.photo_id),
      accreditations = mc_contacts.accreditations + ?, interviews = mc_contacts.interviews + ?, history = excluded.history, last_seen = excluded.last_seen`)
    .bind(r.email, r.full_name, r.phone || null, r.organisation || null, r.employment || null, r.role || null, r.photo_id || null, counter === 'accreditations' ? 1 : 0, counter === 'interviews' ? 1 : 0, JSON.stringify(history), at, at,
      counter === 'accreditations' ? 1 : 0, counter === 'interviews' ? 1 : 0).run();
}
export async function contacts(db) {
  await ensureAccreditationSchema(db);
  return (await db.prepare(`SELECT * FROM mc_contacts ORDER BY last_seen DESC LIMIT 500`).all()).results.map(c => ({ email: c.email, fullName: c.full_name, phone: c.phone, organisation: c.organisation, employment: c.employment, role: c.role,
    photo: c.photo_id ? `/api/media-file/${c.photo_id}` : null, accreditations: c.accreditations, interviews: c.interviews, history: parseJson(c.history, []), firstSeen: c.first_seen, lastSeen: c.last_seen }));
}

// ── Invitation links (prefill the match) ──
export async function createInvite(env, request, user, eventId, email = '') {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  const e = await eventById(db, eventId);
  if (!e || !isHomeGame(e)) return { error: 'Choose an upcoming home match.' };
  const token = randomToken(12), at = nowIso(), to = oneLine(email, 254).toLowerCase();
  if (to && !EMAIL.test(to)) return { error: 'Enter a valid email address.' };
  await db.prepare(`INSERT INTO mc_invites (token, event_id, created_by, created_by_name, sent_to, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(token, e.id, user.id, user.fullName, to || null, at).run();
  const link = `${SITE}/media/accreditation/?match=${encodeURIComponent(matchSlug(e))}&invite=${token}`;
  let emailed = false;
  if (to) emailed = await mail(env, to, `Invitation: media accreditation for ${matchLabel(e)}`, 'You are invited to apply for accreditation',
    `${p(`Lobi Stars FC invites you to apply for media accreditation for <b>${esc(matchLabel(e))}</b> on ${esc(matchDay(e.event_date))} (kick-off ${esc(kickOff(e.event_date))}, ${STADIUM}).`)}${p(`Apply here: <a href="${link}">${link}</a>`)}`);
  await mcLog(db, { kind: 'media', id: user.id, name: `${user.fullName} (${user.loginId})` }, 'invite', { section: 'accreditation', itemType: 'match', itemId: e.id, itemTitle: matchLabel(e), details: to ? `Emailed to ${to}` : 'Link created', request });
  return { ok: true, link, emailed };
}

// ── Verification (public, from the QR code) ──
export async function verifyView(db, token) {
  await ensureAccreditationSchema(db);
  const r = await db.prepare(`SELECT * FROM mc_accreditations WHERE verify_token = ?`).bind(String(token || '')).first();
  if (!r) return null;
  const e = await eventById(db, r.event_id);
  const expired = !e || Date.now() > Date.parse(e.event_date) + 12 * 3600e3;
  const state = r.status === 'revoked' ? 'REVOKED' : r.status !== 'approved' ? 'REVOKED' : expired ? 'EXPIRED' : 'VALID';
  return { state, number: r.number, fullName: r.full_name, organisation: r.organisation, role: r.role, zone: r.zone, photoId: r.photo_id,
    match: e ? matchLabel(e) : '', day: e ? matchDay(e.event_date) : '', kickOff: e ? kickOff(e.event_date) : '', revokeReason: r.status === 'revoked' ? r.revoke_reason : null };
}

// ── The card (ID-1 size, 54 × 85.6 mm, portrait) ──
const b64 = bytes => { let x = ''; for (let i = 0; i < bytes.length; i += 0x8000) x += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(x); };
export async function cardPdf(env, r, e) {
  const W = 153.07, H = 242.65; // points
  const doc = new PdfDoc({ width: W, height: H });
  const BLUE = '#4C76B2', RED = '#EE343C', INK = '#16181D';
  doc.rect(0, 0, W, 40, { fill: BLUE }); doc.rect(0, 40, W, 3, { fill: RED });
  // Club badge (JPEG from the site).
  try {
    const res = await env.ASSETS.fetch(new Request(`${SITE}/images/lobi-stars-badge-print.jpg`));
    if (res.ok) { const img = doc.addJpeg(new Uint8Array(await res.arrayBuffer())); if (img) doc.drawImage(6, 5, 30, 30, img.id); }
  } catch { /* no badge */ }
  doc.text('LOBI STARS FC', 41, 17, { size: 9, bold: true, color: '#FFFFFF' });
  doc.text('MEDIA ACCREDITATION', 41, 29, { size: 7.4, bold: true, color: '#FFFFFF' });
  // Photo.
  const ph = r.photo_id ? await fileRow(env.DB, r.photo_id) : null;
  const bytes = ph ? await fileBytes(env, ph) : null;
  const img = bytes ? doc.addJpeg(bytes) : null;
  if (img) { const pw = 56, phH = Math.min(74, pw * (img.height / img.width)); doc.rect(7, 49, pw + 2, phH + 2, { fill: '#FFFFFF', stroke: '#DDE3EC' }); doc.drawImage(8, 50, pw, phH, img.id); }
  else doc.rect(8, 50, 56, 74, { stroke: '#DDE3EC' });
  // Details beside the photo.
  let y = 56; const X = 70, maxW = W - X - 6;
  const line = (label, value, size = 6.4, bold = false) => {
    doc.text(pdfSafe(label), X, y, { size: 4.6, color: '#4A505C' }); y += 6.6;
    for (const l of wrap(pdfSafe(value), maxW, size, bold).slice(0, 2)) { doc.text(l, X, y, { size, bold, color: INK }); y += size + 1.4; }
    y += 2;
  };
  line('NAME', r.full_name, 7, true); line('ORGANISATION', r.organisation); line('ROLE', r.role);
  doc.rect(X - 1, y - 5, maxW + 2, 12, { fill: RED }); doc.text(pdfSafe(String(r.zone || '').toUpperCase()), X + maxW / 2, y + 3, { size: 6.4, bold: true, color: '#FFFFFF', align: 'center' });
  // Match.
  y = 134;
  doc.line(7, y - 4, W - 7, y - 4, { color: '#DDE3EC' });
  for (const l of wrap(pdfSafe(matchLabel(e)), W - 14, 8, true).slice(0, 2)) { doc.text(l, W / 2, y + 4, { size: 8, bold: true, align: 'center' }); y += 9.5; }
  doc.text(pdfSafe(`${matchDay(e.event_date)} · Kick-off ${kickOff(e.event_date)}`), W / 2, y + 4, { size: 5.6, align: 'center', color: '#4A505C' }); y += 8;
  doc.text(pdfSafe(STADIUM), W / 2, y + 4, { size: 5.6, align: 'center', color: '#4A505C' }); y += 8;
  // QR code (drawn as squares) opening the verification page.
  const qr = qrcodeGenerator(0, 'M'); qr.addData(`${SITE}/media/accreditation/verify/${r.verify_token}/`); qr.make();
  const n = qr.getModuleCount(), size = 56, cell = size / n, qx = 8, qy = 173;
  doc.rect(qx - 2, qy - 2, size + 4, size + 4, { fill: '#FFFFFF' });
  const ops = [];
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (qr.isDark(row, col)) ops.push([qx + col * cell, qy + row * cell]);
  for (const [x0, y0] of ops) doc.rect(x0, y0, cell + 0.05, cell + 0.05, { fill: '#000000' });
  doc.text('No.', 70, 182, { size: 4.6, color: '#4A505C' });
  doc.text(pdfSafe(r.number), 70, 191, { size: 7.6, bold: true });
  for (const [k, l] of wrap(pdfSafe(`Signed: ${r.decided_by_name}`), W - 76, 5.4).slice(0, 2).entries()) doc.text(l, 70, 203 + k * 6.6, { size: 5.4, color: INK });
  doc.text('Valid for this match only', 70, 222, { size: 5.2, bold: true, color: RED });
  doc.rect(0, H - 6, W, 6, { fill: BLUE });
  return doc.toBytes({ title: `Lobi Stars FC media accreditation ${r.number}`, author: 'Lobi Stars FC' });
}
