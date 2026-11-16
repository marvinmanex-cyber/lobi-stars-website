// IndexNow (free): tells Bing, Yandex, Seznam, Naver and the other IndexNow search engines straight away when a
// page is new or changed, so it's found faster (Google doesn't use IndexNow; it reads sitemap.xml and Search
// Console). The key is public by design: the file /adcccba31ce26c7e0ce2200c59295eab.txt proves the site is ours.
// Called by the SEO Scanner when it sees new or changed pages in sitemap.xml (seoRun.js). Nov 2026.
export const INDEXNOW_KEY = 'adcccba31ce26c7e0ce2200c59295eab';
export async function indexNow(origin, paths) {
  const list = [...new Set(paths)].filter(p => typeof p === 'string' && p.startsWith('/')).slice(0, 1000);
  if (!list.length) return { sent: 0 };
  const host = new URL(origin).host;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: list.map(p => `${origin}${p}`) }),
      signal: AbortSignal.timeout(8000),
    });
    return { sent: list.length, status: res.status };
  } catch (err) { return { sent: 0, error: String(err?.message || err) }; }
}
