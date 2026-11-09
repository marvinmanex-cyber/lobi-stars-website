// The club's partners (from the built list /data/partners.json), for showing a sponsor's name and
// logo next to things they sponsor, such as a dish on the MatchDay Kitchen menu. Cached for 5 minutes.
let cache = null;
export async function partnerList(env, requestUrl) {
  if (cache && Date.now() - cache.at < 300e3) return cache.list;
  let list = [];
  try { list = await (await env.ASSETS.fetch(new URL('/data/partners.json', requestUrl))).json(); } catch { /* no partners */ }
  cache = { at: Date.now(), list: Array.isArray(list) ? list : [] };
  return cache.list;
}
/** { slug, name, logo } for a partner slug, or null. */
export async function partnerBySlug(env, requestUrl, slug) {
  if (!slug) return null;
  const p = (await partnerList(env, requestUrl)).find(x => x.slug === slug);
  return p ? { slug: p.slug, name: p.name, logo: p.logo || null } : null;
}
