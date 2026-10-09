// Runs after `astro build` on the finished HTML in dist/:
//  - <img src="/images/..."> gets width/height (from src/data/image-sizes.json),
//    loading="lazy" (except the header and homepage hero), decoding="async",
//    and a <picture> WebP source when a .webp copy exists.
//  - writes sitemap.xml listing every page that isn't marked noindex.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

    const dims = sizes[key];
    if (dims && !hasAttr(tag, 'width') && !hasAttr(tag, 'height')) add(`width="${dims[0]}" height="${dims[1]}"`);
    const aboveFold = (navEnd !== -1 && pos < navEnd) || inside(pos, hero);
    if (!hasAttr(tag, 'loading')) add(`loading="${aboveFold ? 'eager' : 'lazy'}"`);
    if (!hasAttr(tag, 'decoding')) add('decoding="async"');

    // Script-controlled images (id / onerror) keep a plain <img> so changing
    // their src still works.
    const webpKey = key.replace(/\.(jpe?g|png)$/i, '.webp');
    // Skip when another image shares the base name (its .webp would be ambiguous).
    const base = key.replace(/\.(jpe?g|png)$/i, '').toLowerCase();
    const clash = Object.keys(sizes).filter(k => k.replace(/\.(jpe?g|png)$/i, '').toLowerCase() === base).length > 1;
    const canWrap = !clash && webpKey !== key && !hasAttr(tag, 'id') && !hasAttr(tag, 'onerror') && !inside(pos, pictures)
      && existsSync(path.join(dist, ...webpKey.split('/')));
    if (out !== tag || canWrap) changed++;
    if (!canWrap) return out;
    // srcset is space-separated, so spaces in file names must be encoded.
    const webpSrc = ((src.startsWith('/') ? '' : '/') + src.replace(/\.(jpe?g|png)$/i, '.webp')).replace(/ /g, '%20');
    // Offer the smaller -480w / -960w versions (made by optimize-images) so
    // phones don't download desktop-sized photos.
    const candidates = [480, 960]
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
        const files = await walk(dist);
        const urls = [];
        let images = 0;

        for (const file of files) {
          const original = await readFile(file, 'utf8');
          const { html, changed } = rewriteImages(original, dist, sizes);
          images += changed;
          if (html !== original) await writeFile(file, html);

          const rel = path.relative(dist, file).split(path.sep).join('/');
          if (rel === '404.html' || /<meta name="robots" content="noindex/i.test(html)) continue;
          const route = '/' + rel.replace(/index\.html$/, '').replace(/\.html$/, '/');
          const published = html.match(/<meta property="article:published_time" content="([^"]+)"/)?.[1];
          urls.push({ loc: site + route, lastmod: published?.slice(0, 10) });
        }

        urls.sort((a, b) => a.loc.localeCompare(b.loc));
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
          `\n</urlset>\n`;
        await writeFile(path.join(dist, 'sitemap.xml'), xml);
        logger.info(`optimised ${images} <img> tags; sitemap.xml with ${urls.length} pages`);
      },
    },
  };
}
