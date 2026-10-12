import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureProgrammeSchema, programmeSettings, slugify, ensureUniqueSlug, bucket, isLive, cleanDetails } from '../../_lib/programme.js';
import { ensureFanSchema } from '../../_lib/fans.js';
import { ensureContactsSchema } from '../../_lib/contacts.js';

// GET  /api/admin/programmes  -- all programmes with opens/downloads, the fan
//                                 numbers for the top cards and setup status
// POST /api/admin/programmes  -- new draft { title, opponent, competition, venue, kickoffAt, notes }
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureProgrammeSchema(db);
    await ensureFanSchema(db);
    await ensureContactsSchema(db);
    const { results } = await db.prepare(`SELECT p.*,
        (SELECT COUNT(*) FROM programme_events e WHERE e.programme_id = p.id AND e.type = 'open') AS opens,
        (SELECT COUNT(*) FROM programme_events e WHERE e.programme_id = p.id AND e.type = 'download') AS downloads,
        (SELECT COUNT(DISTINCT fan_id) FROM programme_events e WHERE e.programme_id = p.id AND e.fan_id IS NOT NULL) AS readers
      FROM programmes p ORDER BY COALESCE(p.kickoff_at, p.created_at) DESC LIMIT 200`).all();
    const [fans, week, optIn, readers, opens, downloads] = await db.batch([
      db.prepare(`SELECT COUNT(*) AS n FROM members`),
      db.prepare(`SELECT COUNT(*) AS n FROM members WHERE created_at > datetime('now', '-7 days')`),
      db.prepare(`SELECT COUNT(*) AS n FROM members WHERE marketing_opt_in = 1`),
      db.prepare(`SELECT COUNT(DISTINCT contact_id) AS n FROM contact_sources WHERE source = 'programme'`),
      db.prepare(`SELECT COUNT(*) AS n FROM programme_events WHERE type = 'open'`),
      db.prepare(`SELECT COUNT(*) AS n FROM programme_events WHERE type = 'download'`),
    ]);
    const n = r => r.results[0]?.n || 0;
    const now = new Date();
    return Response.json({
      programmes: results.map(p => ({ ...p, live: isLive(p, now) })),
      totals: { fans: n(fans), newThisWeek: n(week), optedIn: n(optIn), programmeReaders: n(readers), opens: n(opens), downloads: n(downloads) },
      settings: await programmeSettings(db),
      storageReady: !!bucket(env),
      canExport: !!admin.canExport,
    });
  } catch (err) {
    console.error('[admin programmes] list', err);
    return Response.json({ error: 'Could not load programmes.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureProgrammeSchema(db);
    const b = await request.json().catch(() => ({}));
    const { value: v, error } = cleanDetails(b);
    if (error) return Response.json({ error }, { status: 400 });
    const slug = await ensureUniqueSlug(db, slugify(v.title, v.kickoffAt));
    const row = await db.prepare(`INSERT INTO programmes (slug, title, opponent, competition, venue, kickoff_at, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(slug, v.title, v.opponent || null, v.competition || null, v.venue || null, v.kickoffAt, v.notes || null, admin.name).first();
    await logAdminAction(db, admin, 'programme_create', `${v.title} (${slug})`);
    return Response.json({ ok: true, id: row.id, slug });
  } catch (err) {
    console.error('[admin programmes] create', err);
    return Response.json({ error: 'Could not create the programme.' }, { status: 500 });
  }
}
