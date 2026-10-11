import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureContactsSchema, getSources } from '../_lib/contacts.js';
import { queryContacts, maskEmail, maskPhone } from '../_lib/fanQuery.js';

const DAY = 86400e3;
const pct = (n, t) => (t ? Math.round((n / t) * 1000) / 10 : 0);

/** The date range in Nigerian time: { start, end } as ISO strings (start '' = all time). */
async function rangeOf(p, env, request) {
  const watMidnight = ymd => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) - 3600e3;
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const tomorrow = watMidnight(today) + DAY;
  const r = p.get('range') || 'all';
  if (r === '7d') return { key: r, start: new Date(tomorrow - 7 * DAY).toISOString(), end: new Date(tomorrow).toISOString() };
  if (r === '30d') return { key: r, start: new Date(tomorrow - 30 * DAY).toISOString(), end: new Date(tomorrow).toISOString() };
  if (r === 'season') {
    let site = {};
    try { site = await (await env.ASSETS.fetch(new URL('/data/site.json', request.url))).json(); } catch {}
    if (/^\d{4}-\d{2}-\d{2}$/.test(site.seasonStart || '')) return { key: r, start: new Date(watMidnight(site.seasonStart)).toISOString(), end: new Date(tomorrow).toISOString() };
  }
  if (r === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(p.get('from') || '') && /^\d{4}-\d{2}-\d{2}$/.test(p.get('to') || '')) {
    return { key: r, start: new Date(watMidnight(p.get('from'))).toISOString(), end: new Date(watMidnight(p.get('to')) + DAY).toISOString() };
  }
  return { key: 'all', start: '', end: '' };
}

// GET /api/admin/contact-sources?range=7d|30d|season|all|custom&from=&to=
//   -> cards, the pie (each contact once, by FIRST source: adds up to 100%)
//      and the bar chart (everyone who used each source at least once).
// GET /api/admin/contact-sources?list=1&firstSource=&range=…&page=
//   -> the contacts table under the charts (emails/phones partly hidden
//      for staff without the export permission).
// The range applies to when people first reached us.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureContactsSchema(db);
  const p = new URL(request.url).searchParams;
  const r = await rangeOf(p, env, request);
  const sources = await getSources(db);
  const where = [], binds = [];
  if (r.start) { where.push('c.first_seen >= ?', 'c.first_seen < ?'); binds.push(r.start, r.end); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  if (p.get('list')) {
    const params = new URLSearchParams();
    if (r.start) { params.set('firstFrom', r.start); params.set('firstTo', r.end); }
    if (p.get('firstSource')) params.set('firstSource', p.get('firstSource'));
    if (p.get('q')) params.set('q', p.get('q'));
    params.set('sort', 'first_seen');
    const page = Math.max(1, Number(p.get('page')) || 1);
    const res = await queryContacts(db, { params, page, pageSize: 25 });
    return Response.json({
      total: res.total, page, pages: Math.max(1, Math.ceil(res.total / 25)), canExport: admin.canExport,
      exportQuery: params.toString(),
      rows: res.rows.map(c => ({
        id: c.id, name: [c.first_name, c.surname].filter(Boolean).join(' ') || '(no name)',
        email: admin.canExport ? c.email || '' : maskEmail(c.email), phone: admin.canExport ? c.phone || '' : maskPhone(c.phone),
        firstSource: c.first_source, sources: c.sources, firstSeen: c.first_seen, consent: !!c.marketing_consent,
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM contacts c ${w}`).bind(...binds).first()).n || 0;
  const { results: first } = await db.prepare(`SELECT first_source AS k, COUNT(*) AS n FROM contacts c ${w} GROUP BY first_source`).bind(...binds).all();
  const { results: used } = await db.prepare(`SELECT s.source AS k, COUNT(DISTINCT s.contact_id) AS n FROM contact_sources s JOIN contacts c ON c.id = s.contact_id ${w} GROUP BY s.source`).bind(...binds).all();
  const consent = (await db.prepare(`SELECT COUNT(*) AS n FROM contacts c ${w ? `${w} AND` : 'WHERE'} c.marketing_consent = 1`).bind(...binds).first()).n || 0;
  const watNow = new Date(Date.now() + 3600e3);
  const monthStart = new Date(Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth(), 1) - 3600e3).toISOString();
  const newMonth = (await db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE first_seen >= ?`).bind(monthStart).first()).n || 0;

  const known = new Set(sources.map(s => s.key));
  const pie = sources.map(s => ({ key: s.key, label: s.label, color: s.color, contacts: first.find(f => f.k === s.key)?.n || 0 }))
    .concat(first.filter(f => !known.has(f.k)).map(f => ({ key: f.k || 'unknown', label: f.k || 'Unknown', color: '#94A3B8', contacts: f.n })))
    .filter(x => x.contacts > 0).sort((a, b) => b.contacts - a.contacts);
  // Percentages that add up to exactly 100 (largest remainder).
  if (total) {
    const raw = pie.map(x => (x.contacts / total) * 1000), fl = raw.map(Math.floor);
    let left = 1000 - fl.reduce((s, x) => s + x, 0);
    raw.map((x, i) => [x - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } });
    pie.forEach((x, i) => { x.pct = fl[i] / 10; });
  }
  const bars = sources.map(s => ({ key: s.key, label: s.label, color: s.color, contacts: used.find(u => u.k === s.key)?.n || 0 }))
    .map(x => ({ ...x, pct: pct(x.contacts, total) })).sort((a, b) => b.contacts - a.contacts);

  return Response.json({
    range: r.key, start: r.start, end: r.end, total, canExport: admin.canExport,
    cards: { total, newThisMonth: newMonth, consent, consentPct: pct(consent, total), top: pie[0] || null },
    pie, bars,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
