// GET /health/ping -- for an outside uptime monitor (UptimeRobot, Better Stack):
// answers "ok" when the website and its database work, nothing else. It is how
// the club hears about the whole site being down, which the site can't report
// itself (DISASTER-RECOVERY.md / STAFF-GUIDE.md › Website Health).
export async function onRequestGet({ env }) {
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  try {
    await env.DB.prepare('SELECT 1').first();
    return new Response('ok', { headers });
  } catch {
    return new Response('down', { status: 503, headers });
  }
}
export const onRequestHead = async ctx => { const r = await onRequestGet(ctx); return new Response(null, { status: r.status, headers: r.headers }); };
