import { calendar, saveEntry } from '../_lib/mediaCalendar.js';
import { json } from '../_lib/mediaCentre.js';

// Media Centre › Content Calendar.
// GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD -- match days, newsletter Wednesdays and planned items.
// POST { id?, title, type, notes, assigneeId, dueAt, status, itemId?, eventId? } | { action: 'delete', id }
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('from') || '') ? `${u.searchParams.get('from')}T00:00:00.000Z` : new Date(Date.now() - 7 * 86400e3).toISOString();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('to') || '') ? `${u.searchParams.get('to')}T23:59:59.999Z` : new Date(Date.now() + 42 * 86400e3).toISOString();
  return json(await calendar(env.DB, from, to));
}
export async function onRequestPost({ request, env, data }) {
  const b = await request.json().catch(() => ({}));
  const r = await saveEntry(env, request, data.mc.user, b);
  return r.ok ? json(r) : json({ error: r.error }, 400);
}
