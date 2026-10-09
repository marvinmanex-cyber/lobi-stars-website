import { requireAdmin } from '../../_lib/adminEvents.js';
import { ensureTable, toPublic, parseCentrePayload } from '../../_lib/matchCentre.js';

// GET /api/admin/match-centre/:id -- the match plus its Match Centre data.
export async function onRequestGet({ request, env, params }) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;
  await ensureTable(env.DB);
  const event = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(params.id).first();
  if (!event) return Response.json({ error: 'Match not found' }, { status: 404 });
  const centre = await env.DB.prepare(`SELECT * FROM match_centre WHERE event_id = ?`).bind(params.id).first();
  return Response.json({ match: toPublic(event, centre) });
}

// PUT /api/admin/match-centre/:id -- save status, score, preview, line-ups,
// timeline, report, stats and gallery.
export async function onRequestPut({ request, env, params }) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;
  await ensureTable(env.DB);
  const event = await env.DB.prepare(`SELECT id FROM events WHERE id = ?`).bind(params.id).first();
  if (!event) return Response.json({ error: 'Match not found' }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { value: v } = parseCentrePayload(body);

  await env.DB.prepare(
    `INSERT INTO match_centre
       (event_id, status, home_score, away_score, preview, report, lineups_json, timeline_json, stats_json, gallery_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(event_id) DO UPDATE SET
       status = excluded.status, home_score = excluded.home_score, away_score = excluded.away_score,
       preview = excluded.preview, report = excluded.report, lineups_json = excluded.lineups_json,
       timeline_json = excluded.timeline_json, stats_json = excluded.stats_json,
       gallery_json = excluded.gallery_json, updated_at = excluded.updated_at`
  ).bind(
    params.id, v.status, v.home_score, v.away_score, v.preview, v.report,
    v.lineups_json, v.timeline_json, v.stats_json, v.gallery_json
  ).run();

  return Response.json({ ok: true });
}
