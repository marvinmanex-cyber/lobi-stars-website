// Media Centre › Interview Requests. Journalists ask on the public form
// (/media/interview-request): who they want to interview, the topic, a
// preferred date and the format (phone, in person, video). Media staff
// approve, decline (with a reason) or propose another time; the journalist is
// emailed each time. Status: new / proposed / approved / declined / done.
// Each request is added to the media contacts history.
import { sendEmail } from './email.js';
import { ensureAccreditationSchema, saveContact } from './mediaAccreditation.js';
import { oneLine, clean, newId, mcLog } from './mediaCentre.js';

export const FORMATS = { phone: 'Phone', in_person: 'In person', video: 'Video call' };
export const STATUSES = { new: 'New', proposed: 'New time proposed', approved: 'Approved', declined: 'Declined', done: 'Done' };
const nowIso = () => new Date().toISOString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lagos = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

let ready = false;
export async function ensureInterviewSchema(db) {
  if (ready) return;
  await ensureAccreditationSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS mc_interviews (
    id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'new',
    full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, organisation TEXT NOT NULL,
    who TEXT NOT NULL, topic TEXT NOT NULL, preferred_at TEXT, format TEXT NOT NULL,
    proposed_at TEXT, decision_note TEXT, decided_by TEXT, decided_at TEXT,
    history TEXT, ip TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  ready = true;
}
export function checkRequest(b) {
  const v = { fullName: oneLine(b.fullName, 80), email: oneLine(b.email, 254).toLowerCase(), phone: oneLine(b.phone, 24), organisation: oneLine(b.organisation, 120),
    who: oneLine(b.who, 120), topic: clean(b.topic, 1000), preferredAt: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(b.preferredAt || '')) ? String(b.preferredAt) : '', format: FORMATS[b.format] ? b.format : '' };
  if (v.fullName.length < 3) return { error: 'Enter your full name.' };
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(v.email)) return { error: 'Enter a valid email address.' };
  if (v.organisation.length < 2) return { error: 'Enter your media organisation.' };
  if (v.who.length < 3) return { error: 'Who would you like to interview?' };
  if (v.topic.length < 10) return { error: 'Tell us the topic (a sentence or two).' };
  if (!v.preferredAt) return { error: 'Choose a preferred date.' };
  if (!v.format) return { error: 'Choose phone, in person or video.' };
  return { value: v };
}
async function mail(env, to, subject, html) {
  if (!env.RESEND_API_KEY) return false;
  try { await sendEmail(env, { to, subject, replyTo: 'media@lobistarsfc.com', html: `<div style="font:16px/1.5 Arial,sans-serif;max-width:600px">${html}<p style="color:#4A505C;font-size:13px">Lobi Stars FC Media Department · McCarthy Stadium, Makurdi</p></div>`, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') }); return true; }
  catch (e) { console.error('[interviews] email', e); return false; }
}
export async function createRequest(env, request, v) {
  const db = env.DB;
  await ensureInterviewSchema(db);
  const id = newId('int'), at = nowIso();
  await db.prepare(`INSERT INTO mc_interviews (id, status, full_name, email, phone, organisation, who, topic, preferred_at, format, history, ip, created_at, updated_at) VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, v.fullName, v.email, v.phone || null, v.organisation, v.who, v.topic, v.preferredAt, v.format, JSON.stringify([{ at, note: 'Requested' }]), request.headers.get('CF-Connecting-IP') || null, at, at).run();
  await saveContact(db, { email: v.email, full_name: v.fullName, phone: v.phone, organisation: v.organisation }, 'interviews', `Interview request: ${v.who} (${v.topic.slice(0, 60)})`);
  await mcLog(db, { kind: 'public', id: null, name: `${v.fullName} (${v.organisation})` }, 'interview_request', { section: 'interviews', itemType: 'interview', itemId: id, itemTitle: `${v.who}: ${v.topic.slice(0, 80)}`, request });
  await mail(env, v.email, 'Interview request received', `<p>Dear ${esc(v.fullName)},</p><p>Thank you for your request to interview <b>${esc(v.who)}</b> (${esc(FORMATS[v.format])}). Our media team will reply by email.</p>`);
  return { ok: true, id };
}
export async function listRequests(db) {
  await ensureInterviewSchema(db);
  return (await db.prepare(`SELECT * FROM mc_interviews ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'proposed' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, created_at DESC LIMIT 300`).all()).results.map(r => ({
    id: r.id, status: r.status, fullName: r.full_name, email: r.email, phone: r.phone, organisation: r.organisation, who: r.who, topic: r.topic, preferredAt: r.preferred_at, format: r.format,
    proposedAt: r.proposed_at, note: r.decision_note, decidedBy: r.decided_by, decidedAt: r.decided_at, history: JSON.parse(r.history || '[]'), createdAt: r.created_at }));
}
/** decision: approve (note?) | decline (note) | propose (at, note?) | done. */
export async function decideRequest(env, request, user, id, { decision, note = '', at: when = '' }) {
  const db = env.DB;
  await ensureInterviewSchema(db);
  const r = await db.prepare(`SELECT * FROM mc_interviews WHERE id = ?`).bind(id).first();
  if (!r) return { error: 'Not found.', status: 404 };
  const msg = clean(note, 800), now = nowIso();
  const history = [...JSON.parse(r.history || '[]')];
  let status, mailHtml = null, subject = '', proposed = r.proposed_at;
  if (decision === 'approve') {
    status = 'approved'; subject = `Interview confirmed: ${r.who}`;
    mailHtml = `<p>Dear ${esc(r.full_name)},</p><p>Your interview with <b>${esc(r.who)}</b> is confirmed${r.proposed_at || r.preferred_at ? ` for <b>${esc(lagos(r.proposed_at || r.preferred_at))}</b>` : ''} (${esc(FORMATS[r.format])}).</p>${msg ? `<p>${esc(msg)}</p>` : ''}`;
  } else if (decision === 'decline') {
    if (msg.length < 3) return { error: 'Give a reason (it is emailed).' };
    status = 'declined'; subject = `Interview request: ${r.who}`;
    mailHtml = `<p>Dear ${esc(r.full_name)},</p><p>We are sorry: we cannot arrange the interview with <b>${esc(r.who)}</b> this time.</p><p>${esc(msg)}</p>`;
  } else if (decision === 'propose') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(when))) return { error: 'Choose the date and time you propose.' };
    proposed = new Date(`${String(when).slice(0, 16)}:00+01:00`).toISOString();
    status = 'proposed'; subject = `Interview request: another time for ${r.who}`;
    mailHtml = `<p>Dear ${esc(r.full_name)},</p><p>For your interview with <b>${esc(r.who)}</b>, can you do <b>${esc(lagos(proposed))}</b> instead (${esc(FORMATS[r.format])})? Please reply to this email to confirm.</p>${msg ? `<p>${esc(msg)}</p>` : ''}`;
  } else if (decision === 'done') status = 'done';
  else return { error: 'Unknown decision.' };
  history.push({ at: now, note: `${STATUSES[status]} by ${user.fullName}${msg ? `: ${msg}` : ''}${decision === 'propose' ? ` (${lagos(proposed)})` : ''}` });
  await db.prepare(`UPDATE mc_interviews SET status = ?, proposed_at = ?, decision_note = ?, decided_by = ?, decided_at = ?, history = ?, updated_at = ? WHERE id = ?`)
    .bind(status, proposed, msg || null, user.fullName, now, JSON.stringify(history.slice(-30)), now, id).run();
  await mcLog(db, { kind: 'media', id: user.id, name: `${user.fullName} (${user.loginId})` }, `interview_${decision}`, { section: 'interviews', itemType: 'interview', itemId: id, itemTitle: `${r.full_name}: ${r.who}`, details: msg || null, request });
  const emailed = mailHtml ? await mail(env, r.email, subject, mailHtml) : false;
  if (decision !== 'done') await saveContact(db, { email: r.email, full_name: r.full_name, phone: r.phone, organisation: r.organisation }, null, `Interview ${STATUSES[status].toLowerCase()}: ${r.who}`);
  return { ok: true, emailed };
}
