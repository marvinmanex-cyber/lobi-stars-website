import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureContactsSchema, sourceLabels } from '../../_lib/contacts.js';
import { maskEmail, maskPhone } from '../../_lib/fanQuery.js';

// "Possible duplicates": people already merge automatically when they share
// an email or phone. This finds near-matches that didn't: the same name with
// a very similar email (e.g. a typo, dots, or a different provider for the
// same username). Staff merge them or mark them "keep separate".

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const local = e => String(e || '').toLowerCase().split('@')[0].replace(/\+.*$/, '').replace(/[.\-_]/g, '');
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Why two same-name contacts look like the same person, or null. */
function similar(x, y) {
  if (!x.email || !y.email) return x.email || y.email ? 'Same name; one has no email address' : 'Same name; neither has an email address';
  const lx = local(x.email), ly = local(y.email);
  if (lx && lx === ly) return x.email.split('@')[1] === y.email.split('@')[1] ? 'Same name and email apart from dots or + tags' : 'Same name and email username, different email provider';
  if (lev(x.email.toLowerCase(), y.email.toLowerCase()) <= 2) return 'Same name and almost the same email (possible typo)';
  return null;
}

async function findPairs(db) {
  const { results: groups } = await db.prepare(
    `SELECT lower(trim(COALESCE(first_name,'') || ' ' || COALESCE(surname,''))) AS k, GROUP_CONCAT(id) AS ids FROM contacts
     WHERE COALESCE(first_name,'') != '' AND COALESCE(surname,'') != '' GROUP BY k HAVING COUNT(*) > 1 LIMIT 500`
  ).all();
  const { results: ign } = await db.prepare(`SELECT a, b FROM contact_dup_ignore`).all();
  const ignored = new Set(ign.map(r => `${r.a}|${r.b}`));
  const pairs = [];
  for (const g of groups) {
    const ids = String(g.ids).split(',').slice(0, 20);
    const { results: people } = await db.prepare(`SELECT * FROM contacts WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const [a, b] = [people[i], people[j]].sort((p, q) => (p.id < q.id ? -1 : 1));
      if (ignored.has(`${a.id}|${b.id}`)) continue;
      const why = similar(a, b);
      if (why) pairs.push({ a, b, why, rank: !a.email && !b.email ? 2 : !a.email || !b.email ? 1 : 0 });
      if (pairs.length >= 3000) break;
    }
  }
  // Strongest first: similar emails, then one email missing, then no emails at all
  // (common names without emails would otherwise crowd out the likely matches).
  return pairs.sort((x, y) => x.rank - y.rank).slice(0, 200);
}

// GET /api/admin/fans/duplicates -- pairs to review.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureContactsSchema(db);
  const labels = await sourceLabels(db);
  const pairs = await findPairs(db);
  const srcOf = async id => (await db.prepare(`SELECT DISTINCT source FROM contact_sources WHERE contact_id = ?`).bind(id).all()).results.map(r => labels[r.source] || r.source);
  const view = async c => ({
    id: c.id, name: [c.first_name, c.surname].filter(Boolean).join(' '), state: c.state || '',
    email: admin.canExport ? c.email || '' : maskEmail(c.email), phone: admin.canExport ? c.phone || '' : maskPhone(c.phone),
    firstSeen: c.first_seen, lastSeen: c.last_seen, sources: await srcOf(c.id), consent: !!c.marketing_consent,
  });
  const out = [];
  for (const p of pairs) out.push({ why: p.why, a: await view(p.a), b: await view(p.b) });
  return Response.json({ pairs: out }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST /api/admin/fans/duplicates
//   { action: 'merge', keep, merge }   -- one person: sources and history move to "keep", the other record goes
//   { action: 'separate', a, b }       -- they are different people (never suggested again)
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureContactsSchema(db);
  const b = await request.json().catch(() => ({}));
  if (b.action === 'separate') {
    const [x, y] = [String(b.a || ''), String(b.b || '')].sort();
    if (!x || !y || x === y) return Response.json({ error: 'Choose two contacts.' }, { status: 400 });
    await db.prepare(`INSERT OR IGNORE INTO contact_dup_ignore (a, b, by, at) VALUES (?, ?, ?, ?)`).bind(x, y, admin.name, new Date().toISOString()).run();
    await logAdminAction(db, admin, 'fan_keep_separate', `${x} / ${y}`);
    return Response.json({ ok: true });
  }
  if (b.action !== 'merge') return Response.json({ error: 'Unknown action' }, { status: 400 });
  const keep = await db.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(String(b.keep || '')).first();
  const gone = await db.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(String(b.merge || '')).first();
  if (!keep || !gone || keep.id === gone.id) return Response.json({ error: 'Contact not found.' }, { status: 404 });
  // Combined record: keep the kept person's details, fill gaps from the other,
  // keep the latest non-empty name, earliest first-seen, latest last-seen.
  const newer = (gone.last_seen || '') > (keep.last_seen || '');
  const pick = (a, b2) => (a !== null && a !== undefined && a !== '' ? a : b2);
  const firstEarlier = (gone.first_seen || '9') < (keep.first_seen || '9');
  const merged = {
    first_name: newer ? pick(gone.first_name, keep.first_name) : pick(keep.first_name, gone.first_name),
    surname: newer ? pick(gone.surname, keep.surname) : pick(keep.surname, gone.surname),
    email: pick(keep.email, gone.email), phone: pick(keep.phone, gone.phone), state: pick(keep.state, gone.state),
    first_source: firstEarlier ? gone.first_source : keep.first_source,
    first_seen: firstEarlier ? gone.first_seen : keep.first_seen,
    last_seen: newer ? gone.last_seen : keep.last_seen,
    unsubscribed_at: keep.unsubscribed_at || gone.unsubscribed_at || null,
  };
  // Consent only if one of them gave it and neither has unsubscribed.
  merged.marketing_consent = merged.unsubscribed_at ? 0 : (keep.marketing_consent || gone.marketing_consent ? 1 : 0);
  await db.batch([
    db.prepare(`UPDATE OR IGNORE contact_sources SET contact_id = ? WHERE contact_id = ?`).bind(keep.id, gone.id),
    db.prepare(`DELETE FROM contact_sources WHERE contact_id = ?`).bind(gone.id),
    db.prepare(`DELETE FROM contacts WHERE id = ?`).bind(gone.id),
    db.prepare(`UPDATE contacts SET first_name = ?, surname = ?, email = ?, phone = ?, state = ?, first_source = ?, first_seen = ?, last_seen = ?, marketing_consent = ?, unsubscribed_at = ? WHERE id = ?`)
      .bind(merged.first_name, merged.surname, merged.email, merged.phone, merged.state, merged.first_source, merged.first_seen, merged.last_seen, merged.marketing_consent, merged.unsubscribed_at, keep.id),
  ]);
  await logAdminAction(db, admin, 'fan_merged', `${gone.id} merged into ${keep.id} (${[merged.first_name, merged.surname].filter(Boolean).join(' ')})`);
  return Response.json({ ok: true, id: keep.id });
}
