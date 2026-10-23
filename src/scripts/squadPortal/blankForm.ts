// Printable blank forms (PDF) for players and for coaches / staff, made on this
// device from the SAME question list as the online form (src/lib/squadFields.js),
// so any change to a question changes the printed form too. The admin prints it,
// the player or staff member fills it in by hand and returns it with the documents,
// and the admin then types the answers into the portal.
import { FIELDS, SECTIONS, fieldsFor, labelOf } from '../../lib/squadFields.js';

type FieldDef = any;
import { PdfDoc, wrap, textWidth } from '../../../functions/api/_lib/pdfLite.js';

type Kind = 'player' | 'staff';
const W = 595.28, H = 841.89, M = 40, BOTTOM = H - 46, LABEL_W = 200;
// Club colours: blue, red and white.
const BLUE = '#1C3F7A', RED = '#C8102E', INK = '#15181D', GREY = '#5B6472', LINE = '#9AA1AC';
const plain = (s: unknown) => String(s ?? '').replace(/›/g, '>').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

/**
 * The club crest (transparent PNG) drawn on the header colour and made a JPEG
 * (the PDF holds JPEG images only), so it sits on the band with no white square.
 * Only in a browser; elsewhere the form has no crest.
 */
async function crestOn(bg: string): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;
  try {
    const img = new Image();
    img.src = '/images/lobi-stars-fc-transparent.png';
    await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 320;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 320, 320);
    ctx.drawImage(img, 0, 0, 320, 320);
    const blob: Blob | null = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch { return null; }
}

export async function blankFormPdf(kind: Kind, season: string): Promise<Uint8Array> {
  const doc = new PdfDoc();
  let page = 1, y = M;
  const title = kind === 'player' ? 'Players data form' : 'Staff data form';
  const footer = () => {
    doc.line(M, H - 34, W - M, H - 34, { color: '#E2E4E9' });
    doc.text(`Lobi Stars FC · ${title} · ${season} season`, M, H - 20, { size: 8, color: GREY });
    doc.text(`Page ${page}`, W - M, H - 20, { size: 8, color: GREY, align: 'right' });
  };
  const need = (h: number) => { if (y + h > BOTTOM) { footer(); doc.addPage(); page++; y = M; } };
  const box = (x: number, yy: number, s = 9) => doc.rect(x, yy, s, s, { stroke: INK, lineWidth: 0.8 });
  const para = (t: string, { size = 9, bold = false, color = INK, indent = 0, gap = 3 } = {}) => {
    const lines = wrap(plain(t), W - 2 * M - indent, size, bold);
    need(lines.length * (size + 3) + gap);
    for (const l of lines) { doc.text(l, M + indent, y + size, { size, bold, color }); y += size + 3; }
    y += gap;
  };
  const writeLine = (x: number, w: number) => doc.line(x, y + 16, x + w, y + 16, { color: LINE, width: 0.7 });
  const heading = (t: string) => {
    need(40); y += 6;
    doc.rect(M, y, W - 2 * M, 20, { fill: BLUE });
    doc.rect(M, y, 5, 20, { fill: RED });
    doc.text(plain(t), M + 12, y + 14, { size: 10.5, bold: true, color: '#FFFFFF' });
    y += 28;
  };

  // ── Header: blue band, red and white stripes, the crest with no box around it ──
  doc.rect(0, 0, W, 92, { fill: BLUE });
  doc.rect(0, 92, W, 6, { fill: RED });
  doc.rect(0, 98, W, 2, { fill: '#FFFFFF' });
  const crest = await crestOn(BLUE);
  if (crest && doc.setJpeg(crest)) doc.drawImage(M - 4, 10, 72, 72);
  doc.text('Lobi Stars FC', M + 80, 36, { size: 20, bold: true, color: '#FFFFFF' });
  doc.text(title, M + 80, 58, { size: 14, bold: true, color: '#FFFFFF' });
  doc.text(`${season} season`, M + 80, 76, { size: 9.5, color: '#C9D8F2' });
  y = 114;
  para(`Please write clearly in CAPITAL LETTERS and answer every question marked *. Return this form to the club with the documents listed below. The club types your answers into its records and checks them.`, { size: 9.5 });

  // Office use.
  need(46);
  doc.rect(M, y, W - 2 * M, 40, { stroke: '#D0D5DD' });
  doc.text('For club use', M + 8, y + 12, { size: 8, bold: true, color: BLUE });
  const half = (W - 2 * M - 16) / 2;
  doc.text('Received by / date:', M + 8, y + 30, { size: 8.5, color: GREY }); doc.line(M + 92, y + 31, M + half, y + 31, { color: LINE });
  doc.text('Entered online by / date:', M + 16 + half, y + 30, { size: 8.5, color: GREY }); doc.line(M + 120 + half, y + 31, W - M - 8, y + 31, { color: LINE });
  y += 50;

  // Documents to attach.
  heading('Documents to attach');
  const docs = kind === 'player'
    ? ['A copy of the passport or official ID (for the names and date of birth)', 'A recent photo: face and shoulders, plain light background, in Lobi Stars kit if possible (or the club takes one)', 'Evidence of any international career: call-up letter, federation squad list or official report', 'For players under 18: this form signed by a parent or guardian']
    : ['A copy of the passport or official ID (for the names and date of birth)', 'A recent photo: face and shoulders, plain light background, in club staff wear if possible (or the club takes one)', 'Copies of coaching licences and professional qualifications'];
  for (const d of docs) {
    const lines = wrap(plain(d), W - 2 * M - 18, 9);
    need(lines.length * 12 + 4);
    box(M, y + 1);
    lines.forEach((l, i) => doc.text(l, M + 16, y + 9 + i * 12, { size: 9 }));
    y += lines.length * 12 + 4;
  }

  // ── The questions (form order; the club-only and retired ones are left out) ──
  const fields = fieldsFor(kind) as FieldDef[];
  // On paper some hints are worded differently (paperHint), or left out (empty).
  const paperHint = (f: FieldDef): string => (f.paperHint !== undefined ? f.paperHint : f.hint) || '';
  const label = (f: FieldDef) => (f.key === 'interestingFact' && kind === 'staff' ? 'An interesting fact about the coach / staff member' : labelOf(f, kind));
  const short = (f: FieldDef) => ['text', 'name', 'handle', 'email', 'tel', 'url', 'number', 'date', 'day', 'month', 'country'].includes(f.type) || (f.type === 'select' && (f.options || []).length > 12);
  const labelCell = (f: FieldDef, width = LABEL_W - 8) => {
    const t = `${label(f)}${f.required ? ' *' : f.optional ? ' (optional)' : ''}`;
    return wrap(plain(t), width, 9, true);
  };
  const ask = (f: FieldDef) => {
    if (f.type === 'checkbox') {
      const lines = wrap(plain(`${label(f)}${f.required ? ' *' : ''}`), W - 2 * M - 18, 9);
      need(lines.length * 12 + 6);
      box(M, y + 1);
      lines.forEach((l, i) => doc.text(l, M + 16, y + 9 + i * 12, { size: 9 }));
      y += lines.length * 12 + 6;
      return;
    }
    const hint = paperHint(f) ? wrap(plain(paperHint(f)), W - 2 * M - LABEL_W, 7.5) : [];
    if (short(f)) {
      const lab = labelCell(f);
      const h = Math.max(lab.length * 11, 18) + hint.length * 9 + 6;
      need(h);
      lab.forEach((l, i) => doc.text(l, M, y + 10 + i * 11, { size: 9, bold: true }));
      const x = M + LABEL_W;
      if (f.type === 'date' || f.type === 'day') doc.text('Day ____ / Month ____ / Year ________', x, y + 12, { size: 9.5, color: GREY });
      else if (f.type === 'month') doc.text('Month ____ / Year ________', x, y + 12, { size: 9.5, color: GREY });
      else { writeLine(x, W - M - x); if (f.type === 'handle') doc.text('@', x, y + 13, { size: 9, color: GREY }); if (f.type === 'number' && f.key === 'heightCm') doc.text('cm', W - M - 14, y + 13, { size: 9, color: GREY }); }
      hint.forEach((l, i) => doc.text(l, x, y + Math.max(lab.length * 11, 18) + 6 + i * 9, { size: 7.5, color: GREY }));
      y += h;
      return;
    }
    // Long answers, choices and tables: the question across the page, the answer below.
    const lab = labelCell(f, W - 2 * M);
    // Keep the question together with its answer space (never alone at the foot of a page).
    const textLines = (f.max || 300) > 300 ? 4 : 3, tableRows = f.key === 'honours' ? 3 : 4;
    const block = f.type === 'rows' ? 26 + tableRows * 20 : f.type === 'textarea' || f.type === 'richtext' ? textLines * 18 + 4 : 40;
    const hintLines = paperHint(f) ? wrap(plain(paperHint(f)), W - 2 * M, 7.5).length : 0;
    need(lab.length * 11 + hintLines * 9 + 8 + block);
    lab.forEach((l, i) => doc.text(l, M, y + 10 + i * 11, { size: 9, bold: true }));
    y += lab.length * 11 + 2;
    const fullHint = paperHint(f) ? wrap(plain(paperHint(f)), W - 2 * M, 7.5) : [];
    fullHint.forEach(l => { doc.text(l, M, y + 8, { size: 7.5, color: GREY }); y += 9; });
    y += 4;
    if (f.type === 'select' || f.type === 'multiselect') {
      if (f.type === 'multiselect') { doc.text('(tick all that apply)', M, y + 8, { size: 7.5, color: GREY }); y += 11; }
      let x = M;
      for (const o of f.options || []) {
        const w = 16 + textWidth(plain(o), 9) + 14;
        if (x + w > W - M) { x = M; y += 15; need(16); }
        box(x, y + 1); doc.text(plain(o), x + 13, y + 9, { size: 9 });
        x += w;
      }
      y += 20;
    } else if (f.type === 'textarea' || f.type === 'richtext') {
      const n = (f.max || 300) > 300 ? 4 : 3;
      need(n * 18 + 4);
      for (let i = 0; i < n; i++) { writeLine(M, W - 2 * M); y += 18; }
      y += 4;
    } else if (f.type === 'rows') {
      const cols = f.columns || [], rows = f.key === 'honours' ? 3 : 4;
      const cw = (W - 2 * M) / cols.length;
      need(18 + rows * 20);
      doc.rect(M, y, W - 2 * M, 16, { fill: BLUE });
      cols.forEach((c, i) => doc.text(plain(c.type === 'select' ? `${c.label} (${(c.options || []).join(' / ')})` : c.label), M + 4 + i * cw, y + 11, { size: 7.5, bold: true, color: '#FFFFFF' }));
      y += 16;
      for (let r = 0; r < rows; r++) {
        doc.rect(M, y, W - 2 * M, 20, { stroke: '#D0D5DD', lineWidth: 0.6 });
        cols.forEach((_, i) => { if (i) doc.line(M + i * cw, y, M + i * cw, y + 20, { color: '#D0D5DD' }); });
        y += 20;
      }
      y += 8;
    }
  };

  const confirm = fields.filter(f => f.section === 'confirm' && !f.minorOnly), minor = fields.filter(f => f.minorOnly);
  for (const s of SECTIONS) {
    if (['type', 'photos', 'confirm'].includes(s.id) || (s.for !== 'all' && s.for !== kind)) continue;
    const list = fields.filter(f => f.section === s.id && !f.minorOnly);
    if (!list.length) continue;
    heading(s.id === 'role' ? 'Role & qualifications' : s.label);
    for (const f of list) {
      if (f.showIf) { const [k, v] = Object.entries(f.showIf)[0]; para(`If "${v}" for ${String(FIELDS.find(x => x.key === k)?.label || k).toLowerCase()}:`, { size: 7.5, color: GREY, gap: 0 }); }
      ask(f);
    }
  }

  // Photo.
  heading('Photo');
  para(kind === 'player'
    ? 'Attach one recent photo (or the club will take it): face and shoulders, facing the camera, plain light background, good daylight, no caps, sunglasses or filters, in the official Lobi Stars kit if possible.'
    : 'Attach one recent photo (or the club will take it): face and shoulders, facing the camera, plain light background, good daylight, no caps, sunglasses or filters, in club staff wear if possible.', { size: 9 });

  // Confirmation and signatures.
  heading('Confirmation');
  confirm.forEach(ask);
  need(56); y += 6;
  const sig = (t: string) => { doc.text(t, M, y + 12, { size: 9, bold: true }); doc.line(M + 150, y + 13, M + 330, y + 13, { color: LINE }); doc.text('Date:', M + 345, y + 12, { size: 9, bold: true }); doc.line(M + 375, y + 13, W - M, y + 13, { color: LINE }); y += 24; };
  sig(kind === 'player' ? 'Signature of the player' : 'Signature of the staff member');
  sig('Completed with (club staff)');
  if (kind === 'player' && minor.length) {
    heading('Parent or guardian (players under 18 only)');
    minor.forEach(ask);
    need(30); y += 4; sig('Signature of parent / guardian');
  }
  footer();
  return doc.toBytes({ title: `Lobi Stars FC – ${title}` });
}
