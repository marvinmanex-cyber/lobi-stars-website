import { requireAdminUser } from '../../_lib/adminEvents.js';
import { getSources } from '../../_lib/contacts.js';
import { syncEnquiries, purgeSpam, purgeDeleted, inboxStaff, inboxSettings, INBOX_SOURCES } from '../../_lib/inbox.js';
import { inboxSources } from '../../_lib/adminRoles.js';

const PAGE = 50;

// GET /api/admin/inbox -- the conversation list (Fans & Inbox › Inbox).
//   tab     all | unread | new | open | replied | closed | mine | spam | deleted
//   source  contact_form | sponsorship | hospitality
//   q       name, email, subject, reference or words in any message
//   offset  for "Load more"
// Also brings in any form messages that don't have a conversation yet, and
// deletes spam and deleted conversations older than 30 days.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await syncEnquiries(db);
  await purgeSpam(db);
  await purgeDeleted(db);
  const url = new URL(request.url);
  const tab = url.searchParams.get('tab') || 'all';
  const source = url.searchParams.get('source') || '';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  // Shown = not spam and not deleted.
  const LIVE = 't.spam_at IS NULL AND t.deleted_at IS NULL';
  const TAB = {
    all: LIVE, unread: `${LIVE} AND t.unread = 1`, mine: `${LIVE} AND t.assigned_to = ?`, spam: 't.spam_at IS NOT NULL AND t.deleted_at IS NULL', deleted: 't.deleted_at IS NOT NULL',
    new: `${LIVE} AND t.status = 'new'`, open: `${LIVE} AND t.status = 'open'`, replied: `${LIVE} AND t.status = 'replied'`, closed: `${LIVE} AND t.status = 'closed'`,
  };
  const where = [TAB[tab] || TAB.all];
  const args = tab === 'mine' ? [admin.id] : [];
  // Each role sees only its own kinds of message (null = all of them).
  const scope = inboxSources(admin);
  const inScope = scope ? `source IN (${scope.map(() => '?').join(',') || "''"})` : '';
  if (scope) { where.push('t.' + inScope); args.push(...scope); }
  if (INBOX_SOURCES[source] && (!scope || scope.includes(source))) { where.push('t.source = ?'); args.push(source); }
  if (q) {
    where.push(`(LOWER(t.name) LIKE ? OR LOWER(t.email) LIKE ? OR LOWER(t.subject) LIKE ? OR LOWER(t.ref) LIKE ?
      OR EXISTS (SELECT 1 FROM inbox_messages m WHERE m.thread_id = t.id AND m.direction != 'note' AND LOWER(m.body_html) LIKE ?))`);
    for (let i = 0; i < 5; i++) args.push(`%${q}%`);
  }
  const sql = where.join(' AND ');
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM inbox_threads t WHERE ${sql}`).bind(...args).first()).n;
  const { results } = await db.prepare(
    `SELECT t.id, t.ref, t.source, t.subject, t.name, t.email, t.status, t.unread, t.assigned_to, t.assigned_name, t.preview, t.spam_at,
            t.created_at, t.last_message_at, t.last_in_at, t.last_out_at,
            (SELECT COUNT(*) FROM inbox_messages m WHERE m.thread_id = t.id AND m.direction != 'note') AS messages
     FROM inbox_threads t WHERE ${sql} ORDER BY t.last_message_at DESC LIMIT ${PAGE} OFFSET ?`
  ).bind(...args, offset).all();

  const c = await db.prepare(
    `SELECT
       SUM(spam_at IS NULL AND deleted_at IS NULL) AS "all", SUM(spam_at IS NULL AND deleted_at IS NULL AND unread = 1) AS unread,
       SUM(spam_at IS NULL AND deleted_at IS NULL AND status = 'new') AS new, SUM(spam_at IS NULL AND deleted_at IS NULL AND status = 'open') AS open,
       SUM(spam_at IS NULL AND deleted_at IS NULL AND status = 'replied') AS replied, SUM(spam_at IS NULL AND deleted_at IS NULL AND status = 'closed') AS closed,
       SUM(spam_at IS NULL AND deleted_at IS NULL AND assigned_to = ?) AS mine, SUM(spam_at IS NOT NULL AND deleted_at IS NULL) AS spam, SUM(deleted_at IS NOT NULL) AS deleted
     FROM inbox_threads ${scope ? 'WHERE ' + inScope : ''}`
  ).bind(admin.id, ...(scope || [])).first();
  const counts = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v || 0]));
  const defs = await getSources(db);
  const sources = Object.fromEntries(Object.keys(INBOX_SOURCES).filter(k => !scope || scope.includes(k)).map(k => { const d = defs.find(x => x.key === k); return [k, { label: INBOX_SOURCES[k], color: d?.color || '#64748B' }]; }));
  const s = await inboxSettings(db);
  return Response.json({
    threads: results, total, offset, pageSize: PAGE, counts, sources,
    staff: (await inboxStaff(db)).map(x => ({ id: x.id, name: x.name })),
    me: { id: admin.id, name: admin.name },
    settings: { alertsEmail: s.alertsEmail, dailySummary: s.dailySummary, extraEmails: s.extraEmails.join(', ') },
    emailReady: !!env.RESEND_API_KEY, inboundReady: !!(env.INBOX_INBOUND_KEY && env.INBOX_REPLY_DOMAIN),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
