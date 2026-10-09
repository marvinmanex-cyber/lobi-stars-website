// Shared by the Matchday Live fan features (Man of the Match, Predict & Win).
import { ensureTable, loadMatch, toPublic, isHomeGame } from './matchCentre.js';
import { matchSlug } from './matchSlug.js';
import { readSession } from './session.js';
import { ensureFanSchema } from './fans.js';

/** The public match for a slug or id, only if it's an active Lobi Stars HOME game. */
export async function findHomeMatch(env, slug) {
  await ensureTable(env.DB);
  const key = String(slug || '').toLowerCase();
  const { results } = await env.DB.prepare(`SELECT * FROM events WHERE active = 1`).all();
  const event = results.find(e => e.id.toLowerCase() === key || matchSlug(e) === key);
  if (!event || !isHomeGame(event)) return null;
  const m = await loadMatch(env.DB, event.id); // also applies the 2h15 auto-close
  return toPublic(m.event, m.centre);
}

/** The signed-in fan (members row) or null. */
export async function currentFan(request, env) {
  const id = await readSession(request, env.SESSION_SECRET);
  if (!id) return null;
  await ensureFanSchema(env.DB);
  return env.DB.prepare(`SELECT id, first_name, last_name, email_verified, COALESCE(is_staff, 0) AS is_staff FROM members WHERE id = ?`).bind(id).first();
}
