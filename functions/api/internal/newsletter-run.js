import { runScheduledNewsletters } from '../_lib/newsletterSend.js';
import { mediaCentreTick } from '../_lib/mediaCron.js';

// POST /api/internal/newsletter-run -- sends scheduled newsletters whose time has
// come (and carries on one being sent), and runs the Media Centre's timed jobs
// (scheduled stories, newsletter reminders, the weekly newsletter publishing).
// Called every minute by the cron Worker ("Authorization: Bearer <CRON_SECRET>").
// Until that Worker is deployed, site traffic does the same check at most once
// a minute (maybeRunScheduledNewsletters).
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const media = await mediaCentreTick(env).catch(e => ({ error: String(e?.message || e) }));
  return Response.json({ ok: true, ...(await runScheduledNewsletters(env)), media });
}
