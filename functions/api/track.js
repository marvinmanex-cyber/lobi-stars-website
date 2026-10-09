// POST /api/track -- first-party page views and click events for the admin
// analytics dashboard. Best-effort: it never fails a request and never
// stores an IP address. See functions/api/_lib/analytics.js for the rules.
import { ensureAnalyticsSchema, isBot, browserOf, deviceOf, dailyVisitorHash, EVENT_NAMES } from './_lib/analytics.js';
import { getAdmin } from './_lib/adminSession.js';

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return ok(); }

  const ua = request.headers.get('User-Agent') || '';
  if (isBot(ua)) return ok();
  // Signed-in club staff are not counted.
  try { if (await getAdmin(new Request(request.url, { headers: { Cookie: request.headers.get('Cookie') || '' } }), env)) return ok(); } catch {}

  const path = str(b.path, 512);
  if (!path || !path.startsWith('/') || path.startsWith('/admin') || path === '/scan' || path.startsWith('/scan/')) return ok();

  const consent = b.consent === true;
  const visitorId = consent ? str(b.vid, 40) : '';
  const device = ['mobile', 'tablet', 'desktop'].includes(b.dev) ? b.dev : deviceOf(ua);
  const cf = request.cf || {};
  const country = str(cf.country, 4) || null;
  const region = str(cf.region, 80) || null;

  try {
    await ensureAnalyticsSchema(env.DB);
    const hash = consent ? await dailyVisitorHash(env, request) : null;

    if (b.type === 'event') {
      const name = str(b.name, 40);
      if (!EVENT_NAMES.includes(name)) return ok();
      await env.DB.prepare(
        `INSERT INTO track_events (name, label, path, visitor_key, device, country, region) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(name, str(b.label, 120) || null, path, visitorId || hash, device, country, region).run();
      return ok();
    }

    const utm = b.utm && typeof b.utm === 'object' ? b.utm : {};
    await env.DB.prepare(
      `INSERT INTO pageviews
         (visitor_id, session_id, path, referrer_host, country, city, device, is_new_visitor,
          visitor_hash, consent, region, browser, utm_source, utm_medium, utm_campaign)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      visitorId, consent ? str(b.sid, 40) : '', path, str(b.ref, 255) || null, country, str(cf.city, 120) || null,
      device, consent && b.new ? 1 : 0, hash, consent ? 1 : 0, region, browserOf(ua),
      str(utm.source, 80) || null, str(utm.medium, 80) || null, str(utm.campaign, 120) || null
    ).run();
  } catch {
    // DB hiccup -- analytics must never break the site.
  }
  return ok();
}

function ok() {
  return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
