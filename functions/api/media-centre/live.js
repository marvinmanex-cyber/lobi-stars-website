import { ensureTable, loadMatch, isHomeGame } from '../_lib/matchCentre.js';
import { ensureMatchdaySchema, hasGrant, checkUpdate, applyLiveUpdate, UPDATE_TYPES } from '../_lib/mediaMatchday.js';
import { createItem, submitItem, getItem, mcLog, mediaActor, json, parseJson } from '../_lib/mediaCentre.js';

// Media Centre › Matchday Desk: live updates.
// GET  ?event=<id> -- the match now (status, score, timeline), whether this user's updates post instantly, updates waiting.
// POST { eventId, update: { type, minute, team, player, detail } } -- posts at once with a Super Admin's grant
//      for this match; otherwise it waits in the Approval Queue. Logged either way.
export async function onRequestGet({ request, env, data }) {
  const db = env.DB;
  await ensureTable(db); await ensureMatchdaySchema(db);
  const id = new URL(request.url).searchParams.get('event') || '';
  const m = await loadMatch(db, id);
  if (!m) return json({ error: 'Match not found.' }, 404);
  const waiting = (await db.prepare(`SELECT id, title, submitted_at FROM mc_items WHERE kind = 'live' AND status = 'submitted' AND ref = ? ORDER BY submitted_at`).bind(id).all()).results;
  return json({
    match: { id, home: m.event.home_team, away: m.event.away_team, date: m.event.event_date, isHome: isHomeGame(m.event), status: m.centre?.status || 'scheduled', homeScore: m.centre?.home_score ?? 0, awayScore: m.centre?.away_score ?? 0, timeline: parseJson(m.centre?.timeline_json, []).slice(-30).reverse() },
    granted: await hasGrant(db, id, data.mc.user.id), waiting, types: UPDATE_TYPES,
  });
}

export async function onRequestPost({ request, env, data, waitUntil }) {
  const db = env.DB;
  await ensureTable(db); await ensureMatchdaySchema(db);
  const b = await request.json().catch(() => ({}));
  const m = await loadMatch(db, String(b.eventId || ''));
  if (!m) return json({ error: 'Match not found.' }, 404);
  const c = checkUpdate(b.update);
  if (c.error) return json({ error: c.error }, 400);
  const user = data.mc.user, label = `${m.event.home_team} v ${m.event.away_team}`;
  const meta = { section: 'matchday', itemType: 'match', itemId: m.event.id, itemTitle: label, request };
  const desc = `${c.value.minute ? `${c.value.minute}' ` : ''}${UPDATE_TYPES[c.value.type]}${c.value.player ? `: ${c.value.player}` : ''}${c.value.detail ? ` (${c.value.detail})` : ''}`;
  if (await hasGrant(db, m.event.id, user.id)) {
    const r = await applyLiveUpdate(env, m.event.id, c.value, { by: user.fullName, waitUntil });
    if (!r.ok) return json({ error: r.error }, 400);
    await mcLog(db, mediaActor(user), 'live_update', { ...meta, details: `Pre-approved: ${desc} → ${r.home}-${r.away} (${r.status})` });
    return json({ ok: true, posted: true, score: `${r.home}-${r.away}`, status: r.status });
  }
  const id = await createItem(db, user, 'live', { title: `${label}: ${desc}`, data: { eventId: m.event.id, label, update: c.value }, ref: m.event.id });
  await submitItem(db, user, await getItem(db, id));
  await mcLog(db, mediaActor(user), 'submit', { ...meta, itemType: 'live', itemId: id, details: `Live update waiting for approval: ${desc}` });
  return json({ ok: true, posted: false, waiting: true });
}
