import { relay } from '../_relay.js';
import { decodeToken } from '../../../api/_lib/commentary.js';

// GET /live/commentary/x/<token> -- an HLS segment, key or sub-playlist.
// The token is an encrypted address made by the relay, so the partner's
// address is never visible to the browser.
export async function onRequestGet({ env, params }) {
  const target = await decodeToken(env, String(params.token || ''));
  if (!target || !/^https?:\/\//.test(target)) return new Response('Not found', { status: 404 });
  return relay(env, target, { checkLimit: false });
}
