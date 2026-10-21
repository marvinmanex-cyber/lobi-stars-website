import { addReport } from '../_lib/scores/model.js';

// POST /api/scores/commentary -- Commentary Assist: the commentary partner's
// system sends scores (our match and other games) with
// "Authorization: Bearer <COMMENTARY_ASSIST_SECRET>".
// Body: { fixtureId? | home, away, homeGoals, awayGoals, status, minute? }
//   status: LIVE, HALF_TIME, FULL_TIME, POSTPONED or ABANDONED.
// Each report is one Commentary Assist source (it counts once, however often it sends).
export async function onRequestPost({ request, env }) {
  if (!env.COMMENTARY_ASSIST_SECRET) return Response.json({ error: 'Commentary Assist is not set up (COMMENTARY_ASSIST_SECRET).' }, { status: 503 });
  if (request.headers.get('Authorization') !== `Bearer ${env.COMMENTARY_ASSIST_SECRET}`) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const b = await request.json().catch(() => null);
  if (!b) return Response.json({ error: 'Send JSON.' }, { status: 400 });
  const items = Array.isArray(b.matches) ? b.matches.slice(0, 20) : [b];
  const out = [];
  for (const m of items) {
    const r = await addReport(env, { sourceType: 'COMMENTARY_ASSIST', identity: 'commentary', label: 'Commentary Assist', fixtureId: m.fixtureId || null,
      homeName: m.home, awayName: m.away, homeGoals: m.homeGoals, awayGoals: m.awayGoals, status: m.status, minute: m.minute, raw: m });
    out.push(r.error ? { error: r.error } : { id: r.id, fixtureId: r.fixtureId, needsReview: r.needsReview, state: r.state });
  }
  return Response.json({ ok: true, results: out }, { status: out.every(x => x.error) ? 400 : 200 });
}
