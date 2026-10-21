import { scoresGuard, json } from '../../_lib/scores/api.js';
import { getScoreSettings, saveScoreSettings, SCORE_SETTINGS } from '../../_lib/scores/consensus.js';

// GET / PUT /api/admin/scores/settings -- grace window, missing-result reminder,
// "show unconfirmed scores", licensed API check intervals, daily summary.
export async function onRequestGet({ request, env }) {
  const { denied } = await scoresGuard(request, env);
  if (denied) return denied;
  const v = await getScoreSettings(env);
  return json({ settings: Object.entries(SCORE_SETTINGS).map(([key, s]) => ({ key, label: s.label, bool: !!s.bool, min: s.min, max: s.max, value: v[key] })), lastRun: v._last_tick || null });
}
export async function onRequestPut({ request, env }) {
  const { admin, denied } = await scoresGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const r = await saveScoreSettings(env, admin, b.settings || b);
  return r.error ? json(r, 400) : json(r);
}
