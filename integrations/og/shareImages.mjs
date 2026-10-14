// Branded share images (1200 x 630) for pages without their own photo, and
// one per opponent for match pages ("Lobi Stars v Kada Warriors" with both
// crests). Made at build time with sharp (installed with Astro) and the club's
// display font, Bebas Neue (SIL Open Font License, see OFL.txt).
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.join(HERE, 'BebasNeue-Regular.ttf');
const W = 1200, H = 630;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const backgroundSvg = bar => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#15181D"/><stop offset=".6" stop-color="#2A0507"/><stop offset="1" stop-color="#8B0E12"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <path d="M760 0 L1200 0 L1200 630 L560 630 Z" fill="#E31E24" opacity=".14"/>
  <path d="M900 0 L1200 0 L1200 630 L760 630 Z" fill="#FFC72C" opacity=".06"/>
  <rect x="0" y="0" width="14" height="${H}" fill="#FFC72C"/>
  ${bar ? `<rect x="80" y="${H - 92}" width="120" height="6" fill="#E31E24"/>` : ''}
</svg>`);

/** Text as an image (Bebas Neue), wrapped to `width`. */
async function text(str, { size, color = '#FFFFFF', width = 1040, align = 'left', spacing = 0 }) {
  const markup = `<span foreground="${color}" letter_spacing="${spacing * 1024}">${esc(str)}</span>`;
  const img = sharp({ text: { text: markup, font: `Bebas Neue ${size}`, fontfile: FONT, width, rgba: true, wrap: 'word', align, spacing: Math.round(size * -0.12) } });
  const { width: w, height: h } = await img.metadata();
  return { input: await img.png().toBuffer(), w, h };
}

/** A crest or logo exactly as designed, fitted into a box: no circle, ring or background. */
async function crest(file, size, width = size) {
  return sharp(file).resize(width, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

/** Fits the title into at most ~3 lines by stepping the size down. */
async function title(str, width, maxH) {
  for (const size of [118, 104, 92, 80, 70, 60]) {
    const t = await text(str.toUpperCase(), { size, width });
    if (t.h <= maxH) return t;
  }
  return text(str.toUpperCase().slice(0, 90) + '…', { size: 60, width });
}

/** A partner logo on a round white card with a ring (partner share images keep their original look). */
async function ringCrest(file, size) {
  const r = size / 2;
  const inner = await sharp(file).resize(size - 16, size - 16, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer();
  const ring = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="#ffffff"/></svg>`);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r - 8}" fill="#fff"/></svg>`);
  const round = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: inner, left: 8, top: 8 }, { input: mask, blend: 'dest-in' }]).png().toBuffer();
  return sharp(ring).composite([{ input: round }]).png().toBuffer();
}

/** Page card: badge (or a partner's logo on its white card), small heading (e.g. NEWS) and the page title. */
export async function pageCard({ heading, title: str, badge, partner = false, out }) {
  const layers = [];
  if (badge && existsSync(badge)) layers.push({ input: partner ? await ringCrest(badge, 150) : await crest(badge, 150), left: 80, top: 60 });
  const k = await text(heading.toUpperCase(), { size: 40, color: '#FFC72C', spacing: 3 });
  layers.push({ input: k.input, left: 80, top: 238 });
  const t = await title(str, 1040, 270);
  layers.push({ input: t.input, left: 80, top: 288 });
  const f = await text('LOBISTARSFC.COM  ·  PRIDE OF BENUE', { size: 30, color: '#FFFFFF', spacing: 2 });
  layers.push({ input: f.input, left: 80, top: H - 70 });
  await sharp(backgroundSvg(true)).composite(layers).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
}

/** Match card: both crests, "VS", and the fixture. */
export async function matchCard({ home, away, homeCrest, awayCrest, out }) {
  const layers = [];
  const size = 210, top = 70;
  const placeholder = async name => {
    // No crest: the club's initials as plain text (no circle behind them).
    const t = await text((name.replace(/\b(FC|F\.C\.)\b/g, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase(), { size: 130, color: '#FFFFFF', width: size, align: 'centre' });
    const box = sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
    return box.composite([{ input: t.input, left: Math.round((size - t.w) / 2), top: Math.round((size - t.h) / 2) }]).png().toBuffer();
  };
  const hc = homeCrest && existsSync(homeCrest) ? await crest(homeCrest, size) : await placeholder(home);
  const ac = awayCrest && existsSync(awayCrest) ? await crest(awayCrest, size) : await placeholder(away);
  layers.push({ input: hc, left: 240, top }, { input: ac, left: W - 240 - size, top });
  const vs = await text('VS', { size: 96, color: '#FFC72C', width: 200, align: 'centre' });
  layers.push({ input: vs.input, left: Math.round((W - vs.w) / 2), top: top + Math.round((size - vs.h) / 2) });
  const k = await text('MATCH CENTRE', { size: 36, color: '#FFC72C', width: 1040, align: 'centre', spacing: 3 });
  layers.push({ input: k.input, left: Math.round((W - k.w) / 2), top: 318 });
  const t = await title(`${home} v ${away}`, 1040, 170);
  layers.push({ input: t.input, left: Math.round((W - t.w) / 2), top: 364 });
  const f = await text('LOBISTARSFC.COM', { size: 30, color: '#FFFFFF', width: 1040, align: 'centre', spacing: 2 });
  layers.push({ input: f.input, left: Math.round((W - f.w) / 2), top: H - 62 });
  await sharp(backgroundSvg(false)).composite(layers).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
}
