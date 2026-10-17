import { maybeRunScheduledNewsletters } from './_lib/newsletterSend.js';

// GET /api/health -- for outside uptime monitors (e.g. a free UptimeRobot
// check). 200 { ok: true } when the site and its database answer, else 503.
// No details are revealed.
export async function onRequestGet({ env, waitUntil }) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    await env.DB.prepare('SELECT 1').first();
    // Uptime monitors call this every few minutes: also send any scheduled newsletter that is due.
    try { waitUntil(maybeRunScheduledNewsletters(env)); } catch { /* not important here */ }
    return Response.json({ ok: true, time: new Date().toISOString() }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
