import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { sourceLabels } from '../../_lib/contacts.js';
import { canAccess, canSeeInboxSource, roleOf } from '../../_lib/adminRoles.js';
import { sendEmail } from '../../_lib/email.js';
import {
  ensureInboxSchema, inboxStaff, sanitizeHtml, textToHtml, composeReply, fill, staffFirstName, htmlToText, STATUSES, forgetThreads,
} from '../../_lib/inbox.js';

const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE = 5 * 1024 * 1024;
const MAX_FILES = 5;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function load(db, id) {
  await ensureInboxSchema(db);
  return db.prepare(`SELECT * FROM inbox_threads WHERE id = ?`).bind(id).first();
}

// GET /api/admin/inbox/:id -- the whole conversation, the sender's details and
// the reply templates. Opening it marks it read (?peek=1 doesn't).
export async function onRequestGet({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  const t = await load(db, params.id);
  // Each role only opens its own kinds of message (Media: media@ only).
  if (!t || !canSeeInboxSource(admin, t.source)) return json({ error: 'Conversation not found. It may have been deleted.' }, 404);
  if (t.unread && !new URL(request.url).searchParams.has('peek')) {
    await db.prepare(`UPDATE inbox_threads SET unread = 0 WHERE id = ?`).bind(t.id).run();
    t.unread = 0;
  }
  const { results: messages } = await db.prepare(`SELECT id, direction, author_id, author_name, body_html, attachments, delivery, created_at FROM inbox_messages WHERE thread_id = ? ORDER BY id`).bind(t.id).all();
  for (const m of messages) m.attachments = m.attachments ? JSON.parse(m.attachments) : [];
  // The person in the fan database, with every way they have been in touch.
  let contact = null;
  const link = t.enquiry_id ? await db.prepare(`SELECT contact_id FROM contact_sources WHERE ref_table = 'enquiries' AND ref_id = ?`).bind(t.enquiry_id).first() : null;
  if (link) {
    const c = await db.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(link.contact_id).first();
    if (c) {
      const labels = await sourceLabels(db);
      const { results } = await db.prepare(`SELECT DISTINCT source FROM contact_sources WHERE contact_id = ?`).bind(c.id).all();
      const others = (await db.prepare(`SELECT COUNT(*) AS n FROM inbox_threads WHERE email = ? AND id != ? AND spam_at IS NULL AND deleted_at IS NULL`).bind(t.email, t.id).first()).n;
      contact = { id: c.id, name: [c.first_name, c.surname].filter(Boolean).join(' '), email: c.email, phone: c.phone, state: c.state, firstSeen: c.first_seen, sources: results.map(r => labels[r.source] || r.source), otherConversations: others };
    }
  }
  const { results: templates } = await db.prepare(`SELECT id, name, body_html FROM inbox_templates ORDER BY name`).all();
  return json({ thread: { ...t, details: t.details ? JSON.parse(t.details) : {} }, messages, contact, templates, staff: (await inboxStaff(db)).map(x => ({ id: x.id, name: x.name })), canOpenProfile: canAccess(admin, 'fans') });
}

// POST /api/admin/inbox/:id
//   { action: 'reply', html, attachments: [{ name, type, data (base64) }] }  email the fan
//   { action: 'preview', html }      the email exactly as the fan will see it (nothing sent)
//   { action: 'note', text }         private note for staff (never emailed)
//   { action: 'status', status }     new / open / replied / closed
//   { action: 'assign', to }         staff id ('' = nobody)
//   { action: 'spam' | 'notspam' | 'unread' }
//   { action: 'delete' | 'restore' }  Deleted tab (kept 30 days, then removed for good)
//   { action: 'delete_forever' }      Super Admins only: removed now, with its form record
export async function onRequestPost({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  const t = await load(db, params.id);
  // Each role only opens its own kinds of message (Media: media@ only).
  if (!t || !canSeeInboxSource(admin, t.source)) return json({ error: 'Conversation not found. It may have been deleted.' }, 404);
  const b = await request.json().catch(() => ({}));
  const now = new Date().toISOString();
  const firstName = (t.name || '').split(/\s+/)[0] || 'there';

  if (b.action === 'delete' || b.action === 'restore') {
    const del = b.action === 'delete';
    await db.prepare(`UPDATE inbox_threads SET deleted_at = ?, deleted_by = ?, unread = CASE WHEN ? THEN 0 ELSE unread END WHERE id = ?`).bind(del ? now : null, del ? admin.name : null, del ? 1 : 0, t.id).run();
    await logAdminAction(db, admin, del ? 'inbox_delete' : 'inbox_restore', `${t.ref} (${t.email})`);
    return json({ ok: true });
  }
  if (b.action === 'delete_forever') {
    if (roleOf(admin) !== 'super_admin') return json({ error: 'Only Super Admins can delete a conversation for good.' }, 403);
    if (!t.deleted_at) return json({ error: 'Delete the conversation first (it moves to Deleted), then delete it for good there.' }, 400);
    await forgetThreads(db, [{ id: t.id, enquiry_id: t.enquiry_id }]);
    await logAdminAction(db, admin, 'inbox_delete_forever', `${t.ref} (${t.email})`);
    return json({ ok: true });
  }
  if (t.deleted_at && b.action !== 'unread') return json({ error: 'This conversation is in Deleted. Restore it first.' }, 409);

  if (b.action === 'reply' || b.action === 'preview') {
    const body = await sanitizeHtml(fill(b.html, { first_name: firstName, staff_name: staffFirstName(admin) || 'The Lobi Stars FC team', ref: t.ref }));
    if (!htmlToText(body)) return json({ error: 'Please write your reply first.' }, 400);
    const quoted = await db.prepare(`SELECT author_name, body_html, created_at FROM inbox_messages WHERE thread_id = ? AND direction = 'in' ORDER BY id DESC LIMIT 1`).bind(t.id).first();
    const mail = composeReply(env, { thread: t, admin, bodyHtml: body, quoted });
    if (b.action === 'preview') return json({ from: mail.from, to: t.email, replyTo: mail.replyTo, subject: mail.subject, html: mail.html });

    const files = Array.isArray(b.attachments) ? b.attachments : [];
    if (files.length > MAX_FILES) return json({ error: `Up to ${MAX_FILES} attachments per reply.` }, 400);
    const attachments = [];
    for (const f of files) {
      const data = String(f?.data || '').replace(/^data:[^,]*,/, '');
      const size = Math.floor(data.length * 3 / 4);
      const name = String(f?.name || 'attachment').replace(/[^\w .()-]/g, '_').slice(0, 100);
      if (!FILE_TYPES.has(f?.type)) return json({ error: `${name}: only PDF and image files (JPG, PNG, WEBP, GIF) can be attached.` }, 400);
      if (!data || size > MAX_FILE) return json({ error: `${name} is bigger than 5MB.` }, 400);
      attachments.push({ filename: name, content: data, meta: { name, type: f.type, size } });
    }
    let delivery = 'not_sent';
    let emailId = null;
    if (env.RESEND_API_KEY) {
      try {
        const r = await sendEmail(env, { to: t.email, from: mail.from, replyTo: mail.replyTo, subject: mail.subject, html: mail.html, text: mail.text, attachments: attachments.map(({ filename, content }) => ({ filename, content })) });
        delivery = 'sent'; emailId = r?.id || null;
      } catch (err) {
        console.log('[inbox] reply failed', err.message);
        return json({ error: 'The email could not be sent just now, so the reply was not saved. Please try again in a minute.' }, 502);
      }
    } else if (String(env.FANS_DEV_LINKS) === '1') delivery = 'dev'; // local testing: treated as sent
    const sent = delivery !== 'not_sent';
    await db.batch([
      db.prepare(`INSERT INTO inbox_messages (thread_id, direction, author_id, author_name, body_html, attachments, delivery, email_id, created_at) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(t.id, admin.id, admin.name, body, attachments.length ? JSON.stringify(attachments.map(a => a.meta)) : null, delivery, emailId, now),
      db.prepare(`UPDATE inbox_threads SET status = CASE WHEN ? THEN 'replied' ELSE status END, unread = 0, preview = ?, last_message_at = ?, last_out_at = CASE WHEN ? THEN ? ELSE last_out_at END,
                  assigned_to = COALESCE(assigned_to, ?), assigned_name = COALESCE(assigned_name, ?) WHERE id = ?`)
        .bind(sent ? 1 : 0, htmlToText(body).replace(/\s+/g, ' ').slice(0, 140), now, sent ? 1 : 0, now, admin.id, admin.name, t.id),
    ]);
    await logAdminAction(db, admin, 'inbox_reply', `${t.ref} to ${t.email}${sent ? '' : ' (saved, not emailed: email service not set up)'}${attachments.length ? `, ${attachments.length} attachment(s)` : ''}`);
    return json({ ok: true, emailed: sent, delivery, warning: sent ? null : 'Saved in the conversation but NOT emailed: the email service (Resend) is not set up yet. See the setup steps in the staff guide.' });
  }

  if (b.action === 'note') {
    const text = String(b.text || '').trim().slice(0, 5000);
    if (!text) return json({ error: 'Please write the note first.' }, 400);
    await db.prepare(`INSERT INTO inbox_messages (thread_id, direction, author_id, author_name, body_html, created_at) VALUES (?, 'note', ?, ?, ?, ?)`)
      .bind(t.id, admin.id, admin.name, textToHtml(text), now).run();
    await logAdminAction(db, admin, 'inbox_note', `${t.ref}: private note added`);
    return json({ ok: true });
  }
  if (b.action === 'status') {
    if (!STATUSES.includes(b.status)) return json({ error: 'Unknown status' }, 400);
    await db.prepare(`UPDATE inbox_threads SET status = ? WHERE id = ?`).bind(b.status, t.id).run();
    await logAdminAction(db, admin, 'inbox_status', `${t.ref}: ${t.status} → ${b.status}`);
    return json({ ok: true });
  }
  if (b.action === 'assign') {
    const to = String(b.to || '');
    const person = to ? (await inboxStaff(db)).find(x => x.id === to) : null;
    if (to && !person) return json({ error: 'That staff member cannot open the Inbox.' }, 400);
    await db.prepare(`UPDATE inbox_threads SET assigned_to = ?, assigned_name = ? WHERE id = ?`).bind(person?.id || null, person?.name || null, t.id).run();
    await logAdminAction(db, admin, 'inbox_assign', `${t.ref}: ${person ? `assigned to ${person.name}` : 'unassigned'}`);
    return json({ ok: true });
  }
  if (b.action === 'spam' || b.action === 'notspam') {
    await db.prepare(`UPDATE inbox_threads SET spam_at = ?, unread = 0 WHERE id = ?`).bind(b.action === 'spam' ? now : null, t.id).run();
    await logAdminAction(db, admin, b.action === 'spam' ? 'inbox_spam' : 'inbox_not_spam', `${t.ref} (${t.email})`);
    return json({ ok: true });
  }
  if (b.action === 'unread') {
    await db.prepare(`UPDATE inbox_threads SET unread = 1 WHERE id = ?`).bind(t.id).run();
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
}
