import { signInState, portalJson } from '../_lib/squadPortal.js';
import settings from '../../../src/data/fan-settings.json';

// GET /api/squad-portal/status -- for the portal sign-in page: is the portal
// open, is the human check needed (after 3 failed sign-ins), is it locked.
export async function onRequestGet({ request, env }) {
  const s = await signInState(env, request);
  return portalJson({ ...s, turnstileSiteKey: s.needTurnstile ? settings.turnstileSiteKey : null });
}
