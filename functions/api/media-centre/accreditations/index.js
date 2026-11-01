import { ensureAccreditationSchema, listFor, openMatches, contacts, createInvite, setReopened, ZONES, ROLES } from '../../_lib/mediaAccreditation.js';
import { mcSettings, json } from '../../_lib/mediaCentre.js';

// Media Centre › Accreditation.
// GET  ?event=<id>   -- requests (one match, or all recent), upcoming home matches with counts, settings.
// GET  ?view=contacts -- the media contacts list.
// POST { action: 'invite', eventId, email? } -- an invitation link that prefills the match (emailed if an address is given).
// POST { action: 'reopen', eventId, open } -- open applications again during the closed period (or close them again).
export async function onRequestGet({ request, env }) {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  const u = new URL(request.url);
  if (u.searchParams.get('view') === 'contacts') return json({ contacts: await contacts(db) });
  const settings = await mcSettings(db);
  const matches = await openMatches(db, settings);
  const counts = (await db.prepare(`SELECT event_id, status, COUNT(*) AS n FROM mc_accreditations GROUP BY event_id, status`).all()).results;
  for (const m of matches) { m.counts = {}; for (const c of counts.filter(x => x.event_id === m.id)) m.counts[c.status] = c.n; }
  return json({ matches, requests: await listFor(db, u.searchParams.get('event') || null), zones: ZONES, roles: ROLES, max: Number(settings.accreditation_max), closeHours: Number(settings.accreditation_close_hours) });
}

export async function onRequestPost({ request, env, data }) {
  const b = await request.json().catch(() => ({}));
  if (b.action === 'reopen') { const r = await setReopened(env, request, data.mc.user, String(b.eventId || ''), !!b.open); return r.ok ? json(r) : json({ error: r.error }, 400); }
  if (b.action !== 'invite') return json({ error: 'Unknown action.' }, 400);
  const r = await createInvite(env, request, data.mc.user, String(b.eventId || ''), b.email || '');
  return r.ok ? json(r) : json({ error: r.error }, 400);
}
