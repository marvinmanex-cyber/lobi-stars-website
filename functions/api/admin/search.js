import { requireAdminUser } from '../_lib/adminEvents.js';
import { canAccess, inboxSources } from '../_lib/adminRoles.js';
import { ensureContactsSchema } from '../_lib/contacts.js';
import { ensureTable } from '../_lib/matchCentre.js';
import { ensureInboxSchema } from '../_lib/inbox.js';

// GET /api/admin/search?q= -- the admin top-bar search: fans, members,
// Inbox conversations, matches and news, limited to what the signed-in person's role can open.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return Response.json({ results: [] });
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const digits = q.replace(/\D/g, '');
  const results = [];
  const db = env.DB;

  if (canAccess(admin, 'fans')) {
    await ensureContactsSchema(db);
    const { results: rows } = await db.prepare(
      `SELECT id, first_name, surname, email, phone, first_source FROM contacts
       WHERE lower(COALESCE(first_name,'') || ' ' || COALESCE(surname,'')) LIKE ? OR lower(COALESCE(email,'')) LIKE ? OR (? != '' AND COALESCE(phone,'') LIKE ?)
       ORDER BY last_seen DESC LIMIT 6`
    ).bind(like, like, digits, `%${digits.slice(-9)}%`).all();
    for (const r of rows) results.push({ type: 'Fan', title: `${r.first_name || ''} ${r.surname || ''}`.trim() || r.email || r.phone, sub: [r.email, r.phone].filter(Boolean).join(' · '), href: `/admin/fans/?q=${encodeURIComponent(r.email || r.phone || '')}` });
    const { results: mem } = await db.prepare(
      `SELECT id, first_name, last_name, email FROM members WHERE lower(id) LIKE ? OR lower(email) LIKE ? OR lower(first_name || ' ' || last_name) LIKE ? LIMIT 4`
    ).bind(like, like, like).all().catch(() => ({ results: [] }));
    for (const m of mem) results.push({ type: 'Member', title: `${m.first_name} ${m.last_name}`, sub: `${m.id} · ${m.email}`, href: `/admin/members/?q=${encodeURIComponent(m.email)}` });
  }

  if (canAccess(admin, 'inbox')) {
    await ensureInboxSchema(db);
    const scope = inboxSources(admin);
    const { results: th } = await db.prepare(
      `SELECT id, ref, name, email, subject, status FROM inbox_threads WHERE spam_at IS NULL ${scope ? `AND source IN (${scope.map(() => '?').join(',') || "''"})` : ''} AND (lower(ref) LIKE ? OR lower(COALESCE(name,'')) LIKE ? OR lower(COALESCE(email,'')) LIKE ? OR lower(COALESCE(subject,'')) LIKE ?)
       ORDER BY last_message_at DESC LIMIT 5`
    ).bind(...(scope || []), like, like, like, like).all();
    for (const t of th) results.push({ type: 'Message', title: `${t.subject || '(no subject)'}`, sub: `${t.ref} · ${t.name || t.email} · ${t.status}`, href: `/admin/inbox/?t=${encodeURIComponent(t.id)}` });
  }
  if (canAccess(admin, 'matchday-content')) {
    await ensureTable(db);
    const { results: ev } = await db.prepare(
      `SELECT id, home_team, away_team, event_date FROM events WHERE lower(home_team || ' ' || away_team || ' ' || COALESCE(competition,'')) LIKE ? ORDER BY event_date DESC LIMIT 6`
    ).bind(like).all();
    for (const e of ev) results.push({ type: 'Match', title: `${e.home_team} vs ${e.away_team}`, sub: new Date(e.event_date).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }), href: `/admin/match-centre/?id=${encodeURIComponent(e.id)}` });
  }

  if (canAccess(admin, 'content')) {
    try {
      const news = await (await env.ASSETS.fetch(new URL('/data/news-index.json', url))).json();
      for (const a of news.filter(a => a.title.toLowerCase().includes(q)).slice(0, 6)) {
        results.push({ type: 'News', title: a.title, sub: `${a.category} · ${a.publishedDay || ''}`, href: `/admin/#/collections/news/entries/${encodeURIComponent(a.slug)}` });
      }
    } catch { /* no news index */ }
  }
  return Response.json({ results: results.slice(0, 20) }, { headers: { 'Cache-Control': 'no-store' } });
}
