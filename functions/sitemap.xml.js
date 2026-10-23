import { ensureTable } from './api/_lib/matchCentre.js';
import { matchSlug } from './api/_lib/matchSlug.js';

// /sitemap.xml -- the build's list of pages (drafts, admin and noindex pages
// are already left out) plus every active match page, which are made on the
// server from the fixtures in the database.
// Kept in Cloudflare's edge cache for 10 minutes (23 Oct 2026): Google once got a
// "temporary processing error" when a busy moment went over the free plan's
// computing limit; a cached copy needs no computing at all.
export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const key = new Request(`${url.origin}/sitemap.xml`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return hit;
  const res = await env.ASSETS.fetch(new URL('/sitemap.xml', url));
  let xml = await res.text();
  try {
    await ensureTable(env.DB);
    const { results } = await env.DB.prepare(`SELECT * FROM events WHERE active = 1 ORDER BY event_date`).all();
    const entries = results.map(e => `  <url><loc>https://lobistarsfc.com/matches/${matchSlug(e)}/</loc><lastmod>${String(e.updated_at || e.event_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10)}</lastmod></url>`);
    if (entries.length) xml = xml.replace('</urlset>', `${entries.join('\n')}\n</urlset>`);
  } catch (err) { console.log("[sitemap] matches skipped:", err.message); }
  const out = new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
  if (cache) { const p = cache.put(key, out.clone()).catch(() => null); if (waitUntil) waitUntil(p); }
  return out;
}
