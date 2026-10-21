import { aiGuard, json } from '../../_lib/aiApi.js';
import { listResults } from '../../_lib/aiFix.js';

// GET /api/admin/ai/results -- Fix results: the figure each applied fix was
// meant to improve, when applied and again after 14 and 30 days.
export async function onRequestGet({ request, env }) {
  const { denied } = await aiGuard(request, env);
  if (denied) return denied;
  return json({ results: await listResults(env) });
}
