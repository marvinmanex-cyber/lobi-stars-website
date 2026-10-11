import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { pushReady } from '../../_lib/foodAlerts.js';
import { ensureMatchAlertsSchema, alertSettings, saveAlertSettings, createJob, runFanPush, CATEGORIES, AUTO_KINDS } from '../../_lib/matchAlerts.js';

// Admin › Matchday › Fan Match Alerts.
// GET  /api/admin/fan-alerts   automatic alert switches, how many fans signed up (by kind), recent alerts and progress
// POST /api/admin/fan-alerts
//   { settings: { radio_live, kickoff, halftime, second_half, fulltime, goal } }
//   { send: { category, title, body, url } }   an alert written by staff (e.g. "Pre-match show starts in 10 minutes")
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureMatchAlertsSchema(db);
  const { results: subs } = await db.prepare(`SELECT prefs FROM fan_push_subs WHERE active = 1`).all();
  const counts = { total: subs.length, ...Object.fromEntries(Object.keys(CATEGORIES).map(k => [k, 0])) };
  for (const s of subs) { try { const p = JSON.parse(s.prefs); for (const k of Object.keys(CATEGORIES)) if (p[k] !== false) counts[k]++; } catch {} }
  const { results: jobs } = await db.prepare(`SELECT id, kind, category, event_id, title, body, created_at, created_by, sent, failed, done_at FROM fan_push_jobs ORDER BY id DESC LIMIT 30`).all();
  return json({ settings: await alertSettings(db), kinds: AUTO_KINDS, categories: CATEGORIES, counts, jobs, pushReady: pushReady(env), cron: !!env.CRON_SECRET });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  const b = await request.json().catch(() => ({}));
  if (b.settings) {
    const s = await saveAlertSettings(db, b.settings, admin.name);
    await logAdminAction(db, admin, 'fan_alert_settings', Object.entries(s).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all on');
    return json({ ok: true, settings: s });
  }
  if (b.send) {
    const category = CATEGORIES[b.send.category] ? b.send.category : 'match';
    const title = String(b.send.title || '').trim().slice(0, 100);
    const body = String(b.send.body || '').trim().slice(0, 200);
    const url = /^\/(?!\/)[^\s]*$/.test(String(b.send.url || '')) ? b.send.url : '/';
    if (!title) return json({ error: 'Please write the alert title.' }, 400);
    if (!pushReady(env)) return json({ error: 'Match alerts are not set up on the server yet (VAPID keys).' }, 503);
    const id = await createJob(db, { kind: 'custom', category, title, body, url, by: admin.name });
    await logAdminAction(db, admin, 'fan_alert_send', `${title} (${CATEGORIES[category]})`);
    const job = runFanPush(env, { origin: new URL(request.url).origin });
    if (waitUntil) waitUntil(job); else await job;
    return json({ ok: true, id });
  }
  return json({ error: 'Nothing to do' }, 400);
}
