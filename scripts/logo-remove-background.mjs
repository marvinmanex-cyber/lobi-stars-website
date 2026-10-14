// Removes a solid background (white, or black) baked into a logo file, so the
// logo shows on its own shape. Only the background joined to the image edges
// is removed (flood fill from all four sides): white or black INSIDE the logo
// (letters, the inside of a ring) is kept. Soft edges get partial
// transparency and lose the background colour they were blended with, so
// there is no white (or dark) halo.
//
// Usage:
//   node scripts/logo-remove-background.mjs <input> <output.png> [--tolerance 36] [--bg white|black|auto] [--edge 2] [--max 640]
//
// The original is never changed: keep it (design-sources/logo-originals/) and
// check the result on a white and a dark background before using it.
import sharp from 'sharp';

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) { console.error('Usage: node scripts/logo-remove-background.mjs <input> <output.png> [--tolerance n] [--bg white|black|auto]'); process.exit(1); }
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
const TOL = Number(opt('tolerance', 36));

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;

// Background colour: white or black, whichever most edge pixels are.
let bgWant = opt('bg', 'auto');
if (bgWant === 'auto') {
  let w = 0, k = 0;
  const count = i => { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; if (Math.min(r, g, b) > 220) w++; else if (Math.max(r, g, b) < 40) k++; };
  for (let x = 0; x < W; x++) { count(x); count((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { count(y * W); count(y * W + W - 1); }
  bgWant = w >= k ? 'white' : 'black';
}
const BG = bgWant === 'white' ? 255 : 0;
// Distance from the background: how far the pixel's furthest channel is from it.
const dist = i => Math.max(Math.abs(data[i * 4] - BG), Math.abs(data[i * 4 + 1] - BG), Math.abs(data[i * 4 + 2] - BG));

// Flood fill from the edges through background-coloured pixels.
const state = new Uint8Array(N); // 0 untouched, 1 background, 2 edge (soft)
const queue = new Int32Array(N); let qh = 0, qt = 0;
const push = i => { if (state[i] === 0 && dist(i) <= TOL) { state[i] = 1; queue[qt++] = i; } };
for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
while (qh < qt) {
  const i = queue[qh++], x = i % W, y = (i / W) | 0;
  if (x > 0) push(i - 1); if (x < W - 1) push(i + 1);
  if (y > 0) push(i - W); if (y < H - 1) push(i + W);
}
// Background: fully transparent.
for (let i = 0; i < N; i++) if (state[i] === 1) data[i * 4 + 3] = 0;
// Soft edge: the band of logo pixels up to EDGE px from the removed background
// (JPEG edges blend over 2-3 px). "Colour to alpha": how far a pixel is from the
// background colour becomes its opacity, and the background is un-blended
// from its colour, so a pale fringe pixel turns nearly transparent instead of
// leaving a light (or dark) halo. Solid logo colours (far from the
// background) stay fully opaque.
const EDGE = Number(opt('edge', 2));
let ring = [];
for (let i = 0; i < N; i++) if (state[i] === 1) ring.push(i);
for (let step = 0; step < EDGE; step++) {
  const next = [];
  for (const i of ring) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (state[j] !== 0) continue;
      state[j] = 2; next.push(j);
      const a = Math.min(1, dist(j) / 255 * (255 / (255 - TOL)));
      if (a >= 0.98) continue;
      const aa = Math.max(a, 0.02);
      for (let c = 0; c < 3; c++) data[j * 4 + c] = Math.max(0, Math.min(255, Math.round((data[j * 4 + c] - BG * (1 - aa)) / aa)));
      data[j * 4 + 3] = Math.round(a * 255);
    }
  }
  ring = next;
}
// --max: longest side for the saved file (never enlarged).
const MAX = Number(opt('max', 0));
let out = sharp(data, { raw: { width: W, height: H, channels: 4 } });
if (MAX && Math.max(W, H) > MAX) out = sharp(await out.png().toBuffer()).resize(MAX, MAX, { fit: 'inside' });
await out.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toFile(output);
const removed = state.reduce((n, s) => n + (s === 1), 0);
console.log(`${output}: ${W}x${H}, ${bgWant} background, ${Math.round(removed / N * 100)}% removed`);
