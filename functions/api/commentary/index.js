import { publicCommentaryState } from '../_lib/commentary.js';
import { checkRadioOnAir } from '../_lib/matchAlerts.js';

// GET /api/commentary -- what the Lobi Stars FC Live player needs: on-air
// state, the live/next fixture, upcoming commentary and (ONLY while a match's
// commentary window is open) the stream address on our own domain.
// The answer is the same for every visitor, so it is cached for 15 seconds.
export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/commentary', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const state = await publicCommentaryState(env);
  // When Lobi Stars FC Live goes on air, fans with match alerts get told (once per match).
  if (state.state === 'live') waitUntil(checkRadioOnAir(env, { waitUntil, origin: new URL(request.url).origin }));
  const res = Response.json(state, { headers: { 'Cache-Control': 'public, max-age=15' } });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
