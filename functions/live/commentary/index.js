import { relay } from './_relay.js';

// GET /live/commentary -- the Lobi Stars FC Live stream (Option B relay).
export async function onRequestGet({ env }) {
  return relay(env, env.PARTNER_ORIGIN_STREAM_URL, { checkLimit: true });
}
