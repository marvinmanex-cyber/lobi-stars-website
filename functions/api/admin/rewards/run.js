import { requireAdminUser } from '../../_lib/adminEvents.js';
import { rewardsSweep } from '../../_lib/rewardsEarn.js';

// POST /api/admin/rewards/run -- runs the Rewards job now (normally every 10
// minutes from the cron Worker): ticket points of played matches become
// available, Predict & Win results and birthday bonuses are added.
export async function onRequestPost({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    return Response.json({ ok: true, ...(await rewardsSweep(env)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[rewards admin] run', err);
    return Response.json({ error: 'Could not run the job.' }, { status: 500 });
  }
}
