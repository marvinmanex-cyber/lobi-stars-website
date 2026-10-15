import { readSession } from '../_lib/session.js';
import { ensureRewardsSchema } from '../_lib/rewards.js';
import { ensureNotifySchema, listNotifications, markRead, savePrefs, emailPrefs, NOTIFY_KINDS } from '../_lib/rewardsNotify.js';

// GET  /api/rewards/notifications -> { items, unread, email: { kind: on/off }, kinds: { kind: label } }
// POST { action: 'read', id? }      -> marks one (or all) as read
// POST { action: 'prefs', email }   -> saves which Rewards emails the fan wants
const headers = { 'Cache-Control': 'no-store' };
async function member(request, env) {
  const memberId = await readSession(request, env.SESSION_SECRET).catch(() => null);
  if (!memberId) return null;
  await ensureRewardsSchema(env.DB);
  await ensureNotifySchema(env.DB);
  return env.DB.prepare(`SELECT member_id, notify_email FROM rewards_members WHERE member_id = ?`).bind(memberId).first();
}

export async function onRequestGet({ request, env }) {
  try {
    const m = await member(request, env);
    if (!m) return Response.json({ error: 'Please log in and join Lobi Stars Rewards.' }, { status: 401, headers });
    const list = await listNotifications(env.DB, m.member_id, 20);
    return Response.json({ ...list, email: emailPrefs(m.notify_email), kinds: Object.fromEntries(Object.entries(NOTIFY_KINDS).map(([k, v]) => [k, v.label])) }, { headers });
  } catch (err) {
    console.error('[rewards] notifications', err);
    return Response.json({ error: 'Could not load your messages.' }, { status: 500, headers });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const m = await member(request, env);
    if (!m) return Response.json({ error: 'Please log in and join Lobi Stars Rewards.' }, { status: 401, headers });
    const b = await request.json().catch(() => ({}));
    if (b.action === 'read') return Response.json({ ok: true, changed: await markRead(env.DB, m.member_id, b.id || null) }, { headers });
    if (b.action === 'prefs') return Response.json({ ok: true, email: await savePrefs(env.DB, m.member_id, b.email || {}) }, { headers });
    return Response.json({ error: 'Unknown action.' }, { status: 400, headers });
  } catch (err) {
    console.error('[rewards] notifications post', err);
    return Response.json({ error: 'Could not save.' }, { status: 500, headers });
  }
}
