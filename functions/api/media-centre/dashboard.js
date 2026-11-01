import { dashboard, mcSettings, json } from '../_lib/mediaCentre.js';
import { upcomingDeadlines } from '../_lib/mediaDeadlines.js';

// GET /api/media-centre/dashboard -- the Media Centre home: my drafts, waiting
// for approval, returned to me (with the comment), recently published, deadlines.
export async function onRequestGet({ env, data }) {
  const user = data.mc.user;
  const d = await dashboard(env.DB, user);
  const deadlines = await upcomingDeadlines(env, user, await mcSettings(env.DB)).catch(e => { console.error('[media centre] deadlines', e); return []; });
  // Who approved or returned something is never shown in the Media Centre.
  const noDecider = list => (Array.isArray(list) ? list.map(i => ({ ...i, decidedBy: null })) : list);
  for (const k of Object.keys(d)) d[k] = noDecider(d[k]);
  return json({ user, ...d, deadlines });
}
