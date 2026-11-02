import { publishedReleases, releaseHtml, releasePdf, prDate } from '../../api/_lib/mediaPress.js';
import { mcSettings } from '../../api/_lib/mediaCentre.js';
import { textOf } from '../../api/_lib/mediaSanitize.js';

// /media/press-releases/           -- the archive of published press releases (newest first)
// /media/press-releases/<slug>/    -- one release (the fixed layout)
// /media/press-releases/<slug>.pdf -- its branded PDF
// Drawn into the built page /media/press-releases/ (site header, footer and styles).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const parts = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean);
  const list = await publishedReleases(env.DB);
  const settings = await mcSettings(env.DB);
  if (parts.length === 1 && parts[0].endsWith('.pdf')) {
    const r = list.find(x => `${x.slug}.pdf` === parts[0]);
    if (!r) return new Response('Not found', { status: 404 });
    const pdf = await releasePdf(env, r, { publishedAt: r.publishedAt, contact: r.contact || settings.press_contact });
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.slug}.pdf"`, 'Cache-Control': 'public, max-age=300' } });
  }
  if (parts.length && !url.pathname.endsWith('/')) return Response.redirect(`${url.origin}${url.pathname}/`, 301);
  const one = parts.length === 1 ? list.find(x => x.slug === parts[0]) : null;
  if (parts.length && !one) { const nf = await env.ASSETS.fetch(new URL('/404.html', url)); return new Response(nf.body, { status: 404, headers: nf.headers }); }
  const shell = await env.ASSETS.fetch(new URL('/media/press-releases/', url));
  const title = one ? `${one.headline} | Press release | Lobi Stars FC` : 'Press releases | Lobi Stars Football Club';
  const description = one ? textOf(one.body).slice(0, 155) : 'Official press releases and statements from Lobi Stars FC.';
  const page = one ? `${url.origin}/media/press-releases/${one.slug}/` : `${url.origin}/media/press-releases/`;
  const html = one
    ? `${releaseHtml(one, { publishedAt: one.publishedAt, contactFallback: settings.press_contact })}<p class="pr-acts"><a class="btn-o" href="/media/press-releases/${esc(one.slug)}.pdf">Download PDF</a> <a href="/media/press-releases/">All press releases</a></p>`
    : (list.length ? `<ul class="pr-list">${list.map(r => { const d = new Date(r.date || r.publishedAt); const cal = isNaN(d) ? ['', ''] : [d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Africa/Lagos' }), d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })];
        return `<li><a class="${r.statement ? 'is-st' : ''}" href="/media/press-releases/${esc(r.slug)}/" aria-label="${esc(r.headline)}, ${esc(prDate(r.date || r.publishedAt))}"><span class="pr-l-cal" aria-hidden="true"><b>${esc(cal[0])}</b><span>${esc(cal[1])}</span></span><span class="pr-l-txt"><span class="pr-l-tag">${r.statement ? 'Official statement' : 'Press release'}</span><b>${esc(r.headline)}</b>${r.subheadline ? `<span>${esc(r.subheadline)}</span>` : ''}<span class="pr-l-more">Read the release →</span></span></a></li>`; }).join('')}</ul>`
      : '<div class="prn-empty"><b>No press releases yet</b><p>New releases appear here as soon as the club publishes them.</p></div>');
  const set = v => ({ element(el) { el.setAttribute('content', v); } });
  const res = new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', set(description)).on('meta[property="og:title"]', set(title)).on('meta[property="og:description"]', set(description))
    .on('meta[property="og:url"]', set(page)).on('link[rel="canonical"]', { element(el) { el.setAttribute('href', page); } })
    .on('[data-pr-root]', { element(el) { el.setInnerContent(html, { html: true }); } })
    .transform(shell);
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'public, max-age=60');
  return new Response(res.body, { status: 200, headers });
}
