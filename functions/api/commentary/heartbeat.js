import { getSettings, commentaryFixtures, commentaryState, recordHeartbeat } from '../_lib/commentary.js';
import { recordServerEvent, isBot } from '../_lib/analytics.js';
import { getAdmin } from '../_lib/adminSession.js';

// POST /api/commentary/heartbeat { sid } -- sent every 60 seconds by a
// playing Lobi Stars FC Live player. Feeds the live listener count, the
// listener limit, peak listeners and listening time. No personal data:
// `sid` is a random id made by the player for this listening session.
export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const sid = typeof b.sid === 'string' && /^[a-z0-9]{8,40}$/i.test(b.sid) ? b.sid : null;
  if (!sid) return Response.json({ error: 'Invalid session' }, { status: 400 });
  if (isBot(request.headers.get('User-Agent') || '')) return Response.json({ ok: true });

  const s = await getSettings(env);
  if (!s.enabled) return Response.json({ ok: false, state: 'off' });
  const st = commentaryState(await commentaryFixtures(env.DB));
  if (st.state !== 'live') return Response.json({ ok: false, state: st.state });

  // Signed-in staff listening in aren't counted.
  if (await getAdmin(new Request(request.url, { headers: { Cookie: request.headers.get('Cookie') || '' } }), env).catch(() => null)) {
    return Response.json({ ok: true, state: 'live' });
  }
  const listeners = await recordHeartbeat(env.DB, sid, st.fixture.id);
  await recordServerEvent(env, 'commentary_heartbeat', st.fixture.id, request);
  return Response.json({ ok: true, state: 'live', counted: listeners > 0 }, { headers: { 'Cache-Control': 'no-store' } });
}
