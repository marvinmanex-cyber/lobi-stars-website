import { ensureShareSchema, escapeHtml as h, escapeAttr as a, validSlug, programmeState, formatDateLagos, formatTimeLagos, shareVersion, SITE } from '../api/_lib/share.js';
import { validSrc, isBotOrPreview, parseDevice, logCampaignEvent } from '../api/_lib/qr.js';
import { withSecurityHeaders } from '../api/_lib/securityHeaders.js';

// GET /m/<slug>?src=<platform>&v=<n> -- the link people share on social media.
// Link-preview robots read the og: tags (title, description, the 1200x630
// card); people are sent straight on to the scan page, where they sign in to
// read or download. The same HTML goes to everyone (no user-agent tricks).
// Drafts, hidden and unknown programmes go to the scan page and reveal nothing.
const toScan = request => new Response(null, { status: 302, headers: { Location: new URL('/programme/scan/', request.url).href, 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env, params, waitUntil }) {
  try {
    const slug = validSlug(String(params.slug || '').toLowerCase());
    if (!slug) return toScan(request);
    const url = new URL(request.url);
    const src = validSrc(url.searchParams.get('src'));
    await ensureShareSchema(env.DB);
    const p = await env.DB.prepare(`SELECT * FROM programmes WHERE slug = ?`).bind(slug).first();
    const state = programmeState(p);
    if (state === 'unavailable') return toScan(request);

    const ua = request.headers.get('User-Agent');
    if (src && !isBotOrPreview(ua, request.method)) {
      const d = parseDevice(ua);
      logCampaignEvent(env, src, 'scan', { programmeId: p.id, device: d.device, inApp: d.inApp }, waitUntil);
    }

    const title = `Match Day Programme: ${p.title}`;
    const when = [p.competition, p.kickoff_at ? formatDateLagos(p.kickoff_at) : '', p.venue].filter(Boolean);
    const desc = state === 'live'
      ? `Free for Lobi Stars fans. Sign in with your email to read online or download the PDF.${when.length ? ` ${[when[0], when.slice(1).join(', ')].filter(Boolean).join(' · ')}.` : ''}`
      : `Drops ${formatDateLagos(p.publish_at)} at ${formatTimeLagos(p.publish_at)}. Register now and it's waiting for you.`;
    const hasCard = p.share_assets_version > 0;
    const img = `${SITE}/m/${slug}/card.jpg?v=${shareVersion(p)}`;
    const target = `/programme/scan/?${new URLSearchParams({ ...(src ? { c: src } : {}), slug }).toString()}`;
    const canonical = `${SITE}${url.pathname}${url.search}`;

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)} | Lobi Stars FC</title>
<meta name="description" content="${a(desc)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Lobi Stars FC">
<meta property="og:title" content="${a(title)}">
<meta property="og:description" content="${a(desc)}">
<meta property="og:url" content="${a(canonical)}">
<meta property="og:image" content="${a(img)}">
${hasCard ? '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n' : ''}<meta property="og:image:alt" content="${a(`${p.title}: Lobi Stars FC Match Day Programme`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${a(title)}">
<meta name="twitter:description" content="${a(desc)}">
<meta name="twitter:image" content="${a(img)}">
<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:#15181D;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:20px;box-sizing:border-box}a{display:inline-block;margin-top:14px;background:#E31E24;color:#fff;padding:14px 26px;border-radius:12px;font-weight:700;text-decoration:none}</style>
</head>
<body>
<main><p>${h(title)}</p><a id="go" href="${a(target)}">Continue</a><noscript><p>Tap Continue to get the programme.</p></noscript></main>
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>
</body>
</html>`;
    return new Response(html, { headers: withSecurityHeaders(new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' })) });
  } catch (err) {
    console.error('[share] page', err);
    return toScan(request);
  }
}
