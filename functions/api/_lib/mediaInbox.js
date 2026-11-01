// Media Centre › Media Inbox: the emails sent to media@lobistarsfc.com (they arrive
// through the media-mail Worker as "Media email" conversations, the same ones the
// admin Inbox shows) and the replies and new emails sent from media@.
// Every Media Centre user sees how many emails are unread; reading, replying and
// writing need the media desk code (or the media approver / a Super Admin).
// Emails go out signed "Lobi Stars FC Media" (no personal name); who sent each
// one is kept in the conversation and the Media Centre activity log.
import { ensureInboxSchema, sanitizeHtml, textToHtml, composeReply, htmlToText, nextRefs, MEDIA_EMAIL } from './inbox.js';
import { sendEmail } from './email.js';
import { normEmail } from './contacts.js';
import { randomId } from './crypto.js';

const LIVE = `source = 'media_email' AND spam_at IS NULL AND deleted_at IS NULL`;
const DESK = { id: 'media-desk', name: '' };   // composeReply: no first name, so "Lobi Stars FC Media <media@…>"
const nowIso = () => new Date().toISOString();
const short = html => htmlToText(html).replace(/\s+/g, ' ').slice(0, 140);

export async function unreadCount(db) {
  await ensureInboxSchema(db);
  return (await db.prepare(`SELECT COUNT(*) AS n FROM inbox_threads WHERE ${LIVE} AND unread = 1`).first())?.n || 0;
}

export async function listThreads(db) {
  await ensureInboxSchema(db);
  return (await db.prepare(`SELECT id, ref, subject, name, email, status, unread, preview, last_message_at FROM inbox_threads WHERE ${LIVE} ORDER BY last_message_at DESC LIMIT 200`).all()).results
    .map(t => ({ id: t.id, ref: t.ref, subject: t.subject || '(no subject)', name: t.name || t.email, email: t.email, status: t.status, unread: !!t.unread, preview: t.preview || '', at: t.last_message_at }));
}

/** One conversation (marked read). */
export async function getThread(db, id) {
  await ensureInboxSchema(db);
  const t = await db.prepare(`SELECT * FROM inbox_threads WHERE id = ? AND ${LIVE}`).bind(String(id)).first();
  if (!t) return null;
  if (t.unread) await db.prepare(`UPDATE inbox_threads SET unread = 0 WHERE id = ?`).bind(t.id).run();
  const messages = (await db.prepare(`SELECT direction, author_name, body_html, delivery, created_at FROM inbox_messages WHERE thread_id = ? AND direction != 'note' ORDER BY id`).bind(t.id).all()).results
    .map(m => ({ direction: m.direction, author: m.direction === 'in' ? (m.author_name || t.name || t.email) : 'Lobi Stars FC Media', html: m.body_html, delivery: m.delivery, at: m.created_at }));
  return { id: t.id, ref: t.ref, subject: t.subject || '(no subject)', name: t.name || t.email, email: t.email, status: t.status, messages };
}

async function deliver(env, mail, to) {
  if (env.RESEND_API_KEY) {
    const r = await sendEmail(env, { to, from: mail.from, replyTo: mail.replyTo, subject: mail.subject, html: mail.html, text: mail.text });
    return { delivery: 'sent', emailId: r?.id || null };
  }
  return { delivery: String(env.FANS_DEV_LINKS) === '1' ? 'dev' : 'not_sent', emailId: null };
}

/** Reply from media@ (plain text from the Media Centre, turned into safe HTML). */
export async function reply(env, user, id, text) {
  const db = env.DB;
  await ensureInboxSchema(db);
  const t = await db.prepare(`SELECT * FROM inbox_threads WHERE id = ? AND ${LIVE}`).bind(String(id)).first();
  if (!t) return { error: 'That email conversation no longer exists.', status: 404 };
  const body = await sanitizeHtml(textToHtml(String(text || '').slice(0, 20000)));
  if (!htmlToText(body).trim()) return { error: 'Write your reply first.' };
  const quoted = await db.prepare(`SELECT author_name, body_html, created_at FROM inbox_messages WHERE thread_id = ? AND direction = 'in' ORDER BY id DESC LIMIT 1`).bind(t.id).first();
  const mail = composeReply(env, { thread: t, admin: DESK, bodyHtml: body, quoted });
  let d;
  try { d = await deliver(env, mail, t.email); } catch (e) { console.error('[media inbox] reply', e); return { error: 'The email could not be sent just now. Please try again in a minute.', status: 502 }; }
  const now = nowIso(), sent = d.delivery !== 'not_sent';
  await db.batch([
    db.prepare(`INSERT INTO inbox_messages (thread_id, direction, author_id, author_name, body_html, delivery, email_id, created_at) VALUES (?, 'out', ?, ?, ?, ?, ?, ?)`)
      .bind(t.id, user.id, `${user.fullName} (Media Centre)`, body, d.delivery, d.emailId, now),
    db.prepare(`UPDATE inbox_threads SET status = CASE WHEN ? THEN 'replied' ELSE status END, unread = 0, preview = ?, last_message_at = ?, last_out_at = CASE WHEN ? THEN ? ELSE last_out_at END WHERE id = ?`)
      .bind(sent ? 1 : 0, short(body), now, sent ? 1 : 0, now, t.id),
  ]);
  return { ok: true, emailed: sent, ref: t.ref, to: t.email };
}

/** A new email from media@ (it starts a conversation; the answer comes back into it). */
export async function compose(env, user, { to, name, subject, text }) {
  const db = env.DB;
  await ensureInboxSchema(db);
  const email = normEmail(to);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Enter a valid email address.' };
  const subj = String(subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (subj.length < 2) return { error: 'Add a subject.' };
  const body = await sanitizeHtml(textToHtml(String(text || '').slice(0, 20000)));
  if (!htmlToText(body).trim()) return { error: 'Write the email first.' };
  const now = nowIso();
  const [ref] = await nextRefs(db, now.slice(0, 4), 1);
  const thread = { id: randomId('THR', 10), ref, source: 'media_email', subject: subj, name: String(name || '').trim().slice(0, 80) || email, email };
  const mail = composeReply(env, { thread, admin: DESK, bodyHtml: body, quoted: null });
  mail.subject = `${subj} [${ref}]`;   // a new email, not "Re:"
  let d;
  try { d = await deliver(env, mail, email); } catch (e) { console.error('[media inbox] compose', e); return { error: 'The email could not be sent just now. Please try again in a minute.', status: 502 }; }
  const sent = d.delivery !== 'not_sent';
  await db.batch([
    db.prepare(`INSERT INTO inbox_threads (id, ref, source, subject, name, email, status, unread, preview, created_at, last_message_at, last_out_at) VALUES (?, ?, 'media_email', ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
      .bind(thread.id, ref, subj, thread.name, email, sent ? 'replied' : 'open', short(body), now, now, sent ? now : null),
    db.prepare(`INSERT INTO inbox_messages (thread_id, direction, author_id, author_name, body_html, delivery, email_id, created_at) VALUES (?, 'out', ?, ?, ?, ?, ?, ?)`)
      .bind(thread.id, user.id, `${user.fullName} (Media Centre)`, body, d.delivery, d.emailId, now),
  ]);
  return { ok: true, emailed: sent, id: thread.id, ref, to: email };
}

export { MEDIA_EMAIL };
