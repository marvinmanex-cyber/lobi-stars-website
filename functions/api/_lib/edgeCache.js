// Short-lived copies of public pages in Cloudflare's own cache (free), so a page that is the same for every
// visitor isn't rebuilt from the database on each visit (faster first byte, fewer database reads; Nov 2026).
// Only for GET pages that never differ per visitor. Tracking parameters (utm_*, fbclid, gclid) share one copy.
// Live details on these pages refresh themselves in the browser, so a copy a minute or two old is fine.
export async function edgeCached(request, waitUntil, ttlSeconds, build) {
  // Not cached for the SEO Scanner's own checks ("Check again" must see the newest page).
  if (request.method !== 'GET' || /SEOScanner/i.test(request.headers.get('User-Agent') || '')) return build();
  const u = new URL(request.url);
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_)/i.test(k)) u.searchParams.delete(k);
  const key = new Request(u.toString());
  const cache = caches.default;
  try { const hit = await cache.match(key); if (hit) return hit; } catch { /* no cache: build the page */ }
  const res = await build();
  if (res.status !== 200 || /no-store|private/i.test(res.headers.get('Cache-Control') || '')) return res;
  const body = await res.arrayBuffer();
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', `public, max-age=${Math.min(60, ttlSeconds)}, s-maxage=${ttlSeconds}`);
  const out = new Response(body, { status: 200, headers });
  try { const put = cache.put(key, out.clone()); if (waitUntil) waitUntil(put); else await put; } catch { /* serving still works */ }
  return out;
}
