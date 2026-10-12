import { requireAdminUser } from '../../_lib/adminEvents.js';
import { onRequestGet as sitemapXml } from '../../../sitemap.xml.js';

// GET /api/admin/share/pages?q= -- up to 50 of the site's own pages matching
// q, for the "Share any page" search box. Read from this site's sitemap (the
// built pages plus every match page), kept for 10 minutes.
let cache = { at: 0, paths: [] };

async function sitePaths(request, env) {
  if (cache.paths.length && Date.now() - cache.at < 10 * 60_000) return cache.paths;
  const res = await sitemapXml({ request: new Request(new URL('/sitemap.xml', request.url)), env });
  const xml = await res.text();
  const paths = [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => { try { return new URL(m[1]).pathname; } catch { return null; } }).filter(Boolean))];
  cache = { at: Date.now(), paths };
  return paths;
}

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const q = (new URL(request.url).searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
    const words = q.split(/[\s/-]+/).filter(Boolean);
    const all = await sitePaths(request, env);
    const hits = words.length ? all.filter(p => words.every(w => p.toLowerCase().includes(w))) : all;
    return Response.json({ pages: hits.slice(0, 50), total: all.length });
  } catch (err) {
    console.error('[share] pages', err);
    return Response.json({ pages: [], error: 'Could not read the list of pages.' }, { status: 500 });
  }
}
