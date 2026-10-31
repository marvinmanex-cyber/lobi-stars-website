import { publicSquad } from '../api/_lib/squadPublish.js';
import { personFromFeed, sortPlayers, sortStaff, renderList, renderProfile, renderFormerList, renderFormerProfile, neighbours, profileDescription, personJsonLd, esc } from '../../src/lib/squadRender.js';
import { withSecurityHeaders } from '../api/_lib/securityHeaders.js';
import { getAdmin } from '../api/_lib/adminSession.js';
import { can, loadRoles } from '../api/_lib/adminRoles.js';
import { getProfile } from '../api/_lib/squadProfiles.js';
import { previewItem } from '../api/_lib/squadPublish.js';
import { PERSONALISATION } from '../api/_lib/shirtOrders.js';

// The Squad pages, live (23 Oct 2026): /squad/, /squad/<slug>/ and
// /squad/staff/<slug>/ are filled on the server from the approved (LIVE)
// profiles, so an approval shows within about 10 seconds without rebuilding
// the website. The list and profiles use the same markup as the built pages
// (src/lib/squadRender.js) inside the built page (or /squad-template/ for
// someone approved since the last build). The live squad is kept in
// Cloudflare's edge cache for 10 seconds. Old web addresses 301 to the new one.
// /squad/_preview/<profileId>/ (Super Admins): the profile exactly as it will
// look once approved (the Approval Queue shows it).
// Out on loan: their own section at the bottom of /squad and a banner on their page.
// Former players and staff: their address 301s to /squad/, or (when a Super Admin
// switched on the Former Players & Legends page) to /squad/former/<slug>/.
// If anything fails, the built page is served as it is.
const FEED_TTL = 10;

async function liveSquad(env, origin) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`${origin}/__squad-live-feed`);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) return hit.json();
  const feed = await publicSquad(env);
  if (cache) await cache.put(key, new Response(JSON.stringify(feed), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${FEED_TTL}` } })).catch(() => null);
  return feed;
}

const html = (res, status = 200) => {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.delete('X-Robots-Tag');
  withSecurityHeaders(headers);
  return new Response(res.body, { status, headers });
};

/** Puts the page's own title, description, address, share image and structured data into the built page. */
function rewrite(shell, { title, description, url, image, imageAlt, ld, rootHtml, shareTitle, shareText, templateUrl, index = true, heading = null, kicker = null }) {
  const set = v => ({ element(el) { el.setAttribute('content', v); } });
  let rw = new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', set(description))
    .on('meta[property="og:title"]', set(title)).on('meta[name="twitter:title"]', set(title))
    .on('meta[property="og:description"]', set(description)).on('meta[name="twitter:description"]', set(description))
    .on('meta[property="og:url"]', set(url))
    .on('link[rel="canonical"]', { element(el) { el.setAttribute('href', url); } })
    .on('script[type="application/ld+json"]', { element(el) { el.remove(); } })
    .on('head', { element(el) { el.append(ld.map(d => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join(''), { html: true }); } })
    .on('[data-squad-root]', { element(el) { el.setInnerContent(rootHtml, { html: true }); } });
  if (index) rw = rw.on('meta[name="robots"]', { element(el) { el.remove(); } });
  if (heading) rw = rw.on('h1.stitle', { element(el) { el.setInnerContent(heading, { html: true }); } });
  if (kicker) rw = rw.on('.page-hero .stag', { element(el) { el.setInnerContent(kicker); } });
  if (image) {
    rw = rw.on('meta[property="og:image"]', set(image)).on('meta[name="twitter:image"]', set(image))
      .on('meta[property="og:image:width"]', { element(el) { el.remove(); } }).on('meta[property="og:image:height"]', { element(el) { el.remove(); } });
  }
  if (imageAlt) rw = rw.on('meta[property="og:image:alt"]', set(imageAlt));
  if (shareTitle) rw = rw.on('[data-share-src] details[data-share]', { element(el) { el.setAttribute('data-share-title', shareTitle); el.setAttribute('data-share-text', shareText || ''); } });
  // The share links without JavaScript point at the page's own address.
  if (templateUrl && templateUrl !== url) {
    const a = encodeURIComponent(templateUrl), b = encodeURIComponent(url);
    rw = rw.on('a.share-opt', { element(el) { const h = el.getAttribute('href') || ''; el.setAttribute('href', h.split(a).join(b)); } });
  }
  return rw.transform(shell);
}

async function profilePage(request, env, url, person, list, season, { index = true, status = 200 } = {}) {
  const own = await env.ASSETS.fetch(new URL(person.href, url)).catch(() => null);
  const useOwn = own && own.ok && own.status === 200;
  if (own && !useOwn) await own.body?.cancel().catch(() => {});
  const shell = useOwn ? own : await env.ASSETS.fetch(new URL('/squad-template/', url));
  const title = `${person.name} | Lobi Stars FC`;
  const { prev, next, teammates } = neighbours(list, person);
  const page = `${url.origin}${person.href}`;
  const res = rewrite(shell, {
    title, description: profileDescription(person), url: page, index,
    image: person.photo ? new URL(person.photo.replace('w1200.webp', 'w1200.jpg'), url).toString() : null, imageAlt: `${person.name}, Lobi Stars FC`,
    ld: [personJsonLd(person, url.origin), breadcrumbs(url.origin, [['Squad', '/squad/'], [person.name, person.href]])],
    rootHtml: renderProfile(person, { prev, next, teammates, season, share: '<div class="pf-share-slot"></div>', personalisation: PERSONALISATION }),
    shareTitle: title, shareText: person.kind === 'player' ? `${person.name}, ${person.position || person.groupLabel} for Lobi Stars FC` : `${person.name}, ${person.role} at Lobi Stars FC`,
    templateUrl: useOwn ? page : `${url.origin}/squad-template/`,
  });
  return html(res, status);
}
const breadcrumbs = (origin, trail) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: [['Home', '/'], ...trail].map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${origin}${path}` })) });

export async function onRequestGet({ request, env, params, next }) {
  const url = new URL(request.url);
  const parts = [].concat(params.path || []).map(s => String(s).toLowerCase());
  try {
    // The profile as it will look when approved (Super Admins only; never indexed).
    if (parts[0] === '_preview') {
      const admin = await getAdmin(request, env);
      if (admin) await loadRoles(env.DB);
      if (!admin || !can(admin, 'squad.approve')) return new Response('Sign in as a Super Admin', { status: 403 });
      const row = await getProfile(env.DB, parts[1] || '');
      if (!row) return new Response('Not found', { status: 404 });
      const item = await previewItem(env, row);
      const person = personFromFeed(item, row.type);
      const res = await profilePage(request, env, url, person, [person], item.season, { index: false });
      const h = new Headers(res.headers); h.set('Cache-Control', 'private, no-store'); h.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(res.body, { status: 200, headers: h });
    }
    const feed = await liveSquad(env, url.origin);
    const players = sortPlayers(feed.players.map(x => personFromFeed(x, 'player')));
    const staff = sortStaff(feed.staff.map(x => personFromFeed(x, 'staff')));
    const loans = (feed.loans || []).map(x => personFromFeed(x, x.role ? 'staff' : 'player'));

    if (!parts.length) {
      const shell = await env.ASSETS.fetch(new URL('/squad/', url));
      return html(rewrite(shell, {
        title: 'First Team Squad | Lobi Stars FC', description: `Meet the Lobi Stars FC First Team squad for ${feed.season}: goalkeepers, defenders, midfielders, forwards and coaching staff.`,
        url: `${url.origin}/squad/`, ld: [breadcrumbs(url.origin, [['Squad', '/squad/']])], rootHtml: renderList({ players, staff, loans, season: feed.season, formerPage: !!feed.formerPage }),
      }));
    }
    // Former Players & Legends (only when switched on).
    if (parts[0] === 'former') {
      if (!feed.formerPage) return Response.redirect(`${url.origin}/squad/`, 302);
      if (parts.length === 1) {
        const shell = await env.ASSETS.fetch(new URL('/squad/', url));
        return html(rewrite(shell, { title: 'Former Players & Legends | Lobi Stars FC', description: 'Lobi Stars FC former players and staff: years at the club, appearances and goals.',
          url: `${url.origin}/squad/former/`, ld: [breadcrumbs(url.origin, [['Squad', '/squad/'], ['Former Players & Legends', '/squad/former/']])], rootHtml: renderFormerList(feed.former || []),
          heading: 'Former Players <span class="r">&amp; Legends</span>', kicker: 'Lobi Stars FC · Club history' }));
      }
      const x = (feed.former || []).find(f => f.slug === parts[1]);
      if (!x || parts.length > 2) { const nf = await env.ASSETS.fetch(new URL('/404.html', url)); return html(nf, 404); }
      const shell = await env.ASSETS.fetch(new URL('/squad-template/', url));
      const page = `${url.origin}/squad/former/${x.slug}/`;
      return html(rewrite(shell, { title: `${x.name} | Former ${x.type === 'player' ? 'player' : 'staff'} | Lobi Stars FC`, description: `${x.name}${x.years ? `, at Lobi Stars ${x.years}` : ''}${x.type === 'player' ? `: ${x.apps} appearances and ${x.goals} goals for the club` : ''}.`,
        url: page, image: x.photo ? new URL(x.photo.replace('w1200.webp', 'w1200.jpg'), url).toString() : null, imageAlt: x.name,
        ld: [{ '@context': 'https://schema.org', '@type': 'Person', name: x.name, url: page, alumniOf: { '@type': 'SportsTeam', name: 'Lobi Stars FC', url: `${url.origin}/` } }, breadcrumbs(url.origin, [['Squad', '/squad/'], ['Former Players & Legends', '/squad/former/'], [x.name, `/squad/former/${x.slug}/`]])],
        rootHtml: renderFormerProfile(x), shareTitle: `${x.name} | Lobi Stars FC`, shareText: `${x.name}, former Lobi Stars FC ${x.type === 'player' ? 'player' : 'staff'}`, templateUrl: `${url.origin}/squad-template/` }));
    }
    const isStaff = parts[0] === 'staff' && parts.length >= 2;
    const slug = isStaff ? parts[1] : parts[0];
    if (parts.length > (isStaff ? 2 : 1) || !/^[a-z0-9-]{1,120}$/.test(slug)) return next();
    const list = isStaff ? staff : players;
    const person = list.find(p => p.slug === slug);
    if (person) return profilePage(request, env, url, person, list, feed.season);
    const loaned = loans.find(p => p.slug === slug && (p.kind === 'staff') === isStaff);
    if (loaned) return profilePage(request, env, url, loaned, loans, feed.season);
    // Someone who left: to the Former Players & Legends page (when on) or the squad.
    const gone = (feed.formerSlugs || []).find(f => f.slug === slug || (f.old || []).includes(slug));
    if (gone) return Response.redirect(feed.formerPage ? `${url.origin}/squad/former/${gone.slug}/` : `${url.origin}/squad/`, 301);
    // Club staff (not coaching) have no public page.
    if (isStaff && (feed.clubStaff || []).includes(slug)) return Response.redirect(`${url.origin}/squad/`, 301);
    // An earlier address of someone: 301 to the current one.
    const prefix = isStaff ? '/squad/staff/' : '/squad/';
    const moved = (feed.redirects || []).find(r => r.from === `${prefix}${slug}/`);
    if (moved) return Response.redirect(`${url.origin}${moved.to}`, 301);
    const nf = await env.ASSETS.fetch(new URL('/404.html', url));
    return html(nf, 404);
  } catch (err) {
    console.error('[squad live]', err);
    return next();
  }
}
