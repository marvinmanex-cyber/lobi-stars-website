import { scoresGuard, json } from '../../_lib/scores/api.js';
import { listSnapshots } from '../../_lib/scores/consensus.js';

// GET /api/admin/scores/snapshots -- the table saved after each completed
// round (a new version if a later correction changed it).
export async function onRequestGet({ request, env }) {
  const { denied } = await scoresGuard(request, env);
  if (denied) return denied;
  return json({ snapshots: await listSnapshots(env) });
}
