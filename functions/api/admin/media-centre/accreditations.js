import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureAccreditationSchema, listFor, revoke } from '../../_lib/mediaAccreditation.js';
import { json } from '../../_lib/mediaCentre.js';

// Super Admins: every accreditation (newest first) and Revoke.
// GET -- the list with the match names.  POST { id, reason } -- revoke an approved accreditation (emailed).
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureAccreditationSchema(env.DB);
  const list = await listFor(env.DB, null);
  const ids = [...new Set(list.map(x => x.eventId))];
  const names = {};
  for (const id of ids.slice(0, 40)) { const e = await env.DB.prepare(`SELECT home_team, away_team, event_date FROM events WHERE id = ?`).bind(id).first(); if (e) names[id] = { label: `${e.home_team} v ${e.away_team}`, date: e.event_date }; }
  return json({ accreditations: list.map(x => ({ ...x, phone: undefined, match: names[x.eventId] || null })) });
}
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const r = await revoke(env, request, admin, String(b.id || ''), b.reason);
  if (r.ok) await logAdminAction(env.DB, admin, 'approval_media_revoke_accreditation', `Revoked media accreditation ${b.id}: ${String(b.reason || '').slice(0, 120)}`);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
}
