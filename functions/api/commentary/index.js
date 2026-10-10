import { getSettings, commentaryFixtures, commentaryState, commentaryWindow, publicFixture } from '../_lib/commentary.js';

// GET /api/commentary -- what the Lobi Stars FC Live player needs: on-air
// state, the live/next fixture, upcoming commentary and (ONLY while a match's
// commentary window is open) the stream address on our own domain.
// The answer is the same for every visitor, so it is cached for 15 seconds.
export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/commentary', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const s = await getSettings(env);
  const now = Date.now();
  const rows = s.enabled ? await commentaryFixtures(env.DB) : [];
  const st = commentaryState(rows, now);
  const live = s.enabled && st.state === 'live' && !!s.streamUrl;
  const upcoming = rows
    .map(r => ({ r, w: commentaryWindow(r) }))
    .filter(x => x.w && x.w.start > now && x.w.end > now)
    .slice(0, 6)
    .map(x => publicFixture(x.r, x.w));

  const res = Response.json({
    enabled: s.enabled,
    brand: s.brand,
    state: !s.enabled ? 'off' : st.state === 'live' && !s.streamUrl ? 'off' : st.state,
    fixture: st.fixture ? publicFixture(st.fixture, st.window) : null,
    streamUrl: live ? s.streamUrl : null,
    backupUrl: live && s.backupUrl ? s.backupUrl : null,
    commentators: s.commentators || null,
    upcoming,
    serverTime: new Date(now).toISOString(),
  }, { headers: { 'Cache-Control': 'public, max-age=15' } });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
