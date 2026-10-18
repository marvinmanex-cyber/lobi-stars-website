import { sendAccessReview } from '../_lib/staffLifecycle.js';

// POST /api/internal/access-review -- called every minute by the cron Worker
// ("Authorization: Bearer <CRON_SECRET>"). On the 1st of each month (Nigeria
// time) it emails the Super Admins the monthly access review, once.
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    return Response.json({ ok: true, ...(await sendAccessReview(env, new URL(request.url).origin)) });
  } catch (err) {
    console.error('[access review]', err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
