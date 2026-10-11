import { ensureMatchAlertsSchema, CATEGORIES } from '../_lib/matchAlerts.js';
import { clientIp, rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';

// Match alerts for fans (no account needed):
// GET  /api/push/public-key                     the VAPID key the browser subscribes with
// POST /api/push/subscribe   { subscription, prefs: { radio, match, goals } }   turn on / change
// POST /api/push/status      { endpoint }       is this browser signed up, and for what
// POST /api/push/unsubscribe { endpoint }       turn off
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const cleanPrefs = p => Object.fromEntries(Object.keys(CATEGORIES).map(k => [k, p?.[k] !== false]));

export async function onRequestGet({ env, params }) {
  if (params.action !== 'public-key') return json({ error: 'Not found' }, 404);
  if (!env.VAPID_PUBLIC_KEY) return json({ error: 'Match alerts are not available yet.' }, 503);
  return Response.json({ key: env.VAPID_PUBLIC_KEY }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}

export async function onRequestPost({ request, env, params }) {
  const db = env.DB;
  const b = await request.json().catch(() => ({}));
  await ensureFanSchema(db);
  if (!(await rateLimit(db, `fanpush:${clientIp(request)}`, 30, 3600))) return tooMany();
  await ensureMatchAlertsSchema(db);
  const now = new Date().toISOString();
  if (params.action === 'subscribe') {
    const sub = b.subscription || {};
    if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: 'Your browser could not sign up for alerts. Please try again.' }, 400);
    const prefs = cleanPrefs(b.prefs);
    if (!Object.values(prefs).some(Boolean)) return json({ error: 'Choose at least one kind of alert.' }, 400);
    await db.prepare(`INSERT INTO fan_push_subs (endpoint, keys_json, prefs, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET keys_json = excluded.keys_json, prefs = excluded.prefs, active = 1, updated_at = excluded.updated_at`)
      .bind(sub.endpoint, JSON.stringify({ p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }), JSON.stringify(prefs), now, now).run();
    return json({ ok: true, prefs });
  }
  if (params.action === 'status') {
    const row = await db.prepare(`SELECT prefs, active FROM fan_push_subs WHERE endpoint = ?`).bind(String(b.endpoint || '')).first();
    return json({ subscribed: !!row?.active, prefs: row ? JSON.parse(row.prefs) : cleanPrefs({}) });
  }
  if (params.action === 'unsubscribe') {
    await db.prepare(`UPDATE fan_push_subs SET active = 0, updated_at = ? WHERE endpoint = ?`).bind(now, String(b.endpoint || '')).run();
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
