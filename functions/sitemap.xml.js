import { ensureTable } from './api/_lib/matchCentre.js';
import { matchSlug } from './api/_lib/matchSlug.js';

// /sitemap.xml -- the build's list of pages (drafts, admin and noindex pages
// are already left out) plus every active match page, which are made on the
// server from the fixtures in the database.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const res = await env.ASSETS.fetch(new URL('/sitemap.xml', url));
  let xml = await res.text();
  try {
    await ensureTable(env.DB);
    const { results } = await env.DB.prepare(`SELECT * FROM events WHERE active = 1 ORDER BY event_date`).all();
    const entries = results.map(e => `  <url><loc>https://lobistarsfc.com/matches/${matchSlug(e)}/</loc><lastmod>${String(e.updated_at || e.event_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10)}</lastmod></url>`);
    if (entries.length) xml = xml.replace('</urlset>', `${entries.join('\n')}\n</urlset>`);
  } catch (err) { console.log("[sitemap] matches skipped:", err.message); }
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}
