import { leagueAuth, body, ok, fail } from '../../_lib/leagueAdmin.js';
import { logLeague, syncEvent } from '../../_lib/leagueDb.js';

// GET   /api/admin/league/venues
// POST  /api/admin/league/venues { name, city? }
// PATCH /api/admin/league/venues { id, name?, city? }
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  return ok({ venues: (await env.DB.prepare(`SELECT * FROM league_venues ORDER BY name`).all()).results });
}

export async function onRequestPost({ request, env }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  const b = (await body(request)) || {};
  const name = clean(b.name, 100), city = clean(b.city, 60) || null;
  if (name.length < 3) return fail('Enter the stadium name.');
  if (await env.DB.prepare(`SELECT id FROM league_venues WHERE name = ?`).bind(name).first()) return fail('This venue already exists.', 409);
  const r = await env.DB.prepare(`INSERT INTO league_venues (name, city) VALUES (?, ?)`).bind(name, city).run();
  await logLeague(env.DB, staff, 'venue.add', 'venue', r.meta.last_row_id, null, { name, city });
  return ok({ id: r.meta.last_row_id });
}

export async function onRequestPatch({ request, env }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  const db = env.DB;
  const b = (await body(request)) || {};
  const v = await db.prepare(`SELECT * FROM league_venues WHERE id = ?`).bind(Number(b.id)).first();
  if (!v) return fail('Venue not found.', 404);
  const name = b.name === undefined ? v.name : clean(b.name, 100);
  const city = b.city === undefined ? v.city : clean(b.city, 60) || null;
  if (name.length < 3) return fail('Enter the stadium name.');
  if (name !== v.name && await db.prepare(`SELECT id FROM league_venues WHERE name = ? AND id <> ?`).bind(name, v.id).first()) return fail('Another venue has this name.', 409);
  await db.prepare(`UPDATE league_venues SET name = ?, city = ? WHERE id = ?`).bind(name, city, v.id).run();
  await logLeague(db, staff, 'venue.update', 'venue', v.id, v, { ...v, name, city });
  const { results } = await db.prepare(`SELECT id FROM league_fixtures WHERE venue_id = ? AND event_id IS NOT NULL`).bind(v.id).all();
  for (const f of results) await syncEvent(env, f.id);
  return ok();
}
