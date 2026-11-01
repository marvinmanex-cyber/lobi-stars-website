// Turns a PNG (8 bits per channel, not interlaced: RGB, RGBA, grey, grey +
// alpha or palette with transparency) into what a PDF needs for a picture
// with a see-through background: the colours and the transparency (alpha)
// as two zlib-compressed streams. Used by pdfLite's addPng (crests on the
// match tickets). Returns null for anything else, so callers can fall back.
const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const inflate = b => pipe(b, new DecompressionStream('deflate'));
const deflate = b => pipe(b, new CompressionStream('deflate'));

export async function pngToPdfParts(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 33 || SIG.some((v, i) => b[i] !== v)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  for (let p = 8; p + 8 <= b.length;) {
    const len = dv.getUint32(p), name = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const data = b.subarray(p + 8, p + 8 + len);
    if (name === 'IHDR') { width = dv.getUint32(p + 8); height = dv.getUint32(p + 12); depth = b[p + 16]; type = b[p + 17]; interlace = b[p + 20]; }
    else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || depth !== 8 || interlace || !width || !height || (type === 3 && !palette)) return null;
  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((o, d) => { joined.set(d, o); return o + d.length; }, 0);
  const raw = await inflate(joined);
  // Undo the PNG row filters.
  const stride = width * channels, px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[dst + x - channels] : 0, up = y ? px[dst - stride + x] : 0, c = y && x >= channels ? px[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[dst + x] = v & 0xff;
    }
  }
  // Split into colour (RGB or grey) and alpha.
  const n = width * height, grey = type === 0 || type === 4;
  const color = new Uint8Array(n * (grey ? 1 : 3)), alpha = new Uint8Array(n);
  let hasAlpha = false;
  for (let i = 0; i < n; i++) {
    let r, g, bl, al = 255;
    if (type === 3) { const k = px[i]; r = palette[k * 3]; g = palette[k * 3 + 1]; bl = palette[k * 3 + 2]; if (trns && k < trns.length) al = trns[k]; }
    else if (type === 6) { r = px[i * 4]; g = px[i * 4 + 1]; bl = px[i * 4 + 2]; al = px[i * 4 + 3]; }
    else if (type === 2) { r = px[i * 3]; g = px[i * 3 + 1]; bl = px[i * 3 + 2]; }
    else if (type === 4) { r = px[i * 2]; al = px[i * 2 + 1]; }
    else r = px[i];
    if (grey) color[i] = r; else { color[i * 3] = r; color[i * 3 + 1] = g; color[i * 3 + 2] = bl; }
    alpha[i] = al; if (al !== 255) hasAlpha = true;
  }
  return { width, height, grey, color: await deflate(color), alpha: hasAlpha ? await deflate(alpha) : null };
}
