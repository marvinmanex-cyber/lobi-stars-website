// Turn a partner logo on a black (or dark) background into a clean transparent
// PNG that sits on the site's white cards, then trim it, pad it and size it.
//
// Usage:
//   node scripts/logo-to-transparent.mjs <input> <output.png> [options]
//
// Options:
//   --mode global|border   global (default): every near-black pixel becomes
//                          transparent, including the holes inside letters.
//                          Use when black is ONLY background.
//                          border: only the dark area joined to the image edge
//                          is removed (flood fill from all four sides); black
//                          inside the logo is kept. Use when the logo has
//                          intentional black parts.
//   --tolerance <n>        brightest channel at or below this counts as black
//                          (default 28). Pixels up to 2x this become partly
//                          transparent, so edges stay smooth.
//   --recolor-light <hex>  repaint flat white / very light parts (made for a
//                          dark background) in this colour, e.g. #3F0A7A.
//   --pad <percent>        padding around the trimmed artwork (default 4).
//   --max <px>             longest side (default 800).
//   --on-white <file>      also write a flat version on white (for places
//                          that can't use transparency).
//
// Already-transparent logos are fine too: the same steps clean up any dark
// fringe left on the soft edges ("defringe").
//
// Soft edges never keep the black they were blended with: a partly
// transparent pixel takes the colour of the nearest solid pixel of the logo,
// so there is no dark halo on white.
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!input || !output) { console.error('Usage: node scripts/logo-to-transparent.mjs <input> <output.png> [--mode global|border] [--tolerance 28] [--recolor-light #hex] [--pad 4] [--max 800] [--on-white file]'); process.exit(1); }
const mode = opt('mode', 'global');
const tol = Number(opt('tolerance', 28));
const pad = Number(opt('pad', 4)) / 100;
const max = Number(opt('max', 800));
const recolor = opt('recolor-light', null);
const onWhite = opt('on-white', null);
if (!['global', 'border'].includes(mode)) { console.error('--mode must be global or border'); process.exit(1); }

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const bright = i => Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);

// 1. Which pixels may be cleared: all dark ones (global) or only the dark
//    area joined to the border (border).
let candidate = new Uint8Array(N);
if (mode === 'global') {
  for (let i = 0; i < N; i++) candidate[i] = bright(i) <= tol * 2 ? 1 : 0;
} else {
  const stack = [];
  const push = i => { if (!candidate[i] && (data[i * 4 + 3] < 20 || bright(i) <= tol)) { candidate[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
  // The 1-2 px anti-aliased ring just inside the cleared area.
  for (let pass = 0; pass < 2; pass++) {
    const ring = [];
    for (let i = 0; i < N; i++) {
      if (candidate[i] || bright(i) > tol * 2) continue;
      const x = i % W, y = (i / W) | 0;
      if ((x > 0 && candidate[i - 1]) || (x < W - 1 && candidate[i + 1]) || (y > 0 && candidate[i - W]) || (y < H - 1 && candidate[i + W])) ring.push(i);
    }
    for (const i of ring) candidate[i] = 1;
  }
}

// 2. New alpha: black -> 0, up to 2x tolerance -> partly see-through.
for (let i = 0; i < N; i++) {
  if (!candidate[i]) continue;
  const b = bright(i), keep = b <= tol ? 0 : (b - tol) / tol;
  data[i * 4 + 3] = Math.round(data[i * 4 + 3] * Math.min(1, keep));
}

// 3. Defringe: every soft pixel that is dark (or any partly transparent
//    pixel) takes the colour of the nearest solid, non-dark logo pixel.
const solid = i => data[i * 4 + 3] >= 250 && bright(i) > tol * 2;
const src = new Int32Array(N).fill(-1);
let queue = [];
for (let i = 0; i < N; i++) if (solid(i)) { src[i] = i; queue.push(i); }
for (let q = 0; q < queue.length; q++) {
  const i = queue[q], x = i % W, y = (i / W) | 0;
  for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
    if (j >= 0 && src[j] < 0) { src[j] = src[i]; queue.push(j); }
  }
}
let fixed = 0;
for (let i = 0; i < N; i++) {
  const a = data[i * 4 + 3];
  if (a === 0 || solid(i) || src[i] < 0) continue;
  if (a < 250 || bright(i) <= tol * 2) {
    const s = src[i] * 4;
    data[i * 4] = data[s]; data[i * 4 + 1] = data[s + 1]; data[i * 4 + 2] = data[s + 2];
    fixed++;
  }
}
for (let i = 0; i < N; i++) if (data[i * 4 + 3] === 0) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0;

// 4. Optional: repaint flat light parts that were made for a dark background.
let recolored = 0;
if (recolor) {
  const m = /^#?([0-9a-f]{6})$/i.exec(recolor);
  if (!m) { console.error('--recolor-light needs a colour like #3F0A7A'); process.exit(1); }
  const [r, g, b] = [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16));
  for (let i = 0; i < N; i++) {
    if (data[i * 4 + 3] < 20 || Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 200) continue;
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; recolored++;
  }
}

// 5. Trim to the artwork, pad, resize (aspect ratio kept), optimise.
let x0 = W, y0 = H, x1 = -1, y1 = -1;
for (let i = 0; i < N; i++) if (data[i * 4 + 3] > 8) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
if (x1 < 0) { console.error('Nothing left after removing the background: try a lower --tolerance or --mode border.'); process.exit(1); }
const cw = x1 - x0 + 1, ch = y1 - y0 + 1, p = Math.round(Math.max(cw, ch) * pad);
let img = sharp(data, { raw: { width: W, height: H, channels: 4 } })
  .extract({ left: x0, top: y0, width: cw, height: ch })
  .extend({ top: p, bottom: p, left: p, right: p, background: { r: 0, g: 0, b: 0, alpha: 0 } });
const buf = await img.png().toBuffer();
let out = sharp(buf);
if (Math.max(cw, ch) + 2 * p > max) out = out.resize({ width: cw >= ch ? max : null, height: ch > cw ? max : null, fit: 'inside' });
const final = await out.png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 }).toBuffer();
await sharp(final).toFile(output);
const meta = await sharp(final).metadata();
console.log(`${output}: ${meta.width}x${meta.height}, ${(final.length / 1024).toFixed(1)} KB; mode ${mode}, soft edges recoloured ${fixed}${recolor ? `, light pixels recoloured ${recolored}` : ''}`);
if (onWhite) {
  await sharp(final).flatten({ background: '#ffffff' }).png({ compressionLevel: 9 }).toFile(onWhite);
  console.log(`${onWhite}: flat on white`);
}
