import { runChecks } from '../_lib/uptime.js';
import { healthTick } from '../_lib/healthRun.js';
import { seoTick } from '../_lib/seoRun.js';
import { digestTick } from '../_lib/squadApprovals.js';

// POST /api/internal/health-check -- called every minute by the cron Worker
// (workers/kitchen-cron) with "Authorization: Bearer <CRON_SECRET>".
// - the 5-minute uptime checks (key pages, database, stream on match days);
// - Website Health: one step of the run in progress, or start the hourly full
//   check / the 15-minute matchday quick check, and the 08:00 daily summary.
// - SEO Scanner (when Health is idle): one step of a scan, the 03:00 daily scan,
//   quick scans of newly published pages, the Monday report.
// Answers { more: true } while a run has steps left: the cron Worker then calls
// again straight away (each call is a separate request, so each step stays within
// Cloudflare's per-request limits).
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const origin = new URL(request.url).origin;
  const out = { ok: true };
  try {
    const r = await runChecks(env, origin);
    Object.assign(out, { ran: !!r, opened: r?.opened || [], closed: r?.closed || [] });
  } catch (err) { console.error('[uptime] run', err); out.uptimeError = true; }
  try {
    const h = await healthTick(env, origin);
    out.more = !!h.more;
    out.health = h.run ? { step: h.run.step, steps: h.run.steps, done: h.run.done } : null;
  } catch (err) { console.error('[health] tick', err); out.more = false; }
  // Squad approvals: the Super Admins' email digest (at most every 30 minutes) and 48-hour reminders.
  try { out.squadDigest = await digestTick(env); } catch (err) { console.error('[squad] digest', err); }
  // SEO Scanner: one step when Website Health has nothing running (so one request never does too much).
  if (!out.more) {
    try {
      const s = await seoTick(env, origin);
      out.more = !!s.more;
      out.seo = s.scan ? { step: s.scan.step, steps: s.scan.steps, done: s.scan.done } : null;
    } catch (err) { console.error('[seo] tick', err); }
  }
  return Response.json(out);
}
