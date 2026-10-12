import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ownPageUrl, siteHosts, parseHead, cardWarnings, buildPageCaption, shareHashtags, withUtm, CLUB_PLATFORMS } from '../../_lib/pageShare.js';

// GET /api/admin/share/preview?url= -- how a page of OUR site will look as a
// link card, with a checklist. Safe by design: only our own host name, at most
// 3 redirects (same host only), 6 seconds, 1.5 MB, HTML only.
const MAX_BYTES = 1.5 * 1024 * 1024;

async function readLimited(res, max) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch {} break; }
    chunks.push(value);
  }
  return new TextDecoder().decode(chunks.length === 1 ? chunks[0] : new Uint8Array(chunks.reduce((a, c) => { const n = new Uint8Array(a.length + c.length); n.set(a); n.set(c, a.length); return n; }, new Uint8Array())));
}

/** Fetch an address of our own site, following up to 3 same-host redirects. */
async function fetchOwn(url, request, env, accept) {
  const hosts = siteHosts(request);
  let current = new URL(url), redirects = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(current.toString(), { redirect: 'manual', headers: { 'User-Agent': 'facebookexternalhit/1.1 (LobiStarsShareCheck)', Accept: accept }, signal: AbortSignal.timeout(6000) });
    } catch {
      // Reaching our own host name from inside the Function failed: read the static file instead.
      if (env.ASSETS && hosts.has(current.hostname)) res = await env.ASSETS.fetch(new Request(new URL(current.pathname + current.search, request.url), { headers: { Accept: accept } }));
      else throw new Error('Could not reach the page.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
      const next = new URL(res.headers.get('Location'), current);
      if (!hosts.has(next.hostname)) return { res, url: current, redirects, offsite: next.toString() };
      if (++redirects > 3) throw new Error('Too many redirects.');
      current = next;
      continue;
    }
    return { res, url: current, redirects };
  }
}

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get('url');
  const page = ownPageUrl(raw, request);
  if (!page) return Response.json({ error: 'Enter an address on lobistarsfc.com (starting with https://), or a page path like /news/.' }, { status: 400 });
  try {
    const { res, url, offsite } = await fetchOwn(page, request, env, 'text/html');
    if (offsite) return Response.json({ error: 'That page redirects to another website.' }, { status: 400 });
    const type = res.headers.get('Content-Type') || '';
    if (!/text\/html/i.test(type)) return Response.json({ error: 'That address is not a web page.' }, { status: 400 });
    const html = await readLimited(res, MAX_BYTES);
    const head = parseHead(html, url.toString());
    const signIn = /\/(fans\/login|admin\/login|programme\/join)/.test(url.pathname) || (url.pathname !== page.pathname && /login|sign-?in/i.test(url.pathname));

    let imageBytes = null, imageType = null;
    if (head.image) {
      try {
        const img = new URL(head.image);
        if (siteHosts(request).has(img.hostname)) {
          const r = await fetchOwn(img, request, env, 'image/*');
          if (r.res.ok && !r.offsite) {
            imageType = (r.res.headers.get('Content-Type') || '').split(';')[0] || null;
            const len = Number(r.res.headers.get('Content-Length'));
            imageBytes = len > 0 ? len : (await r.res.arrayBuffer()).byteLength;
          }
        }
      } catch { /* reported as "could not check" */ }
    }
    const warnings = cardWarnings({ status: res.status, signIn, head, imageBytes, imageType });
    // Starting captions per platform; the address carries the club_post tracking tags.
    const shareBase = head.canonical && siteHosts(request).has(new URL(head.canonical).hostname) ? head.canonical : url.toString();
    let hashtags = '#LobiStarsFC #LobiStars';
    try { hashtags = await shareHashtags(env.DB); } catch {}
    const fields = { title: (head.ogTitle || head.title || '').split(' | ')[0], description: head.ogDescription || head.description || '', hashtags };
    const captions = Object.fromEntries(CLUB_PLATFORMS.map(k => [k, buildPageCaption(k, { ...fields, url: withUtm(shareBase, k, 'club_post') })]));
    return Response.json({
      url: url.toString(), path: url.pathname, status: res.status,
      title: head.ogTitle || head.title, description: head.ogDescription || head.description,
      canonical: head.canonical, image: head.image, imageAlt: head.imageAlt, imageBytes, imageType,
      siteName: head.siteName || 'Lobi Stars FC', warnings, shareUrl: shareBase, captions,
    });
  } catch (err) {
    console.error('[share] preview', err);
    return Response.json({ error: err.name === 'TimeoutError' ? 'The page took too long to answer.' : 'Could not check that page.' }, { status: 502 });
  }
}
