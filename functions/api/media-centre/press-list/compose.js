import { ensurePressSchema, preview, sendTest, createSend, sendBatch, matchLine, TYPES } from '../../_lib/pressList.js';
import { publishedReleases } from '../../_lib/mediaPress.js';
import { isHomeGame } from '../../_lib/matchCentre.js';
import { textOf } from '../../_lib/mediaSanitize.js';
import { rateLimit } from '../../_lib/fans.js';
import { json } from '../../_lib/mediaCentre.js';

// Media Centre › Press List › Send to press list.
// GET  -- published press releases and home matches for the composer.
// POST { action: 'preview' | 'test' | 'create', type, subject, body, emails, eventId?, pressItemId?, attachments?, testTo? }
//      { action: 'batch', id } -- sends the next few emails of a send (the page repeats it until none are left)
export async function onRequestGet({ env }) {
  const db = env.DB;
  await ensurePressSchema(db);
  const releases = (await publishedReleases(db)).slice(0, 60).map(r => ({ id: r.id, headline: r.headline, statement: !!r.statement, publishedAt: r.publishedAt,
    summary: r.subheadline || textOf(r.body).slice(0, 300) }));
  const { results } = await db.prepare(`SELECT * FROM events WHERE active = 1 AND event_date > ? ORDER BY event_date LIMIT 30`).bind(new Date(Date.now() - 86400e3).toISOString()).all();
  const matches = [];
  for (const e of results.filter(isHomeGame)) { const m = await matchLine(db, e.id); matches.push({ id: e.id, line: m.text, link: m.link, upcoming: Date.parse(e.event_date) > Date.now() }); }
  return json({ releases, matches, types: TYPES });
}
export async function onRequestPost({ request, env, data }) {
  const b = await request.json().catch(() => ({}));
  const user = data.mc.user;
  if (b.action === 'batch') { const r = await sendBatch(env, String(b.id || '')); return r.error ? json({ error: r.error }, 404) : json(r); }
  if (!TYPES[b.type]) return json({ error: 'Choose the message type.' }, 400);
  let r;
  if (b.action === 'preview') r = await preview(env, b);
  else if (b.action === 'test') {
    if (!(await rateLimit(env.DB, `presstest:${user.id}`, 20, 3600))) return json({ error: 'Too many test emails in the last hour.' }, 429);
    r = await sendTest(env, user, b, request);
  } else if (b.action === 'create') {
    if (!(await rateLimit(env.DB, `presssend:${user.id}`, 10, 3600))) return json({ error: 'Too many sends in the last hour. Please wait a little.' }, 429);
    r = await createSend(env, user, b, request);
  } else r = { error: 'Unknown action.' };
  return r.ok ? json(r) : json({ error: r.error }, 400);
}
