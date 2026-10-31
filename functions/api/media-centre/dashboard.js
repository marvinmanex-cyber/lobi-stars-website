import { dashboard, mcSettings, json } from '../_lib/mediaCentre.js';
import { upcomingDeadlines } from '../_lib/mediaDeadlines.js';

// GET /api/media-centre/dashboard -- the Media Centre home: my drafts, waiting
// for approval, returned to me (with the comment), recently published, deadlines.
export async function onRequestGet({ env, data }) {
  const user = data.mc.user;
  const d = await dashboard(env.DB, user);
  const deadlines = await upcomingDeadlines(env, user, await mcSettings(env.DB)).catch(e => { console.error('[media centre] deadlines', e); return []; });
  return json({ user, ...d, deadlines });
}
