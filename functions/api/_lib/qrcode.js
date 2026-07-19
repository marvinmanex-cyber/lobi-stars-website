import qrcodeGenerator from 'qrcode-generator';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  out.set(body, 4);
  dv.setUint32(4 + body.length, crc32(body), false);
  return out;
}

async function deflate(bytes) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  let total = 0;
  const reader = cs.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// Renders a QR code as a real PNG (not an inline SVG data URI) -- most email
// clients, Gmail included, silently refuse to render `data:image/svg+xml`
// sources, leaving a blank box where the code should be. A PNG served from
// a normal hosted URL (see functions/api/qr/[id].js) works the same way the
// team crest/tier badge images in these emails already do.
export async function qrPngBuffer(text, { size = 300, margin = 4 } = {}) {
  const qr = qrcodeGenerator(0, 'M');
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const cell = Math.max(1, Math.round(size / (moduleCount + margin * 2)));
  const dim = cell * (moduleCount + margin * 2);
  const stride = dim + 1; // +1 for the per-row PNG filter-type byte

  const raw = new Uint8Array(dim * stride);
  for (let y = 0; y < dim; y++) {
    raw[y * stride] = 0; // filter type: None
    raw.fill(255, y * stride + 1, y * stride + 1 + dim);
  }
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!qr.isDark(row, col)) continue;
      const px0 = (col + margin) * cell;
      const py0 = (row + margin) * cell;
      for (let dy = 0; dy < cell; dy++) {
        const rowStart = (py0 + dy) * stride + 1 + px0;
        raw.fill(0, rowStart, rowStart + cell);
      }
    }
  }

  const compressed = await deflate(raw);

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, dim, false);
  dv.setUint32(4, dim, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', compressed);
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let offset = 0;
  for (const part of [signature, ihdrChunk, idatChunk, iendChunk]) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
