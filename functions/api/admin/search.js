import { requireAdminUser } from '../_lib/adminEvents.js';
import { canAccess } from '../_lib/adminRoles.js';
import { ensureContactsSchema } from '../_lib/contacts.js';
import { ensureTable } from '../_lib/matchCentre.js';

// GET /api/admin/search?q= -- the admin top-bar search: fans, members,
// matches and news, limited to what the signed-in person's role can open.
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

  if (canAccess(admin, 'matchday-content')) {
    await ensureTable(db);
    const { results: ev } = await db.prepare(
      `SELECT id, home_team, away_team, event_date FROM events WHERE lower(home_team || ' ' || away_team || ' ' || COALESCE(competition,'')) LIKE ? ORDER BY event_date DESC LIMIT 6`
    ).bind(like).all();
    for (const e of ev) results.push({ type: 'Match', title: `${e.home_team} vs ${e.away_team}`, sub: new Date(e.event_date).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) + ' WAT', href: `/admin/match-centre/?id=${encodeURIComponent(e.id)}` });
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
