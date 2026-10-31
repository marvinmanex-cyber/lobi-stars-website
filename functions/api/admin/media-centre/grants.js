import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureMatchdaySchema, grants } from '../../_lib/mediaMatchday.js';
import { mcLog, adminActor, listUsers, json } from '../../_lib/mediaCentre.js';

// Super Admins: "pre-approved live updates" for a match (the chosen Media Centre
// user's Matchday Desk updates post instantly; still logged).
// GET -- grants, users, upcoming and recent Lobi Stars matches.  POST { action: 'grant' | 'revoke', eventId, userId }
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureMatchdaySchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT id, home_team, away_team, event_date FROM events WHERE active = 1 AND event_date >= ? ORDER BY event_date LIMIT 30`).bind(new Date(Date.now() - 2 * 86400e3).toISOString()).all();
  return json({ grants: await grants(env.DB), users: (await listUsers(env.DB)).filter(u => u.active), matches: results.filter(e => /lobi stars/i.test(`${e.home_team} ${e.away_team}`)) });
}
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureMatchdaySchema(db);
  const b = await request.json().catch(() => ({}));
  const e = await db.prepare(`SELECT id, home_team, away_team FROM events WHERE id = ?`).bind(String(b.eventId || '')).first();
  const u = await db.prepare(`SELECT id, full_name, login_id FROM mc_users WHERE id = ?`).bind(String(b.userId || '')).first();
  if (!e || !u) return json({ error: 'Choose the match and the person.' }, 400);
  const label = `${u.full_name} (${u.login_id}) · ${e.home_team} v ${e.away_team}`;
  if (b.action === 'grant') await db.prepare(`INSERT OR IGNORE INTO mc_live_grants (event_id, user_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`).bind(e.id, u.id, admin.email || admin.name, new Date().toISOString()).run();
  else if (b.action === 'revoke') await db.prepare(`DELETE FROM mc_live_grants WHERE event_id = ? AND user_id = ?`).bind(e.id, u.id).run();
  else return json({ error: 'Unknown action.' }, 400);
  await mcLog(db, adminActor(admin), b.action === 'grant' ? 'grant_live_updates' : 'revoke_live_updates', { section: 'matchday', itemType: 'match', itemId: e.id, itemTitle: label, request });
  await logAdminAction(db, admin, `media_live_${b.action}`, `Media Centre pre-approved live updates ${b.action === 'grant' ? 'granted to' : 'removed from'} ${label}`);
  return json({ ok: true, grants: await grants(db) });
}
