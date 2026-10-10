// Option B: relays the partner's stream (PARTNER_ORIGIN_STREAM_URL, server
// only) through lobistarsfc.com, so the browser only ever talks to our
// domain. Audio is passed straight through as it arrives (nothing is
// buffered or stored); partner headers and ICY titles are replaced with
// "Lobi Stars FC Live"; HLS playlists are rewritten so every segment also
// comes through here. It only plays while a match's commentary window is
// open, and it refuses new listeners above the configured limit.
import { getSettings, commentaryFixtures, commentaryState, liveListeners, relayHeaders, isPlaylist, rewritePlaylist, encodeToken } from '../../api/_lib/commentary.js';

// Settings + on-air state, cached briefly per worker so HLS segment requests don't hit the database each time.
let cached = { at: 0, value: null };
async function onAir(env) {
  if (Date.now() - cached.at < 15_000 && cached.value) return cached.value;
  const s = await getSettings(env);
  const st = s.enabled ? commentaryState(await commentaryFixtures(env.DB)) : { state: 'off' };
  cached = { at: Date.now(), value: { s, st } };
  return cached.value;
}

const plain = (status, text) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function relay(env, target, { checkLimit }) {
  if (!env.PARTNER_ORIGIN_STREAM_URL) return plain(404, 'Lobi Stars FC Live is not set up yet.');
  const { s, st } = await onAir(env);
  if (!s.enabled) return plain(503, 'Lobi Stars FC Live is switched off.');
  if (st.state !== 'live') return plain(403, 'Lobi Stars FC Live is off air. Commentary starts shortly before each match.');
  if (checkLimit && (await liveListeners(env.DB, st.fixture.id)) >= s.maxListeners) {
    return plain(503, 'Lobi Stars FC Live is full right now. Please try again in a few minutes.');
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      // Icy-MetaData: 0 asks Icecast/Shoutcast servers not to insert song/station titles into the audio.
      headers: { 'User-Agent': 'LobiStarsFCLive/1.0', 'Icy-MetaData': '0', Accept: '*/*' },
      redirect: 'follow',
    });
  } catch {
    return plain(502, 'Lobi Stars FC Live is reconnecting. Please try again.');
  }
  if (!upstream.ok || !upstream.body) return plain(502, 'Lobi Stars FC Live is reconnecting. Please try again.');

  const type = upstream.headers.get('Content-Type') || '';
  if (isPlaylist(target, type)) {
    const text = await rewritePlaylist(await upstream.text(), upstream.url || target, url => encodeToken(env, url));
    const h = relayHeaders(upstream.headers, s.brand);
    h.set('Content-Type', 'application/vnd.apple.mpegurl');
    h.delete('Content-Length');
    return new Response(text, { headers: h });
  }
  // Pass the audio through chunk by chunk for as long as the listener stays connected.
  return new Response(upstream.body, { headers: relayHeaders(upstream.headers, s.brand) });
}
