// Final-score reminder for the Super Admins. If a Lobi Stars home game has no final score entered
// by 1 hour 55 minutes after kick-off (5:55pm for a 4pm game), every admin page a Super Admin has open
// shows a red, beeping alert until the score is entered (End Match, or Live Match Control) or a Super
// Admin dismisses it. Predict & Win results only show to fans once the score is in.
//   GET  /api/admin/score-reminder          -> { due: [{ id, label, kickoff, since }] } (empty for other staff)
//   POST /api/admin/score-reminder {id, action: 'dismiss'}
import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { ensureTable, isHomeGame } from '../_lib/matchCentre.js';
import { ensurePredictSchema } from '../_lib/predict.js';

export const REMIND_AFTER_MIN = 115;
const isSuper = a => a.role === 'super_admin' || a.role === 'owner';
let ready = false;
async function ensure(db) {
  await ensureTable(db); await ensurePredictSchema(db);
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS score_reminder_dismissed (event_id TEXT PRIMARY KEY, by_name TEXT, at TEXT NOT NULL)`).run();
  ready = true;
}

/** Home games past the reminder time with no final score (no Predict & Win result yet), not dismissed. */
export async function dueReminders(db, now = Date.now()) {
  await ensure(db);
  const { results } = await db.prepare(
    `SELECT e.* FROM events e
     LEFT JOIN match_centre m ON m.event_id = e.id
     LEFT JOIN prediction_results r ON r.event_id = e.id
     LEFT JOIN score_reminder_dismissed d ON d.event_id = e.id
     WHERE e.active = 1 AND r.event_id IS NULL AND d.event_id IS NULL
       AND COALESCE(m.status, 'scheduled') NOT IN ('postponed', 'cancelled')
       AND e.event_date <= ? AND e.event_date >= ?`
  ).bind(new Date(now - REMIND_AFTER_MIN * 60e3).toISOString(), new Date(now - 3 * 86400e3).toISOString()).all();
  return results.filter(isHomeGame).map(e => ({
    id: e.id, label: `${e.home_team} v ${e.away_team}`, kickoff: e.event_date,
    since: new Date(Date.parse(e.event_date) + REMIND_AFTER_MIN * 60e3).toISOString(),
  }));
}

export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { allowRestricted: true });
  if (denied) return denied;
  if (!isSuper(admin)) return Response.json({ due: [] }, { headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ due: await dueReminders(env.DB) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  if (!isSuper(admin)) return Response.json({ error: 'Only a Super Admin can dismiss this reminder.' }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  if (b.action !== 'dismiss') return Response.json({ error: 'Unknown action.' }, { status: 400 });
  await ensure(env.DB);
  const e = await env.DB.prepare(`SELECT home_team, away_team FROM events WHERE id = ?`).bind(String(b.id || '')).first();
  if (!e) return Response.json({ error: 'Match not found.' }, { status: 404 });
  await env.DB.prepare(`INSERT INTO score_reminder_dismissed (event_id, by_name, at) VALUES (?, ?, ?) ON CONFLICT (event_id) DO NOTHING`).bind(String(b.id), admin.name, new Date().toISOString()).run();
  await logAdminAction(env.DB, admin, 'score_reminder_dismissed', `${e.home_team} v ${e.away_team}: final-score reminder dismissed`);
  return Response.json({ ok: true });
}
