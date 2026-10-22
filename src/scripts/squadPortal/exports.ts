// Squad & Staff Data Portal: downloads, made on this device (the website's
// server only sends the profiles and their photos). PDF and Word to read and
// print; Excel and CSV; JSON; and the Media Partner Data Package (ZIP) with
// data.json (checked against schema.json before download), CSV files, photos,
// recordings, the club badge, schema.json and README.txt. Portal and normal
// admin downloads never contain private details (the server removes them).
// "Full club records" (Super Admins) is the only download with private details.
import { zipSync, strToU8 } from 'fflate';
import { FIELDS, labelOf, ageOn } from '../../lib/squadFields.js';
import { buildPackage, validatePackage, SCHEMA, SCHEMA_VERSION, lagosIso, sortPlayers, sortStaff } from '../../lib/squadPackage.js';
import { buildXlsx, buildCsv } from '../../../functions/api/_lib/xlsx.js';
import { PdfDoc, wrap, jpegInfo } from '../../../functions/api/_lib/pdfLite.js';

type Format = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'json' | 'zip' | 'records-xlsx' | 'records-pdf';
export type ExportOpts = { place: 'portal' | 'admin'; format: Format; which: string; season: string; status: (t: string, ok?: boolean) => void; button?: HTMLButtonElement; extra?: Record<string, string> };
type Prof = { id: string; type: 'player' | 'staff'; status: string; statusLabel: string; season: string; updatedAt: string; updatedBy: string; fileBase: string; data: any; hasAudio: boolean; hasAction: boolean; hasPhoto: boolean; files: any };

const adminHeaders = () => ({ 'Content-Type': 'application/json', 'x-admin-code': sessionStorage.getItem('ls_admin_code') || '__session__' });
const today = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
const lagosDate = (iso?: string) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '';
const plain = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, ''); // PDF built-in fonts: no accents
const csrf = () => (window as any).__squadCsrf || '';

async function getData(o: ExportOpts) {
  const full = o.format.startsWith('records');
  const qs = new URLSearchParams({ which: o.which, season: o.season });
  let r: Response;
  if (o.place === 'portal') r = await fetch(`/api/squad-portal/export-data?${qs}`, { credentials: 'same-origin', cache: 'no-store' });
  else if (full) r = await fetch('/api/admin/squad-profiles', { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ action: 'full_records', which: o.which, season: o.season, code: o.extra?.code || '' }) });
  else r = await fetch(`/api/admin/squad-profiles?export=1&${qs}`, { headers: adminHeaders(), cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'The profiles could not be loaded.');
  return d as { season: string; seasonKey: string; filters: any; team: any; profiles: Prof[]; full: boolean };
}
async function log(o: ExportOpts, profiles: number, ok: boolean, note?: string) {
  const body = { format: o.format, which: o.which, season: o.season, profiles, ok, note };
  try {
    if (o.place === 'portal') {
      const { state } = await import('./api');
      await fetch('/api/squad-portal/export-data', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || csrf() }, body: JSON.stringify(body) });
    } else await fetch('/api/admin/squad-profiles', { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ action: 'export_log', ...body }) });
  } catch { /* the download itself worked */ }
}
async function bytesOf(url: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const r = await fetch(url, { credentials: 'same-origin', headers: url.startsWith('/api/squad-portal/') ? {} : {} });
    if (!r.ok) return null;
    return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('Content-Type') || '' };
  } catch { return null; }
}
function save(name: string, data: Uint8Array | string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ── Table layouts (shared by Excel and CSV) ──
const sv = (v: unknown) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v);
const PRIVATE_COLS = ['fullName', 'dob', 'phone', 'email', 'emergencyName', 'emergencyPhone', 'guardianName', 'guardianPhone'];
function playerRows(ps: Prof[], full: boolean) {
  const cols = ['ID', 'Season', 'Status', 'Display name', 'Nickname', 'Shirt number', 'Primary position', 'Secondary positions', 'Preferred foot', 'Height (cm)', 'Age', 'Nationality', 'State of origin', 'Hometown and LGA', 'Social handle', 'Joined', 'International experience', 'Pronunciation', 'Career highlight', 'Role model', 'Interesting fact', 'Last updated'];
  const priv = full ? ['Full legal name', 'Date of birth', 'Phone', 'Email', 'Emergency contact', 'Emergency phone', 'Guardian name', 'Guardian phone'] : [];
  const rows = ps.map(p => { const d = p.data; return [p.id, p.season, p.statusLabel, d.displayName, d.nickname, d.shirtNumber, d.primaryPosition, d.secondaryPositions, d.preferredFoot, d.heightCm, d.dob ? ageOn(d.dob) : d.age, d.nationality === 'Other' ? d.nationalityOther : d.nationality, d.stateOfOrigin, d.hometown, d.social, d.joined, d.international, d.pronunciation, d.careerHighlight, d.roleModel, d.interestingFact, lagosDate(p.updatedAt), ...(full ? PRIVATE_COLS.map(k => d[k]) : [])].map(sv); });
  return { columns: [...cols, ...priv], rows };
}
function staffRows(ps: Prof[], full: boolean) {
  const cols = ['ID', 'Season', 'Status', 'Display name', 'Nickname', 'Role', 'Age', 'Nationality', 'State of origin', 'Hometown and LGA', 'Social handle', 'Joined', 'Qualifications', 'Playing career', 'Pronunciation', 'Philosophy', 'Career highlight', 'Interesting fact', 'Last updated'];
  const priv = full ? ['Full legal name', 'Date of birth', 'Phone', 'Email', 'Emergency contact', 'Emergency phone'] : [];
  const rows = ps.map(p => { const d = p.data; return [p.id, p.season, p.statusLabel, d.displayName, d.nickname, d.role === 'Other' ? d.roleOther : d.role, d.dob ? ageOn(d.dob) : d.age, d.nationality === 'Other' ? d.nationalityOther : d.nationality, d.stateOfOrigin, d.hometown, d.social, d.joinedStaff, d.qualifications, d.playingCareer, d.pronunciation, d.philosophy, d.careerHighlight, d.interestingFact, lagosDate(p.updatedAt), ...(full ? PRIVATE_COLS.slice(0, 6).map(k => d[k]) : [])].map(sv); });
  return { columns: [...cols, ...priv], rows };
}
function careerRows(ps: Prof[]) {
  return { columns: ['Profile ID', 'Name', 'Type', 'Club', 'Start year', 'End year', 'Position held', 'Period'], rows: ps.flatMap(p => p.type === 'player'
    ? (p.data.previousClubs || []).map((r: any) => [p.id, p.data.displayName, 'Player', r.club, r.startYear ?? '', r.endYear ?? '', '', ''])
    : (p.data.previousRoles || []).map((r: any) => [p.id, p.data.displayName, 'Staff', r.club, '', '', r.position, r.period])) };
}
function honourRows(ps: Prof[]) {
  return { columns: ['Profile ID', 'Name', 'Type', 'Honour or award', 'Season or year', 'Club or team'], rows: ps.flatMap(p => (p.data.honours || []).map((r: any) => [p.id, p.data.displayName, p.type === 'player' ? 'Player' : 'Staff', r.title, r.seasonOrYear, r.clubOrTeam])) };
}
const ordered = (ps: Prof[]) => {
  const pl = ps.filter(p => p.type === 'player'), st = ps.filter(p => p.type === 'staff');
  const byId = new Map(ps.map(p => [p.id, p]));
  const fake = (p: Prof) => ({ id: p.id, primaryPosition: p.data.primaryPosition || '', shirtNumber: p.data.shirtNumber ?? null, role: p.data.role || '', displayName: p.data.displayName || '' });
  return [...sortPlayers(pl.map(fake)).map((x: any) => byId.get(x.id)!), ...sortStaff(st.map(fake)).map((x: any) => byId.get(x.id)!)];
};

// ── PDF (A4) ──
async function buildPdf(d: Awaited<ReturnType<typeof getData>>, full: boolean) {
  const doc = new PdfDoc();
  const W = 595.28, M = 44;
  const badge = await bytesOf('/images/lobi-stars-badge-print.jpg');
  if (badge) doc.setJpeg(badge.bytes);
  // Cover
  doc.rect(0, 0, W, 300, { fill: '#B3121A' });
  if (badge) doc.drawImage(W / 2 - 60, 60, 120, 120);
  doc.text('Lobi Stars FC', W / 2, 220, { size: 30, bold: true, color: '#FFFFFF', align: 'center' });
  doc.text(full ? 'Full club records (private)' : 'Squad & Staff Profiles', W / 2, 252, { size: 18, color: '#FFE7A0', align: 'center' });
  doc.text(`Season: ${plain(d.season)}`, M, 360, { size: 14, bold: true });
  doc.text(`Exported: ${lagosDate(new Date().toISOString())}`, M, 384, { size: 12 });
  doc.text(`Profiles: ${d.profiles.length} (${plain(d.filters.status)}, ${plain(d.filters.type)})`, M, 404, { size: 12 });
  const footer = full ? 'CONFIDENTIAL: includes private details. Club use only.' : 'Private details are held by the club.';
  const foot = () => doc.text(footer, W / 2, 820, { size: 9, color: '#4A505C', align: 'center' });
  foot();
  for (const p of ordered(d.profiles)) {
    doc.addPage();
    let y = M;
    const photo = p.files?.profile?.jpg ? await bytesOf(p.files.profile.jpg) : null;
    const img = photo ? doc.addJpeg(photo.bytes) : null;
    if (img) doc.drawImage(M, y, 136, 170, img.id);
    else doc.rect(M, y, 136, 170, { fill: '#F3F4F6' });
    const x = M + 156, dd = p.data;
    doc.text(plain(dd.displayName || 'Unnamed').toUpperCase(), x, y + 26, { size: 22, bold: true });
    const sub = p.type === 'player' ? `#${dd.shirtNumber ?? '-'} · ${plain(dd.primaryPosition || '')}` : plain(dd.role === 'Other' ? dd.roleOther : dd.role || '');
    doc.text(sub, x, y + 50, { size: 14, color: '#B3121A', bold: true });
    doc.text(`${p.statusLabel} · last updated ${lagosDate(p.updatedAt)}`, x, y + 70, { size: 9, color: '#4A505C' });
    y += 190;
    const fields = FIELDS.filter((f: any) => (f.for === 'all' || f.for === p.type) && f.type !== 'rows' && f.type !== 'checkbox' && (full || f.use !== 'private'));
    for (const f of fields) {
      let v = dd[f.key];
      if (f.key === 'dob' && !full) continue;
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      v = Array.isArray(v) ? v.join(', ') : String(v);
      const lines = wrap(plain(v), W - M * 2 - 170, 10);
      if (y + lines.length * 13 > 790) { foot(); doc.addPage(); y = M; }
      doc.text(plain(labelOf(f, p.type)), M, y, { size: 9, color: '#4A505C' });
      lines.forEach((l: string, i: number) => doc.text(l, M + 170, y + i * 13, { size: 10 }));
      y += lines.length * 13 + 5;
    }
    const age = dd.dob ? ageOn(dd.dob) : dd.age;
    if (age != null && !full) { doc.text('Age', M, y, { size: 9, color: '#4A505C' }); doc.text(String(age), M + 170, y, { size: 10 }); y += 18; }
    const table = (title: string, head: string[], rows: string[][]) => {
      if (!rows.length) return;
      if (y + 40 > 790) { foot(); doc.addPage(); y = M; }
      y += 8; doc.text(title.toUpperCase(), M, y, { size: 11, bold: true, color: '#B3121A' }); y += 14;
      const cw = (W - M * 2) / head.length;
      doc.rect(M, y - 10, W - M * 2, 16, { fill: '#16181D' });
      head.forEach((h, i) => doc.text(h, M + 4 + i * cw, y + 2, { size: 9, bold: true, color: '#FFFFFF' }));
      y += 18;
      for (const r of rows) {
        if (y > 790) { foot(); doc.addPage(); y = M; }
        r.forEach((c, i) => doc.text(plain(wrap(plain(c), cw - 8, 9)[0] || ''), M + 4 + i * cw, y, { size: 9 }));
        doc.line(M, y + 5, W - M, y + 5, { color: '#E2E4E9' });
        y += 15;
      }
    };
    if (p.type === 'player') table('Previous clubs', ['Club', 'Start year', 'End year'], (dd.previousClubs || []).map((r: any) => [r.club, r.startYear ?? '', r.endYear ?? ''].map(String)));
    else table('Previous clubs and positions', ['Club', 'Position held', 'Period'], (dd.previousRoles || []).map((r: any) => [r.club, r.position, r.period].map(String)));
    table(p.type === 'player' ? 'Honours and individual awards' : 'Honours and achievements', ['Honour or award', 'Season or year', 'Club or team'], (dd.honours || []).map((r: any) => [r.title, r.seasonOrYear, r.clubOrTeam].map(String)));
    foot();
  }
  return doc.toBytes({ title: full ? 'Lobi Stars FC – Full club records' : 'Lobi Stars FC – Squad & Staff Profiles' });
}

// ── Word (.docx) ──
const x = (s: unknown) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function buildDocx(d: Awaited<ReturnType<typeof getData>>, full: boolean) {
  const media: Record<string, Uint8Array> = {}, rels: string[] = [];
  let n = 0;
  const run = (t: string, o: { b?: boolean; sz?: number; color?: string } = {}) => `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.sz ? `<w:sz w:val="${o.sz}"/>` : ''}</w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  const para = (inner: string, o: { center?: boolean; after?: number } = {}) => `<w:p><w:pPr>${o.center ? '<w:jc w:val="center"/>' : ''}<w:spacing w:after="${o.after ?? 80}"/></w:pPr>${inner}</w:p>`;
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const image = (bytes: Uint8Array, widthPx: number) => {
    const info = jpegInfo(bytes); if (!info) return '';
    n++; const name = `image${n}.jpeg`; media[`word/media/${name}`] = bytes;
    rels.push(`<Relationship Id="rIdImg${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    const cx = Math.round(widthPx * 9525), cy = Math.round(widthPx * (info.height / info.width) * 9525);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  const tbl = (head: string[], rows: string[][]) => !rows.length ? '' : `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="E2E4E9"/><w:bottom w:val="single" w:sz="4" w:color="E2E4E9"/><w:insideH w:val="single" w:sz="4" w:color="E2E4E9"/></w:tblBorders></w:tblPr>
    <w:tr>${head.map(h => `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="16181D"/></w:tcPr>${para(run(h, { b: true, color: 'FFFFFF', sz: 18 }), { after: 0 })}</w:tc>`).join('')}</w:tr>
    ${rows.map(r => `<w:tr>${r.map(c => `<w:tc>${para(run(c, { sz: 18 }), { after: 0 })}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
  const body: string[] = [];
  const badge = await bytesOf('/images/lobi-stars-badge-print.jpg');
  if (badge) body.push(para(image(badge.bytes, 140), { center: true }));
  body.push(para(run('Lobi Stars FC', { b: true, sz: 56, color: 'B3121A' }), { center: true }));
  body.push(para(run(full ? 'Full club records (private)' : 'Squad & Staff Profiles', { b: true, sz: 36 }), { center: true }));
  body.push(para(run(`Season: ${d.season}`, { sz: 24 }), { center: true }));
  body.push(para(run(`Exported: ${lagosDate(new Date().toISOString())} · ${d.profiles.length} profiles`, { sz: 22, color: '4A505C' }), { center: true }));
  for (const p of ordered(d.profiles)) {
    const dd = p.data;
    body.push(pageBreak);
    const photo = p.files?.profile?.jpg ? await bytesOf(p.files.profile.jpg) : null;
    if (photo) body.push(para(image(photo.bytes, 180)));
    body.push(para(run(String(dd.displayName || 'Unnamed').toUpperCase(), { b: true, sz: 44 })));
    body.push(para(run(p.type === 'player' ? `#${dd.shirtNumber ?? '–'} · ${dd.primaryPosition || ''}` : String(dd.role === 'Other' ? dd.roleOther : dd.role || ''), { b: true, sz: 28, color: 'B3121A' })));
    body.push(para(run(`${p.statusLabel} · last updated ${lagosDate(p.updatedAt)}`, { sz: 18, color: '4A505C' })));
    const fields = FIELDS.filter((f: any) => (f.for === 'all' || f.for === p.type) && f.type !== 'rows' && f.type !== 'checkbox' && (full || f.use !== 'private'));
    const facts: string[][] = [];
    for (const f of fields) { const v = dd[f.key]; if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue; facts.push([labelOf(f, p.type), Array.isArray(v) ? v.join(', ') : String(v)]); }
    const age = dd.dob ? ageOn(dd.dob) : dd.age; if (age != null && !full) facts.push(['Age', String(age)]);
    body.push(tbl(['Detail', 'Answer'], facts));
    if (p.type === 'player') { body.push(para(run('Previous clubs', { b: true, sz: 24, color: 'B3121A' }))); body.push(tbl(['Club', 'Start year', 'End year'], (dd.previousClubs || []).map((r: any) => [r.club, r.startYear ?? '', r.endYear ?? ''].map(String)))); }
    else { body.push(para(run('Previous clubs and positions', { b: true, sz: 24, color: 'B3121A' }))); body.push(tbl(['Club', 'Position held', 'Period'], (dd.previousRoles || []).map((r: any) => [r.club, r.position, r.period].map(String)))); }
    body.push(para(run(p.type === 'player' ? 'Honours and individual awards' : 'Honours and achievements', { b: true, sz: 24, color: 'B3121A' })));
    body.push(tbl(['Honour or award', 'Season or year', 'Club or team'], (dd.honours || []).map((r: any) => [r.title, r.seasonOrYear, r.clubOrTeam].map(String))));
  }
  const footerText = full ? 'CONFIDENTIAL: includes private details. Club use only.' : 'Private details are held by the club.';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/footer1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${para(run(footerText, { sz: 16, color: '4A505C' }), { center: true })}</w:ftr>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${rels.join('')}</Relationships>`),
    ...media,
  };
  return zipSync(files, { level: 6 });
}

// ── The Data Package and JSON ──
function packageFor(d: Awaited<ReturnType<typeof getData>>, relative: boolean) {
  const files = relative
    ? { photo: (p: any, kind: string) => (kind === 'profile' ? (p.hasPhoto ? `photos/${p.fileBase}.jpg` : null) : `photos/${p.fileBase}-action.jpg`), audio: (p: any) => `audio/${p.fileBase}-pronunciation.mp3` }
    : { photo: (p: any, kind: string) => (kind === 'profile' ? (p.hasPhoto ? `photos/${p.fileBase}.jpg` : null) : `photos/${p.fileBase}-action.jpg`), audio: (p: any) => `audio/${p.fileBase}-pronunciation.mp3` };
  return buildPackage({ profiles: d.profiles, team: d.team, season: d.seasonKey === 'all' ? 'all' : d.season, filters: d.filters, files });
}
function readme(d: Awaited<ReturnType<typeof getData>>, counts: { photos: number; audio: number }) {
  return [
    'LOBI STARS FC – MEDIA PARTNER DATA PACKAGE', '', `Exported: ${lagosIso()} (Africa/Lagos)`, `Season: ${d.season}`, `Filters: ${d.filters.status} profiles, ${d.filters.type}`, `schemaVersion: ${SCHEMA_VERSION}`, '',
    'FILES', 'data.json      All profiles: players and staff with previous clubs, honours, notes and photo/audio paths (see schema.json).',
    'schema.json    JSON Schema describing data.json. data.json was checked against it before download.',
    'players.csv    One row per player (UTF-8).', 'staff.csv      One row per coach / staff member (UTF-8).', 'career.csv     Previous clubs (players) and previous clubs and positions (staff).', 'honours.csv    Honours and awards.',
    `photos/        Profile and action photos: 1200 px JPG and WebP, named like 09-musa-adeyemi.jpg (${counts.photos} files).`,
    `audio/         Name pronunciation recordings (MP3), e.g. 09-musa-adeyemi-pronunciation.mp3 (${counts.audio} files).`,
    'team/          The club badge (lobi-stars-crest.png).', '',
    'Photo and audio paths in data.json are relative to this ZIP (e.g. "photos/09-musa-adeyemi.jpg").',
    'Private details (legal names, dates of birth, phone numbers, email addresses, emergency and guardian contacts) are held by the club and are not included.', '',
  ].join('\r\n');
}

export async function runExport(o: ExportOpts) {
  const label = o.button?.textContent || '';
  if (o.button) { o.button.disabled = true; o.button.textContent = 'Preparing…'; }
  o.status('Preparing the download…');
  let count = 0;
  try {
    const d = await getData(o);
    count = d.profiles.length;
    if (!count) { o.status('No profiles match these choices.', false); return; }
    const full = o.format.startsWith('records');
    const date = today(), base = full ? `lobi-stars-full-club-records-${date}` : `lobi-stars-squad-${date}`;
    const pl = d.profiles.filter(p => p.type === 'player'), st = d.profiles.filter(p => p.type === 'staff');
    if (o.format === 'json' || o.format === 'zip') {
      const pkg = packageFor(d, true);
      const errs = validatePackage(pkg);
      if (errs.length) { o.status(`Not downloaded: ${errs.length} problem${errs.length === 1 ? '' : 's'} found. ${errs.slice(0, 4).join(' · ')}`, false); await log(o, count, false, errs.slice(0, 5).join(' | ')); return; }
      if (o.format === 'json') save(`${base}.json`, JSON.stringify(pkg, null, 2), 'application/json');
      else {
        const files: Record<string, Uint8Array> = {
          'data.json': strToU8(JSON.stringify(pkg, null, 2)), 'schema.json': strToU8(JSON.stringify(SCHEMA, null, 2)),
          'players.csv': strToU8(buildCsv(playerRows(pl, false).columns, playerRows(pl, false).rows)), 'staff.csv': strToU8(buildCsv(staffRows(st, false).columns, staffRows(st, false).rows)),
          'career.csv': strToU8(buildCsv(careerRows(d.profiles).columns, careerRows(d.profiles).rows)), 'honours.csv': strToU8(buildCsv(honourRows(d.profiles).columns, honourRows(d.profiles).rows)),
        };
        let photos = 0, audio = 0, i = 0;
        for (const p of d.profiles) {
          o.status(`Adding photos and recordings… ${++i} of ${count}`);
          for (const kind of ['profile', 'action']) {
            const f = p.files?.[kind]; if (!f) continue;
            const name = `${p.fileBase}${kind === 'action' ? '-action' : ''}`;
            const jpg = await bytesOf(f.jpg); if (jpg) { files[`photos/${name}.jpg`] = jpg.bytes; photos++; }
            const webp = await bytesOf(f.webp); if (webp && webp.type.includes('webp')) { files[`photos/${name}.webp`] = webp.bytes; photos++; }
          }
          if (p.files?.audio) { const a = await bytesOf(p.files.audio); if (a) { files[`audio/${p.fileBase}-pronunciation.mp3`] = a.bytes; audio++; } }
        }
        const crest = await bytesOf('/images/lobi-stars-crest.png'); if (crest) files['team/lobi-stars-crest.png'] = crest.bytes;
        files['README.txt'] = strToU8(readme(d, { photos, audio }));
        // Every relative path in data.json must exist in the ZIP.
        const missing = [...pkg.players, ...pkg.staff].flatMap((x: any) => [x.photos?.profile, x.photos?.action, x.pronunciationAudio]).filter((pth: any) => pth && !files[pth]);
        if (missing.length) { o.status(`Not downloaded: these files could not be fetched: ${missing.slice(0, 4).join(', ')}. Check the connection and try again.`, false); await log(o, count, false, `missing ${missing.length} files`); return; }
        save(`lobi-stars-data-package-${date}.zip`, zipSync(files, { level: 6 }), 'application/zip');
      }
    } else if (o.format === 'csv') {
      const files = { 'players.csv': strToU8(buildCsv(playerRows(pl, false).columns, playerRows(pl, false).rows)), 'staff.csv': strToU8(buildCsv(staffRows(st, false).columns, staffRows(st, false).rows)),
        'career.csv': strToU8(buildCsv(careerRows(d.profiles).columns, careerRows(d.profiles).rows)), 'honours.csv': strToU8(buildCsv(honourRows(d.profiles).columns, honourRows(d.profiles).rows)) };
      save(`${base}-csv.zip`, zipSync(files, { level: 6 }), 'application/zip');
    } else if (o.format === 'xlsx' || o.format === 'records-xlsx') {
      const p1 = playerRows(pl, full), s1 = staffRows(st, full), c1 = careerRows(d.profiles), h1 = honourRows(d.profiles);
      const summary = { columns: ['Item', 'Value'], rows: [['Club', 'Lobi Stars FC'], ['Season', d.season], ['Exported', lagosDate(new Date().toISOString())], ['Profiles', count], ['Players', pl.length], ['Staff', st.length], ['Filters', `${d.filters.status}, ${d.filters.type}`], ['Note', full ? 'CONFIDENTIAL: includes private details. Club use only.' : 'Private details are held by the club.']] };
      save(`${base}.xlsx`, buildXlsx([{ name: 'Players', ...p1 }, { name: 'Staff', ...s1 }, { name: 'Previous clubs', ...c1 }, { name: 'Honours', ...h1 }, { name: 'Summary', ...summary }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else if (o.format === 'pdf' || o.format === 'records-pdf') {
      save(`${base}.pdf`, await buildPdf(d, full), 'application/pdf');
    } else if (o.format === 'docx') {
      save(`${base}.docx`, await buildDocx(d, false), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }
    o.status(`Downloaded: ${count} profile${count === 1 ? '' : 's'}.`);
    await log(o, count, true);
  } catch (e: any) {
    o.status(e.message || 'The download could not be made.', false);
    await log(o, count, false, String(e.message || '').slice(0, 200));
  } finally {
    if (o.button) { o.button.disabled = false; o.button.textContent = label; }
  }
}
