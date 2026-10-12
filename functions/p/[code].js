import { ensureQrSchema, isBotOrPreview, parseDevice, logCampaignEvent } from '../api/_lib/qr.js';

// GET /p/<code> -- the short link inside every QR advert (e.g. lobistarsfc.com/p/gate).
// Counts the scan (not link previews or robots) and always sends the fan on to
// the scan page with a 302, so the destination can change later. Never a dead
// end: an unknown or switched-off code, or a database problem, still lands on
// /programme/scan (without the campaign).
const go = (request, code) => new Response(null, {
  status: 302,
  headers: { Location: new URL(code ? `/programme/scan/?c=${encodeURIComponent(code)}` : '/programme/scan/', request.url).href, 'Cache-Control': 'no-store' },
});

export async function onRequestGet({ request, env, params, waitUntil }) {
  let code = null;
  try {
    const want = String(params.code || '').toLowerCase().slice(0, 20);
    await ensureQrSchema(env.DB);
    const c = await env.DB.prepare(`SELECT code FROM qr_campaigns WHERE code = ?`).bind(want).first();
    if (c) {
      code = c.code;
      const ua = request.headers.get('User-Agent');
      if (!isBotOrPreview(ua, request.method)) {
        const d = parseDevice(ua);
        logCampaignEvent(env, code, 'scan', { device: d.device, inApp: d.inApp }, waitUntil);
      }
    }
  } catch (err) {
    console.error('[qr] scan', err);
  }
  return go(request, code);
}

// HEAD and anything else: no counting, same redirect.
export async function onRequest({ request, params }) {
  const code = /^[a-z0-9-]{1,20}$/.test(String(params.code || '').toLowerCase()) ? String(params.code).toLowerCase() : null;
  return go(request, code);
}
