// POST /api/track -- first-party page-view logging for the admin analytics
// dashboard. Deliberately tiny and best-effort: it never fails a request
// and stores no IP address or personal data. The browser sends a random
// visitor id, a session id, the path, the referrer host and a device
// class; country/city come from Cloudflare's edge metadata.

export async function onRequestPost({ request, env }) {
  let b;
  try {
    b = await request.json();
  } catch {
    return ok();
  }

  const path = str(b.path, 512);
  // Don't log staff-only areas.
  if (!path || !path.startsWith('/') || path.startsWith('/admin') || path === '/scan') return ok();

  const visitorId = str(b.vid, 40);
  const sessionId = str(b.sid, 40);
  if (!visitorId || !sessionId) return ok();

  const referrerHost = str(b.ref, 255) || null;
  const device = ['mobile', 'tablet', 'desktop'].includes(b.dev) ? b.dev : null;
  const isNew = b.new ? 1 : 0;

  const cf = request.cf || {};
  const country = str(cf.country, 4) || null;
  const city = str(cf.city, 120) || null;

  try {
    await env.DB.prepare(
      `INSERT INTO pageviews
         (visitor_id, session_id, path, referrer_host, country, city, device, is_new_visitor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(visitorId, sessionId, path, referrerHost, country, city, device, isNew).run();
  } catch {
    // Table missing / DB hiccup -- analytics must never break the site.
  }
  return ok();
}

function ok() {
  return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
