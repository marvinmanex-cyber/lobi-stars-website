// MatchDay Kitchen sales reports as files: a PDF and a Word document, each with the pie chart.
// The picture is drawn here, so a report looks the same whichever file is opened.
import { zipSync, zlibSync, strToU8 } from 'fflate';
import { PdfDoc, pdfSafe, wrap } from './pdfLite.js';
import { pieSlices } from './kitchenSalesReports.js';

// The chart palette, in its fixed order (validated for colour-blind readers; see the dataviz method).
export const PIE_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

/** The pie as a PNG: white background, a thin white gap between slices, smooth edges. */
export function piePng(slices, size = 480) {
  const total = slices.reduce((s, x) => s + x.qty, 0) || 1;
  let a = 0;
  const ends = slices.map(s => { a += (s.qty / total) * Math.PI * 2; return a; });
  const starts = [0, ...ends.slice(0, -1)];
  const colours = slices.map((_, i) => rgbOf(PIE_COLOURS[i % PIE_COLOURS.length]));
  const r = size / 2 - 4, c = size / 2, gap = slices.length > 1 ? 1.5 : 0, SS = 3;
  const row = size * 3 + 1, raw = new Uint8Array(row * size);
  const sample = (x, y) => {
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
    if (d > r) return null;
    // Clockwise from 12 o'clock.
    let t = Math.atan2(dx, -dy); if (t < 0) t += Math.PI * 2;
    let i = ends.findIndex(e => t <= e); if (i < 0) i = slices.length - 1;
    if (gap && (d * Math.abs(Math.sin(t - starts[i])) < gap && Math.cos(t - starts[i]) > 0 || d * Math.abs(Math.sin(ends[i] - t)) < gap && Math.cos(ends[i] - t) > 0)) return null;
    return colours[i];
  };
  for (let y = 0; y < size; y++) {
    const o = y * row;
    raw[o] = 0;
    for (let x = 0; x < size; x++) {
      let R = 0, G = 0, B = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const col = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        R += col ? col[0] : 255; G += col ? col[1] : 255; B += col ? col[2] : 255;
      }
      const n = SS * SS, p = o + 1 + x * 3;
      raw[p] = R / n; raw[p + 1] = G / n; raw[p + 2] = B / n;
    }
  }
  const head = new Uint8Array(13), v = new DataView(head.buffer);
  v.setUint32(0, size); v.setUint32(4, size); head[8] = 8; head[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const longDay = day => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const money = s => pdfSafe(String(s)).replace(/^N/, 'NGN ');
export const reportFileName = (r, ext) => `MatchDay-Kitchen-${r.combined ? `Combined-Report-${r.nos.join('-').slice(0, 60)}` : `Report-${r.nos[0]}`}.${ext}`;

// ── PDF ──
export async function salesReportPdf(r) {
  const f = r.figures, doc = new PdfDoc();
  const L = 40, W = doc.w - 80, BOTTOM = doc.h - 50;
  let y = 50;
  const need = h => { if (y + h > BOTTOM) { doc.addPage(); y = 50; } };
  const heading = t => { need(40); y += 14; doc.text(t, L, y, { size: 14, bold: true, color: '#07471A' }); y += 6; doc.line(L, y, L + W, y, { color: '#0E7A26', width: 1.2 }); y += 16; };
  const row = (cells, cols, { bold = false, fill = null } = {}) => {
    need(20);
    if (fill) doc.rect(L, y - 12, W, 18, { fill });
    cells.forEach((c, i) => { const align = cols[i].right ? 'right' : 'left'; doc.text(pdfSafe(c).slice(0, cols[i].max || 60), cols[i].x + (cols[i].right ? cols[i].w : 0), y, { size: 10, bold, align }); });
    y += 18;
  };
  doc.rect(0, 0, doc.w, 76, { fill: '#07471A' });
  doc.text('MATCHDAY KITCHEN SALES REPORT', L, 30, { size: 10, bold: true, color: '#FFC72C' });
  const headLines = wrap(r.heading, W, 17, true).slice(0, 1);
  doc.text(headLines[0] || '', L, 54, { size: 17, bold: true, color: '#FFFFFF' });
  y = 100;
  const span = r.parts.length > 1 ? `${longDay(r.parts[0].day)} to ${longDay(r.parts[r.parts.length - 1].day)}` : longDay(r.parts[0].day);
  doc.text(span, L, y, { size: 11, color: '#374151' }); y += 8;
  const venues = [...new Set(r.parts.map(p => p.venue).filter(Boolean))];
  if (venues.length) { y += 8; doc.text(venues.join(', '), L, y, { size: 11, color: '#374151' }); }

  y += 14;
  const box = (x, label, value) => { doc.rect(x, y, W / 3 - 6, 56, { stroke: '#D0D5DD' }); doc.text(pdfSafe(value), x + 10, y + 26, { size: 15, bold: true }); doc.text(label, x + 10, y + 44, { size: 9, color: '#56635B' }); };
  box(L, 'Total sales', money(f.total)); box(L + W / 3, 'Orders', String(f.totalOrders)); box(L + (2 * W) / 3, 'Items sold', String(f.totalItems));
  y += 70;

  heading('How it was paid');
  const pay = [{ x: L + 6 }, { x: L + 250, w: 70, right: true }, { x: L + 340, w: W - 346, right: true }];
  row(['', 'Orders', 'Sales'], pay, { bold: true, fill: '#F1F4F2' });
  row(['Paid online', f.online.orders, money(f.onlineTotal)], pay);
  row(['Paid on WhatsApp, payment confirmed', f.whatsapp.orders, money(f.whatsappTotal)], pay);
  row(['Total', f.totalOrders, money(f.total)], pay, { bold: true });
  if (f.discountsKobo) { need(16); doc.text(pdfSafe(`Star Points and vouchers took ${money(f.discounts)} off menu prices. Sales are what fans actually paid.`), L, y, { size: 9, color: '#56635B' }); y += 14; }
  if (f.excluded.orders) { need(16); doc.text(pdfSafe(`Not counted: ${f.excluded.orders} paid order${f.excluded.orders === 1 ? '' : 's'} later cancelled, rejected or refunded (${money(f.excludedTotal)}).`), L, y, { size: 9, color: '#56635B' }); y += 14; }

  const slices = pieSlices(f.items);
  if (slices.length) {
    heading('Share of items sold');
    need(190);
    const img = await doc.addPng(piePng(slices));
    if (img) doc.drawImage(L, y - 4, 170, 170, img.id);
    let ly = y + 8;
    slices.forEach((s, i) => { doc.rect(L + 190, ly - 8, 9, 9, { fill: PIE_COLOURS[i % PIE_COLOURS.length] }); doc.text(pdfSafe(`${s.name}: ${s.qty} (${s.share}%)`).slice(0, 62), L + 205, ly, { size: 10 }); ly += 18; });
    y += 182;
  }

  heading('Items, most sold first');
  const it = [{ x: L + 6, w: 20 }, { x: L + 30, max: 42 }, { x: L + 250, w: 40, right: true }, { x: L + 295, w: 45, right: true }, { x: L + 345, w: 50, right: true }, { x: L + 400, w: W - 406, right: true }];
  const itemHead = () => row(['#', 'Item', 'Sold', 'Online', 'WhatsApp', 'Sales'], it, { bold: true, fill: '#F1F4F2' });
  itemHead();
  f.items.forEach(i => { if (y + 18 > BOTTOM) { doc.addPage(); y = 50; itemHead(); } row([i.rank, i.name, i.qty, i.onlineQty, i.whatsappQty, money(i.sales)], it); });
  row(['', 'Total', f.totalItems, '', '', money(f.total)], it, { bold: true });

  if (r.combined) {
    heading('Reports in this combined report');
    const pc = [{ x: L + 6 }, { x: L + 70 }, { x: L + 150, max: 40 }, { x: L + 340, w: 40, right: true }, { x: L + 390, w: W - 396, right: true }];
    row(['Report', 'Date', 'Match', 'Orders', 'Sales'], pc, { bold: true, fill: '#F1F4F2' });
    r.parts.forEach(p => row([p.no, p.day, p.title, p.orders, money(p.total)], pc));
  }
  doc.pages.forEach((_, n) => { doc.cur = doc.pages[n]; doc.text(`MatchDay Kitchen. Page ${n + 1} of ${doc.pages.length}.`, L, doc.h - 24, { size: 8, color: '#56635B' }); });
  return doc.toBytes({ title: r.heading, author: 'MatchDay Kitchen' });
}

// ── Word ──
const x = s => String(s ?? '').replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const run = (t, { b = false, size = 22, color = '' } = {}) => `<w:r><w:rPr>${b ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
const para = (t, o = {}) => `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}<w:spacing w:after="${o.after ?? 120}"/></w:pPr>${run(t, o)}</w:p>`;
const heading = t => `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr>${run(t, { b: true, size: 28, color: '07471A' })}</w:p>`;
const TOTAL_W = 9360;
function table(widths, rows, { rightFrom = 1, boldLast = false } = {}) {
  const cell = (t, i, head, last) => `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F4F2"/>' : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${i >= rightFrom ? '<w:jc w:val="right"/>' : ''}</w:pPr>${run(t, { b: head || last })}</w:p></w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${TOTAL_W}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="D0D5DD"/>`).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.map((r, n) => `<w:tr>${n === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r.map((c, i) => cell(c, i, n === 0, boldLast && n === rows.length - 1)).join('')}</w:tr>`).join('')}</w:tbl>`;
}
export function salesReportDocx(r) {
  const f = r.figures, slices = pieSlices(f.items);
  const span = r.parts.length > 1 ? `${longDay(r.parts[0].day)} to ${longDay(r.parts[r.parts.length - 1].day)}` : longDay(r.parts[0].day);
  const venues = [...new Set(r.parts.map(p => p.venue).filter(Boolean))].join(', ');
  const EMU = 2743200; // 3 inches
  const picture = slices.length ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${EMU}" cy="${EMU}"/><wp:docPr id="1" name="Pie chart" descr="${x(`Pie chart of items sold: ${slices.map(s => `${s.name} ${s.share}%`).join(', ')}`)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="pie.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdPie"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${EMU}" cy="${EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` : '';
  const legend = slices.length ? `<w:tbl><w:tblPr><w:tblW w:w="${TOTAL_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="360"/><w:gridCol w:w="9000"/></w:tblGrid>${slices.map((s, i) => `<w:tr><w:tc><w:tcPr><w:tcW w:w="360" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${PIE_COLOURS[i % PIE_COLOURS.length].slice(1)}"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/></w:tcPr><w:p>${run(`${s.name}: ${s.qty} (${s.share}%)`)}</w:p></w:tc></w:tr>`).join('')}</w:tbl>` : '';
  const body = [
    para('MATCHDAY KITCHEN SALES REPORT', { b: true, size: 20, color: '0E7A26', after: 40 }),
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:after="60"/></w:pPr>${run(r.heading, { b: true, size: 36, color: '07471A' })}</w:p>`,
    para(span, { color: '374151', after: venues ? 20 : 200 }),
    venues ? para(venues, { color: '374151', after: 200 }) : '',
    table([3120, 3120, 3120], [['Total sales', 'Orders', 'Items sold'], [f.total, String(f.totalOrders), String(f.totalItems)]], { rightFrom: 9 }),
    heading('How it was paid'),
    table([5160, 1600, 2600], [['', 'Orders', 'Sales'], ['Paid online', String(f.online.orders), f.onlineTotal], ['Paid on WhatsApp, payment confirmed', String(f.whatsapp.orders), f.whatsappTotal], ['Total', String(f.totalOrders), f.total]], { boldLast: true }),
    f.discountsKobo ? para(`Star Points and vouchers took ${f.discounts} off menu prices. Sales are what fans actually paid.`, { size: 18, color: '56635B' }) : '',
    f.excluded.orders ? para(`Not counted: ${f.excluded.orders} paid order${f.excluded.orders === 1 ? '' : 's'} later cancelled, rejected or refunded (${f.excludedTotal}).`, { size: 18, color: '56635B' }) : '',
    slices.length ? heading('Share of items sold') : '', picture, legend,
    heading('Items, most sold first'),
    table([560, 3700, 900, 1000, 1200, 2000], [['#', 'Item', 'Sold', 'Online', 'WhatsApp', 'Sales'], ...f.items.map(i => [String(i.rank), i.name, String(i.qty), String(i.onlineQty), String(i.whatsappQty), i.sales]), ['', 'Total', String(f.totalItems), '', '', f.total]], { rightFrom: 2, boldLast: true }),
    ...(r.combined ? [heading('Reports in this combined report'), table([1000, 1500, 3760, 1000, 2100], [['Report', 'Date', 'Match', 'Orders', 'Sales'], ...r.parts.map(p => [String(p.no), p.day, p.title, String(p.orders), p.total])], { rightFrom: 3 })] : []),
  ].join('');
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files = {
    '[Content_Types].xml': strToU8(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'docProps/core.xml': strToU8(`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(r.heading)}</dc:title><dc:creator>MatchDay Kitchen</dc:creator></cp:coreProperties>`),
    'word/_rels/document.xml.rels': strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${slices.length ? '<Relationship Id="rIdPie" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pie.png"/>' : ''}</Relationships>`),
    'word/styles.xml': strToU8(`${XML}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`),
    'word/document.xml': strToU8(`${XML}<w:document ${NS}><w:body>${body}<w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1270" w:right="1273" w:bottom="1270" w:left="1273" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  };
  if (slices.length) files['word/media/pie.png'] = piePng(slices);
  return zipSync(files);
}
