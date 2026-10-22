// A very small PDF writer: A4 pages, the built-in Helvetica fonts (no font
// files), text with word wrapping, lines, filled and outlined boxes and one
// JPEG image. Enough for printable reports (Match Checklist) without a PDF
// library, so it stays light on Cloudflare's per-request CPU limit.
//
//   const doc = new PdfDoc();
//   doc.text('Hello', 40, 60, { size: 14, bold: true });
//   const bytes = doc.toBytes();   // Uint8Array, application/pdf
//
// Coordinates: points (1/72 inch) from the TOP-left corner (converted here).

// Helvetica and Helvetica-Bold advance widths (per 1000 em) for characters 32..126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// A few characters outside ASCII, as WinAnsi codes [code, regular width, bold width].
const EXTRA = { '–': [0x96, 556, 556], '—': [0x97, 1000, 1000], '‘': [0x91, 222, 278], '’': [0x92, 222, 278], '“': [0x93, 333, 500], '”': [0x94, 333, 500], '•': [0x95, 350, 350], '…': [0x85, 1000, 1000], 'é': [0xe9, 556, 556], '·': [0xb7, 278, 278], '✓': null };

/** Text → characters the built-in fonts can show (₦ → N, unknown → ?). */
export function pdfSafe(s) {
  return String(s ?? '').replace(/₦/g, 'N').replace(/[ ]/g, ' ').replace(/✓/g, 'v').replace(/[^\x20-\x7e–—‘’“”•…é·]/g, '?');
}
export function textWidth(s, size, bold = false) {
  const w = bold ? W_BOLD : W_REG;
  let n = 0;
  for (const ch of pdfSafe(s)) {
    const c = ch.charCodeAt(0);
    n += c >= 32 && c <= 126 ? w[c - 32] : EXTRA[ch] ? EXTRA[ch][bold ? 2 : 1] : 556;
  }
  return (n * size) / 1000;
}
/** Splits text into lines no wider than `width` points. */
export function wrap(s, width, size, bold = false) {
  const out = [];
  for (const para of pdfSafe(s).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= width) { line = next; continue; }
      if (line) out.push(line);
      // A single word wider than the line is cut.
      let w = word;
      while (textWidth(w, size, bold) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > width) cut--;
        out.push(w.slice(0, cut)); w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}
function encodeText(s) {
  let out = '';
  for (const ch of pdfSafe(s)) {
    const c = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (c >= 32 && c <= 126) out += ch;
    else if (EXTRA[ch]) out += `\\${EXTRA[ch][0].toString(8).padStart(3, '0')}`;
    else out += '?';
  }
  return out;
}
const num = n => (Math.round(n * 100) / 100).toString();
const rgb = hex => { const h = String(hex || '#000').replace('#', ''); return [0, 2, 4].map(i => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(' '); };

/** Width and height of a baseline JPEG (from its SOF marker), and its colour components. */
export function jpegInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], components: b[i + 9] };
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

export class PdfDoc {
  constructor({ width = 595.28, height = 841.89 } = {}) {
    this.w = width; this.h = height;
    this.pages = [];
    this.annots = [];
    this.image = null;
    this.extra = [];
    this.addPage();
  }
  addPage() { this.cur = []; this.pages.push(this.cur); this.annots.push([]); return this; }
  /** A clickable area (top-left x, y, width, height) opening an http(s) address. */
  link(x, y, w, h, url) {
    if (/^https?:\/\//i.test(String(url || ''))) this.annots[this.annots.length - 1].push({ rect: [x, this.h - y - h, x + w, this.h - y], url: String(url) });
    return this;
  }
  get pageCount() { return this.pages.length; }
  /** text at (x, y) where y is the BASELINE measured from the top. */
  text(s, x, y, { size = 10, bold = false, color = '#15181D', align = 'left' } = {}) {
    let tx = x;
    if (align !== 'left') { const tw = textWidth(s, size, bold); tx = align === 'right' ? x - tw : x - tw / 2; }
    this.cur.push(`BT ${rgb(color)} rg /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(tx)} ${num(this.h - y)} Td (${encodeText(s)}) Tj ET`);
    return this;
  }
  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.8 } = {}) {
    const ops = [];
    if (fill) ops.push(`${rgb(fill)} rg`);
    if (stroke) ops.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
    ops.push(`${num(x)} ${num(this.h - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.cur.push(`q ${ops.join(' ')} Q`);
    return this;
  }
  line(x1, y1, x2, y2, { color = '#D0D5DD', width = 0.6 } = {}) {
    this.cur.push(`q ${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(this.h - y1)} m ${num(x2)} ${num(this.h - y2)} l S Q`);
    return this;
  }
  /** Places a JPEG with its top-left at (x, y): the document's main one (setJpeg) or one added with addJpeg (its id). */
  drawImage(x, y, w, h, id = 'Im1') {
    if (id === 'Im1' ? !this.image : !this.extra.some(e => e.id === id)) return this;
    this.cur.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.h - y - h)} cm /${id} Do Q`);
    return this;
  }
  /** Adds another JPEG (one photo per page in squad exports); returns { id, width, height } for drawImage, or null. */
  addJpeg(bytes) {
    const info = jpegInfo(bytes);
    if (!info) return null;
    const id = `Im${this.extra.length + 2}`;
    this.extra.push({ id, bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), ...info });
    return { id, width: info.width, height: info.height };
  }
  setJpeg(bytes) {
    const info = jpegInfo(bytes);
    if (info) this.image = { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), ...info };
    return info;
  }
  toBytes({ title = 'Document', author = 'Lobi Stars FC' } = {}) {
    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let length = 0;
    const push = chunk => { const b = typeof chunk === 'string' ? latin1(chunk) : chunk; parts.push(b); length += b.length; };
    const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    // 1 catalog, 2 pages, 3 font regular, 4 font bold, 5 info, 6 image (optional), then a page + content per page.
    const first = 7;
    const kids = this.pages.map((_, i) => `${first + i * 2} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    obj(5, `<< /Title (${encodeText(title)}) /Author (${encodeText(author)}) /Producer (lobistarsfc.com) >>`);
    if (this.image) {
      const im = this.image;
      obj(6, [`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /${im.components === 1 ? 'DeviceGray' : im.components === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, '\nendstream']);
    } else obj(6, '<< >>');
    // Link annotations get object numbers after the pages, then the added images.
    let nextNo = first + this.pages.length * 2;
    const annotNos = this.annots.map(list => list.map(() => nextNo++));
    const extraNos = this.extra.map(() => nextNo++);
    const xobjects = [this.image ? '/Im1 6 0 R' : '', ...this.extra.map((e, i) => `/${e.id} ${extraNos[i]} 0 R`)].filter(Boolean).join(' ');
    const res = `<< /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >>`;
    this.pages.forEach((ops, i) => {
      const pageNo = first + i * 2, contentNo = pageNo + 1;
      const annots = annotNos[i].length ? ` /Annots [${annotNos[i].map(n => `${n} 0 R`).join(' ')}]` : '';
      obj(pageNo, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.w)} ${num(this.h)}] /Resources ${res} /Contents ${contentNo} 0 R${annots} >>`);
      const stream = ops.join('\n');
      obj(contentNo, [`<< /Length ${latin1(stream).length} >>\nstream\n`, stream, '\nendstream']);
    });
    this.annots.forEach((list, i) => list.forEach((a, j) => {
      obj(annotNos[i][j], `<< /Type /Annot /Subtype /Link /Rect [${a.rect.map(num).join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${a.url.replace(/[()\\]/g, c => `\\${c}`)}) >> >>`);
    }));
    this.extra.forEach((im, i) => obj(extraNos[i], [`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /${im.components === 1 ? 'DeviceGray' : im.components === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, '\nendstream']));
    const xref = length;
    const count = nextNo;
    let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let n = 1; n < count; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    push(x);
    push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(length);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    void enc;
    return out;
  }
}
function latin1(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}
