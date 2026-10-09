// Shrinks the photos in public/images, writes a .webp copy of each, and
// records every image's width/height in src/data/image-sizes.json (used at
// build time to add width/height attributes). Also (re)builds the favicon
// set, app icons and the default social share image from the club badge.
//
// Run after adding images:   npm run optimize-images
// (needs sharp; on Windows first run:
//  npm install --no-save @img/sharp-win32-x64@<sharp version>)
import sharp from 'sharp';
import { readdir, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(ROOT, 'public', 'images');
const PUBLIC = path.join(ROOT, 'public');
const MAX_WIDTH = 1600;
const VARIANT_WIDTHS = [480, 960];
const BADGE = path.join(IMAGES, 'lobi-stars-fc.jpg');
const RED = '#E31E24', DEEP = '#4D0B0D', GOLD = '#FFC72C';

// Generated files that shouldn't be treated as content photos.
const GENERATED = new Set(['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'og-default.jpg']);

const kb = n => `${(n / 1024).toFixed(0)} KB`;

async function optimisePhotos() {
  const sizes = {};
  let before = 0, after = 0, webpTotal = 0;
  const files = (await readdir(IMAGES)).filter(f => /\.(jpe?g|png)$/i.test(f));

  for (const file of files) {
    const full = path.join(IMAGES, file);
    const original = (await stat(full)).size;
    before += original;

    if (!GENERATED.has(file)) {
      const meta = await sharp(full).metadata();
      const resize = meta.width > MAX_WIDTH ? { width: MAX_WIDTH } : null;
      let pipeline = sharp(full).rotate();
      if (resize) pipeline = pipeline.resize(resize);
      const isPng = /\.png$/i.test(file);
      const buf = isPng
        ? await pipeline.png({ compressionLevel: 9, effort: 10, palette: !meta.hasAlpha || meta.width <= 600 }).toBuffer()
        : await pipeline.jpeg({ quality: 78, mozjpeg: true, progressive: true }).toBuffer();
      // Only replace the original when it's meaningfully smaller.
      if (buf.length < original * 0.95) {
        await writeFile(full + '.tmp', buf);
        await rename(full + '.tmp', full);
      }

      const webpPath = full.replace(/\.(jpe?g|png)$/i, '.webp');
      const webp = await sharp(full).webp({ quality: 74, effort: 6 }).toBuffer();
      const current = (await stat(full)).size;
      if (webp.length < current * 0.9) {
        await writeFile(webpPath, webp);
        webpTotal += webp.length;
        // Smaller WebP versions for phones (used in srcset at build time).
        const width = (await sharp(full).metadata()).width;
        for (const w of VARIANT_WIDTHS) {
          if (width <= w * 1.25) continue;
          const v = await sharp(full).resize({ width: w }).webp({ quality: 72, effort: 6 }).toBuffer();
          await writeFile(webpPath.replace(/\.webp$/, `-${w}w.webp`), v);
          webpTotal += v.length;
        }
      }
    }

    const m = await sharp(full).metadata();
    sizes[`/images/${file}`] = [m.width, m.height];
    after += (await stat(full)).size;
  }

  await writeFile(path.join(ROOT, 'src', 'data', 'image-sizes.json'), JSON.stringify(sizes, null, 0).replace(/],/g, '],\n'));
  console.log(`Photos: ${files.length} files, ${kb(before)} -> ${kb(after)} (WebP copies total ${kb(webpTotal)})`);
}

// The badge photo sits on a flat light-grey square. Flood-fill that
// background from the edges to transparent, then trim to the shield.
let cutout;
async function badgeCutout() {
  if (cutout) return cutout;
  const { data, info } = await sharp(BADGE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const isBg = i => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return r > 228 && g > 228 && b > 228 && Math.max(r, g, b) - Math.min(r, g, b) < 14;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    if (!isBg(p * 4)) continue;
    data[p * 4 + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  cutout = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().trim().toBuffer();
  return cutout;
}

async function badge(size) {
  return sharp(await badgeCutout()).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

async function iconOnBackground(size, inner, background) {
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: await badge(Math.round(size * inner)), gravity: 'center' }])
    .png();
}

async function makeIcons() {
  const white = '#FFFFFF';
  await (await iconOnBackground(192, 0.86, white)).toFile(path.join(IMAGES, 'icon-192.png'));
  await (await iconOnBackground(512, 0.86, white)).toFile(path.join(IMAGES, 'icon-512.png'));
  // Maskable icons get cropped to a circle/squircle, so keep the badge
  // inside the central safe zone.
  await (await iconOnBackground(512, 0.62, white)).toFile(path.join(IMAGES, 'icon-maskable-512.png'));
  await (await iconOnBackground(180, 0.84, white)).toFile(path.join(IMAGES, 'apple-touch-icon.png'));
  await (await iconOnBackground(32, 0.96, { r: 0, g: 0, b: 0, alpha: 0 })).toFile(path.join(PUBLIC, 'favicon-32x32.png'));
  await (await iconOnBackground(16, 1, { r: 0, g: 0, b: 0, alpha: 0 })).toFile(path.join(PUBLIC, 'favicon-16x16.png'));

  // favicon.ico holding a 32x32 and 48x48 PNG.
  const pngs = await Promise.all([32, 48].map(async s => (await iconOnBackground(s, 0.96, { r: 0, g: 0, b: 0, alpha: 0 })).toBuffer()));
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const s = [32, 48][i], e = 6 + i * 16;
    header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  await writeFile(path.join(PUBLIC, 'favicon.ico'), Buffer.concat([header, ...pngs]));
  console.log('Icons: favicon.ico, favicon-16/32, apple-touch-icon, icon-192/512, maskable');
}

async function makeShareImage() {
  const W = 1200, H = 630;
  const svg = `
  <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${DEEP}"/><stop offset=".65" stop-color="${RED}"/><stop offset="1" stop-color="#C11A1F"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="${W - 300}" cy="${H / 2}" r="250" fill="#FFFFFF"/>
    <circle cx="${W - 300}" cy="${H / 2}" r="250" fill="none" stroke="${GOLD}" stroke-width="10"/>
    <rect x="80" y="214" width="90" height="8" fill="${GOLD}"/>
    <text x="80" y="320" font-family="Impact, 'Arial Black', Arial, sans-serif" font-size="92" fill="#FFFFFF" letter-spacing="2">LOBI STARS FC</text>
    <text x="80" y="388" font-family="Arial, sans-serif" font-weight="700" font-size="34" fill="${GOLD}" letter-spacing="6">THE PRIDE OF BENUE</text>
    <text x="80" y="540" font-family="Arial, sans-serif" font-size="28" fill="#FFFFFF" fill-opacity=".85">lobistarsfc.com</text>
  </svg>`;
  await sharp(Buffer.from(svg))
    .composite([{ input: await badge(380), left: W - 300 - 190, top: H / 2 - 190 }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(path.join(IMAGES, 'og-default.jpg'));
  console.log('Share image: public/images/og-default.jpg (1200x630)');
}

await makeIcons();
await makeShareImage();
await optimisePhotos();
