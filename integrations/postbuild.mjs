// Runs after `astro build` on the finished HTML in dist/:
//  - <img src="/images/..."> gets width/height (from src/data/image-sizes.json),
//    loading="lazy" (except the header and homepage hero), decoding="async",
//    and a <picture> WebP source when a .webp copy exists.
//  - writes sitemap.xml listing every page that isn't marked noindex.
//  - branded share images (integrations/og) for pages without their own photo.
//  - members-only stories: cuts the story text out of the public HTML and
//    writes it to functions/api/_generated/membersContent.js, so it is only
//    ever sent by the server to confirmed members (functions/news/[slug].js).
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeShareImages } from './og/index.mjs';

// The blurred fill behind whole-picture frames (fitpic) at the top of a page: a tiny copy of the photo (16 px wide,
// a few hundred bytes) put straight into the page. Blurred, it looks the same as the 240 px copy, but browsers do not
// count such a low-detail picture as the page's largest element (LCP), so the real photo counts instead, and the
// page needs fewer downloads. SEO Scanner: LCP 4.7 s on /news/ (mobile), 26 Nov 2026. Without sharp: the 240 px copy.
const TINY_FILLS = 8;
let sharpLib;
const tinyCache = new Map();
async function tinyFill(dist, urlPath) {
  if (tinyCache.has(urlPath)) return tinyCache.get(urlPath);
  let out = null;
  try {
    if (sharpLib === undefined) sharpLib = (await import('sharp')).default;
    const file = path.join(dist, ...urlPath.split('/'));
    if (sharpLib && existsSync(file)) out = `data:image/webp;base64,${(await sharpLib(file).resize(16).webp({ quality: 40 }).toBuffer()).toString('base64')}`;
  } catch { sharpLib = sharpLib || null; out = null; }
  tinyCache.set(urlPath, out);
  return out;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];
const hasAttr = (tag, name) => new RegExp(`\\s${name}(\\s*=|[\\s/>])`, 'i').test(tag);

function ranges(html, open, close) {
  const out = [];
  let i = 0;
  while ((i = html.indexOf(open, i)) !== -1) {
    const end = html.indexOf(close, i);
    if (end === -1) break;
    out.push([i, end + close.length]);
    i = end + close.length;
  }
  return out;
}
const inside = (pos, list) => list.some(([a, b]) => pos >= a && pos < b);

let imageAlt = {};
function rewriteImages(html, dist, sizes) {
  const scripts = ranges(html, '<script', '</script>');
  const pictures = ranges(html, '<picture', '</picture>');
  const navEnd = html.indexOf('</nav>');
  const hero = ranges(html, '<section id="hero"', '</section>').slice(0, 1);
  let changed = 0;

  const result = html.replace(/<img\b[^>]*>/gi, (tag, pos) => {
    if (inside(pos, scripts)) return tag;
    let src = attr(tag, 'src');
    if (!src || !/^\/?images\//.test(src)) return tag;
    const key = decodeURI(src.startsWith('/') ? src : `/${src}`);
    let out = tag;
    const add = s => { out = out.replace(/\s*\/?>$/, m => ` ${s}${m.trim() === '/>' ? ' />' : '>'}`); };

    // Alt text approved in the SEO Scanner (src/data/image-alt.json), only where the picture has none.
    const altText = imageAlt[key];
    if (altText && !(attr(tag, 'alt') || '').trim()) {
      const safe = String(altText).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      if (hasAttr(out, 'alt')) out = out.replace(/\salt\s*=\s*("[^"]*"|'[^']*')/i, ` alt="${safe}"`); else add(`alt="${safe}"`);
    }
    const dims = sizes[key];
    if (dims && !hasAttr(tag, 'width') && !hasAttr(tag, 'height')) add(`width="${dims[0]}" height="${dims[1]}"`);
    const aboveFold = (navEnd !== -1 && pos < navEnd) || inside(pos, hero);
    // A page's main picture (marked fetchpriority="high") always loads at once: lazy-loading it delays the
    // Largest Contentful Paint (Core Web Vitals), as on /tickets/ (Nov 2026).
    const mainPicture = /\sfetchpriority\s*=\s*["']?high/i.test(tag);
    if (!hasAttr(tag, 'loading')) add(`loading="${aboveFold || mainPicture ? 'eager' : 'lazy'}"`);
    if (!hasAttr(tag, 'decoding')) add('decoding="async"');

    // Script-controlled images (id / onerror) keep a plain <img> so changing
    // their src still works.
    const webpKey = key.replace(/\.(jpe?g|png)$/i, '.webp');
    // Skip when another image shares the base name (its .webp would be ambiguous).
    const base = key.replace(/\.(jpe?g|png)$/i, '').toLowerCase();
    const clash = Object.keys(sizes).filter(k => k.replace(/\.(jpe?g|png)$/i, '').toLowerCase() === base).length > 1;
    const canWrap = !clash && webpKey !== key && !hasAttr(tag, 'id') && !hasAttr(tag, 'onerror') && !inside(pos, pictures)
      && existsSync(path.join(dist, ...webpKey.split('/')));
    // Pictures that are already WebP (e.g. Media Centre uploads): offer their smaller copies with srcset.
    if (/\.webp$/i.test(key) && dims && !hasAttr(tag, 'srcset') && !hasAttr(tag, 'id') && !hasAttr(tag, 'onerror') && !inside(pos, pictures)) {
      const enc = ((src.startsWith('/') ? '' : '/') + src).replace(/ /g, '%20');
      const variants = [240, 480, 960].filter(w => w < dims[0] && existsSync(path.join(dist, ...key.replace(/\.webp$/i, `-${w}w.webp`).split('/'))));
      if (variants.length) {
        add(`srcset="${[...variants.map(w => `${enc.replace(/\.webp$/i, `-${w}w.webp`)} ${w}w`), `${enc} ${dims[0]}w`].join(', ')}"`);
        if (!hasAttr(tag, 'sizes')) add('sizes="(max-width: 900px) 100vw, 900px"');
        changed++;
        return out;
      }
    }
    if (out !== tag || canWrap) changed++;
    if (!canWrap) return out;
    // srcset is space-separated, so spaces in file names must be encoded.
    const webpSrc = ((src.startsWith('/') ? '' : '/') + src.replace(/\.(jpe?g|png)$/i, '.webp')).replace(/ /g, '%20');
    // Offer the smaller -240w / -480w / -960w versions (made by optimize-images) so
    // phones don't download desktop-sized photos.
    const candidates = [240, 480, 960]
      .filter(w => existsSync(path.join(dist, ...webpKey.replace(/\.webp$/, `-${w}w.webp`).split('/'))))
      .map(w => `${webpSrc.replace(/\.webp$/, `-${w}w.webp`)} ${w}w`);
    if (candidates.length && dims) {
      const sizes = attr(tag, 'sizes') || '100vw';
      return `<picture><source srcset="${[...candidates, `${webpSrc} ${dims[0]}w`].join(', ')}" sizes="${sizes}" type="image/webp">${out}</picture>`;
    }
    return `<picture><source srcset="${webpSrc}" type="image/webp">${out}</picture>`;
  });
  return { html: result, changed };
}

export default function postbuild() {
  let site = '';
  return {
    name: 'lobi-postbuild',
    hooks: {
      'astro:config:done': ({ config }) => { site = (config.site || '').replace(/\/$/, ''); },
      'astro:build:done': async ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const sizesFile = path.resolve(dist, '..', 'src', 'data', 'image-sizes.json');
        const sizes = existsSync(sizesFile) ? JSON.parse(await readFile(sizesFile, 'utf8')) : {};
        const altFile = path.resolve(dist, '..', 'src', 'data', 'image-alt.json');
        imageAlt = existsSync(altFile) ? JSON.parse(await readFile(altFile, 'utf8')) : {};
        const files = await walk(dist);
        const urls = [];
        const membersContent = {};
        let images = 0;

        for (const file of files) {
          const original = await readFile(file, 'utf8');
          let { html, changed } = rewriteImages(original, dist, sizes);
          images += changed;
          // The blurred fill behind whole-picture frames (fitpic) only needs the tiny -240w copy, not the full photo.
          html = html.replace(/--fit-bg:url\((&quot;|")(\/images\/[^"&)]+?)\.(webp|jpe?g|png)\1\)/gi, (m, q, base) => {
            const small = `${base}-240w.webp`;
            return existsSync(path.join(dist, ...small.split('/'))) ? `--fit-bg:url(${q}${small}${q})` : m;
          });
          // The first few fills on the page: the tiny copy, straight in the page (tinyFill above).
          for (const m of [...html.matchAll(/--fit-bg:url\((&quot;|")(\/images\/[^"&)]+?-240w\.webp)\1\)/gi)].slice(0, TINY_FILLS)) {
            const tiny = await tinyFill(dist, m[2]);
            if (tiny) html = html.replace(m[0], `--fit-bg:url(${m[1]}${tiny}${m[1]})`);
          }
          // The first of those fills is at the top of the page and can be its largest element (LCP), but a picture
          // named in a style is found late. Tell the browser about it in the <head> so it downloads at once (SEO
          // Scanner: LCP 4.7 s on /news/, Nov 2026). Same for the page's first high-priority picture.
          const firstFill = html.match(/--fit-bg:url\((?:&quot;|")(\/images\/[^"&)]+?-240w\.webp)(?:&quot;|")\)/);
          const heads = [];
          const lcpImg = html.match(/<img\b(?=[^>]*\bfetchpriority="high")[^>]*>/);
          // Only when the fill comes before the page's main picture (otherwise it is further down the page).
          // (Not when the top fills are already in the page as tiny copies: then the 240 px one is further down.)
          const fillFirst = firstFill && !/--fit-bg:url\((?:&quot;|")data:/.test(html) && (!lcpImg || (firstFill.index ?? 0) < (lcpImg.index ?? 0));
          if (fillFirst && !html.includes(`rel="preload" as="image" href="${firstFill[1]}"`)) heads.push(`<link rel="preload" as="image" href="${firstFill[1]}" fetchpriority="high">`);
          if (lcpImg) {
            const src = lcpImg[0].match(/\ssrc="([^"]+)"/)?.[1], set = lcpImg[0].match(/\ssrcset="([^"]+)"/)?.[1], szs = lcpImg[0].match(/\ssizes="([^"]+)"/)?.[1];
            // WebP only: for a JPG/PNG the browser shows the WebP copy from <picture>, so preloading it would load twice.
            if (src && /\.webp(\?|$)/i.test(src) && !html.includes(`rel="preload" as="image" href="${src}"`)) heads.push(`<link rel="preload" as="image" href="${src}"${set ? ` imagesrcset="${set}"` : ''}${szs ? ` imagesizes="${szs}"` : ''} fetchpriority="high">`);
            else if (src && !set) {
              // A JPG/PNG inside <picture>: preload the WebP copy the browser will really show (homepage and tickets heroes).
              const at = lcpImg.index ?? 0, open = html.lastIndexOf('<picture', at);
              const between = open >= 0 && !html.slice(open, at).includes('</picture>') ? html.slice(open, at) : '';
              const webp = [...between.matchAll(/<source\b[^>]*>/g)].map(m => m[0]).find(s => /type="image\/webp"/.test(s) && !/\smedia=/.test(s));
              const wset = webp?.match(/\ssrcset="([^"]+)"/)?.[1], wsz = webp?.match(/\ssizes="([^"]+)"/)?.[1] || szs;
              const first = wset?.split(',')[0].trim().split(/\s+/)[0];
              if (wset && first && !html.includes(`imagesrcset="${wset}"`)) heads.push(`<link rel="preload" as="image" href="${first}" imagesrcset="${wset}"${wsz ? ` imagesizes="${wsz}"` : ''} fetchpriority="high">`);
            }
          }
          if (heads.length && html.includes('</head>')) html = html.replace(/<meta charset[^>]*>/i, m => `${m}${heads.join('')}`);
          const rel = path.relative(dist, file).split(path.sep).join('/');
          const ms = html.match(/<i hidden data-ms-start[^>]*><\/i>([\s\S]*?)<i hidden data-ms-end[^>]*><\/i>/);
          if (ms) {
            const slug = rel.match(/^news\/([^/]+)\/index\.html$/)?.[1];
            if (slug) membersContent[slug] = ms[1];
            html = html.replace(ms[0], '');
          }
          if (html !== original) await writeFile(file, html);

          if (rel === '404.html' || /<meta name="robots" content="noindex/i.test(html)) continue;
          const route = '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '/');
          const published = html.match(/<meta property="article:published_time" content="([^"]+)"/)?.[1];
          urls.push({ loc: site + route, lastmod: published?.slice(0, 10) });
        }

        // Branded share images for pages without their own photo (and match cards).
        await makeShareImages({ dist, site, files, logger });

        urls.sort((a, b) => a.loc.localeCompare(b.loc));
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
          `\n</urlset>\n`;
        await writeFile(path.join(dist, 'sitemap.xml'), xml);

        // Squad profiles whose web address changed (e.g. a corrected name): old address → new (301),
        // from scripts/fetch-squad.mjs. Added to the end of dist/_redirects.
        const squadRedirects = path.resolve(dist, '..', 'src', 'content', 'players', 'portal', '_redirects.json');
        if (existsSync(squadRedirects)) {
          const list = JSON.parse(await readFile(squadRedirects, 'utf8'));
          if (list.length) {
            const file = path.join(dist, '_redirects');
            const before = existsSync(file) ? await readFile(file, 'utf8') : '';
            const lines = list.flatMap(r => [`${r.from} ${r.to} 301`, `${r.from.replace(/\/$/, '')} ${r.to} 301`]);
            await writeFile(file, `${before.replace(/\s*$/, '\n')}# Squad profiles: old web addresses\n${lines.join('\n')}\n`);
            logger.info(`${list.length} squad profile redirect(s) added`);
          }
        }

        // Redirects approved in the SEO Scanner (src/data/redirects.json: [{ from, to }]), 301.
        const seoRedirects = path.resolve(dist, '..', 'src', 'data', 'redirects.json');
        if (existsSync(seoRedirects)) {
          const list = JSON.parse(await readFile(seoRedirects, 'utf8')).filter(r => /^\/[^\s]*$/.test(r?.from || '') && /^\/[^\s]*$/.test(r?.to || '') && r.from !== r.to);
          if (list.length) {
            const file = path.join(dist, '_redirects');
            const before = existsSync(file) ? await readFile(file, 'utf8') : '';
            await writeFile(file, `${before.replace(/\s*$/, '\n')}# SEO Scanner: approved redirects\n${list.map(r => `${r.from} ${r.to} 301`).join('\n')}\n`);
            logger.info(`${list.length} SEO redirect(s) added`);
          }
        }

        const genDir = path.resolve(dist, '..', 'functions', 'api', '_generated');
        await mkdir(genDir, { recursive: true });
        await writeFile(path.join(genDir, 'membersContent.js'),
          `// Generated by integrations/postbuild.mjs on every build. Do not edit or commit.
// Members-only story text, sent only to confirmed members.
export default ${JSON.stringify(membersContent)};
`);
        if (Object.keys(membersContent).length) logger.info(`${Object.keys(membersContent).length} members-only stories kept server-side`);
        logger.info(`optimised ${images} <img> tags; sitemap.xml with ${urls.length} pages`);
      },
    },
  };
}
