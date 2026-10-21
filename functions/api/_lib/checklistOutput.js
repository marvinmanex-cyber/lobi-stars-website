// Match Checklist output: the PDF (report and print views) and the emails
// (the "Email checklist" message and the daily reminder digest).
// Links in PDFs and emails are absolute and go through
// /admin/match-checklist/go/?task=<id>, which survives the login page
// (anything after '#' would be lost) and builds the task page's address then.
import { PdfDoc, wrap, textWidth } from './pdfLite.js';
import { PHASES, PHASE_LABEL, STATUS_LABEL, CLOSED_TASK, fmtLagos, lagosDay, offsetLabel } from './matchChecklist.js';

export const siteBase = env => String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
export const goLink = (base, taskId) => `${base}/admin/match-checklist/go/?task=${encodeURIComponent(taskId)}`;
export const checklistLink = (base, checklistId, taskId) => `${base}/admin/match-checklist/?id=${encodeURIComponent(checklistId)}${taskId ? `#task-${taskId}` : ''}`;
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'match';
export const pdfFilename = c => `checklist-${slug(c.match.home)}-vs-${slug(c.match.away)}-${lagosDay(Date.parse(c.match.kickoff || c.kickoffAt))}.pdf`;
export const headline = c => `${c.match.home} vs ${c.match.away}`;
export const detailsLine = c => [c.match.competition, c.match.matchday ? `Matchday ${c.match.matchday}` : '', c.match.venue, `${fmtLagos(c.match.kickoff || c.kickoffAt)} (Lagos time)`].filter(Boolean).join(' · ');
/** A short address for the print view: no scheme, no tracking, at most 70 characters. */
export function shortUrl(u) {
  const s = String(u || '').replace(/^https?:\/\//, '').replace(/[?&]from=checklist&task=\d+/, '').replace(/\?$/, '');
  return s.length > 70 ? `${s.slice(0, 67)}...` : s;
}

const STATUS_COLOR = { done: '#17643A', not_applicable: '#6B7280', submitted_for_review: '#1D4ED8', in_progress: '#B45309', not_started: '#5B6470' };

/** The checklist as PDF bytes. mode 'report' (statuses) or 'print' (empty tick boxes for matchday). */
export function checklistPdf(c, { mode = 'report', generatedBy = 'Lobi Stars FC', base = 'https://lobistarsfc.com', logo = null, now = Date.now() } = {}) {
  const d = new PdfDoc();
  const L = 40, R = 555, W = R - L, BOTTOM = 790;
  if (logo) d.setJpeg(logo);
  let y = 0;
  const header = first => {
    if (first) {
      if (d.image) d.drawImage(L, 30, 48, Math.round(48 * d.image.height / d.image.width));
      const x = d.image ? L + 60 : L;
      d.text(mode === 'print' ? 'MATCH CHECKLIST · PRINT VIEW' : 'MATCH CHECKLIST', x, 44, { size: 9, bold: true, color: '#E31E24' });
      const hl = wrap(headline(c), R - x, 20, true);
      let hy = 66;
      for (const line of hl.slice(0, 2)) { d.text(line, x, hy, { size: 20, bold: true }); hy += 22; }
      for (const line of wrap(detailsLine(c), R - x, 9.5).slice(0, 2)) { d.text(line, x, hy, { size: 9.5, color: '#5B6470' }); hy += 13; }
      y = Math.max(hy, 92) + 8;
      const p = c.progress;
      d.text(`${p.finished} of ${p.total} tasks done or not applicable (${p.pct}%)${p.overdue ? ` · ${p.overdue} overdue` : ''}${c.status === 'closed' ? ' · CLOSED' : c.status === 'awaiting_closeout' ? ' · awaiting close-out' : ''}`, L, y, { size: 10, bold: true });
      y += 8;
      d.rect(L, y, W, 7, { fill: '#E5E7EB' });
      if (p.pct) d.rect(L, y, Math.max(3, (W * p.pct) / 100), 7, { fill: '#10B981' });
      y += 22;
    } else {
      d.text(`${headline(c)} · match checklist (continued)`, L, 40, { size: 9, bold: true, color: '#5B6470' });
      y = 58;
    }
  };
  const newPage = () => { d.addPage(); header(false); };
  header(true);

  for (const phase of PHASES) {
    const tasks = c.tasks.filter(t => t.phase === phase);
    if (!tasks.length) continue;
    if (y > BOTTOM - 60) newPage();
    d.rect(L, y, W, 18, { fill: '#15181D' });
    const fin = tasks.filter(t => CLOSED_TASK.has(t.status)).length;
    d.text(PHASE_LABEL[phase].toUpperCase(), L + 8, y + 12.5, { size: 9.5, bold: true, color: '#FFFFFF' });
    d.text(`${fin} of ${tasks.length} done`, R - 8, y + 12.5, { size: 9, color: '#FFFFFF', align: 'right' });
    y += 28;
    for (const t of tasks) {
      const textX = L + 22, textW = W - 22;
      const titleLines = wrap(t.title, textW - 70, 10, true);
      const meta = [`Due ${fmtLagos(t.due_at)}`, `Owner: ${t.owner_name || t.owner_unit || '–'}`, t.priority === 'critical' ? 'CRITICAL' : '', mode === 'report' ? `Status: ${STATUS_LABEL[t.status] || t.status}` : ''].filter(Boolean).join('  ·  ');
      const metaLines = wrap(meta, textW, 8.5);
      const doneLine = mode === 'report' && t.status === 'done' && t.completed_at ? `Completed by ${t.completed_by_name || 'a Super Admin'} at ${fmtLagos(t.completed_at)}` : '';
      const noteLines = t.notes ? wrap(`Notes: ${t.notes}`, textW, 8.5).slice(0, 6) : [];
      const link = t.link && !t.link.broken ? goLink(base, t.id) : '';
      const linkLine = mode === 'print' && t.link?.url && !t.link.broken ? `Go to task: ${shortUrl(goLink(base, t.id))}` : '';
      const h = titleLines.length * 12.5 + metaLines.length * 11 + (doneLine ? 11 : 0) + noteLines.length * 11 + (linkLine ? 11 : 0) + 10;
      if (y + h > BOTTOM) newPage();
      // Box: empty in the print view, otherwise coloured by status (red = overdue).
      const col = t.overdue ? '#B91C1C' : t.status === 'done' ? '#17643A' : t.status === 'not_applicable' ? '#9CA3AF' : null;
      if (mode === 'print') d.rect(L + 2, y - 9, 11, 11, { stroke: '#15181D', lineWidth: 1 });
      else d.rect(L + 2, y - 9, 11, 11, col ? { fill: col } : { stroke: '#9CA3AF', lineWidth: 1 });
      if (mode !== 'print' && t.status === 'done') d.text('v', L + 4.5, y - 0.5, { size: 9, bold: true, color: '#FFFFFF' });
      let ty = y;
      titleLines.forEach((line, i) => {
        d.text(line, textX, ty, { size: 10, bold: true, color: t.status === 'not_applicable' && mode !== 'print' ? '#6B7280' : '#15181D' });
        if (i === 0 && link) d.link(textX, ty - 10, textWidth(line, 10, true), 13, link);
        ty += 12.5;
      });
      if (mode === 'report') {
        const label = t.overdue ? 'OVERDUE' : (STATUS_LABEL[t.status] || '').toUpperCase();
        d.text(label, R, y, { size: 7.5, bold: true, color: t.overdue ? '#B91C1C' : STATUS_COLOR[t.status] || '#5B6470', align: 'right' });
      }
      for (const line of metaLines) { d.text(line, textX, ty, { size: 8.5, color: t.overdue && mode === 'report' ? '#B91C1C' : '#5B6470' }); ty += 11; }
      if (doneLine) { d.text(doneLine, textX, ty, { size: 8.5, color: '#17643A' }); ty += 11; }
      for (const line of noteLines) { d.text(line, textX, ty, { size: 8.5, color: '#374151' }); ty += 11; }
      if (linkLine) { d.text(linkLine, textX, ty, { size: 8, color: '#1D4ED8' }); ty += 11; }
      d.line(L, ty - 4, R, ty - 4, { color: '#E5E7EB' });
      y = ty + 8;
    }
    y += 6;
  }
  // Footer on every page.
  const total = d.pageCount;
  const keep = d.cur;
  d.pages.forEach((ops, i) => {
    d.cur = ops;
    d.text(`Generated on ${fmtLagos(new Date(now).toISOString())} (Lagos time) by ${generatedBy}`, L, 815, { size: 8, color: '#6B7280' });
    d.text(`Page ${i + 1} of ${total} · lobistarsfc.com`, R, 815, { size: 8, color: '#6B7280', align: 'right' });
  });
  d.cur = keep;
  return d.toBytes({ title: `Match checklist: ${headline(c)}`, author: 'Lobi Stars FC' });
}

// ── Emails ──
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const wrapEmail = (inner, preheader = '') => `<!doctype html><html><body style="margin:0;background:#F4F5F7;font-family:Arial,Helvetica,sans-serif;color:#15181D">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;padding:20px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#15181D;padding:16px 22px;color:#FFC72C;font-weight:bold;letter-spacing:1px;font-size:13px">LOBI STARS FC · MATCH CHECKLIST</td></tr>
<tr><td style="padding:22px">${inner}</td></tr>
<tr><td style="padding:14px 22px;background:#F9FAFB;color:#6B7280;font-size:12px">Sent from the Lobi Stars FC admin (lobistarsfc.com). Times are Lagos time.</td></tr>
</table></td></tr></table></body></html>`;
const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:#E31E24;color:#fff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:8px">${esc(label)}</a>`;
const progressHtml = c => `<p style="margin:0 0 6px;font-size:14px"><b>${c.progress.finished} of ${c.progress.total} tasks done (${c.progress.pct}%)</b>${c.progress.overdue ? ` · <span style="color:#B91C1C">${c.progress.overdue} overdue</span>` : ''}</p>
<div style="height:8px;background:#E5E7EB;border-radius:4px;overflow:hidden;margin:0 0 16px"><div style="height:8px;width:${c.progress.pct}%;background:#10B981"></div></div>`;
const taskLine = (t, base) => `<tr><td style="padding:8px 0;border-bottom:1px solid #EEF0F2;font-size:14px">
<b>${esc(t.title)}</b>${t.priority === 'critical' ? ' <span style="background:#FDECEC;color:#A3161B;font-size:11px;font-weight:bold;padding:2px 6px;border-radius:4px">CRITICAL</span>' : ''}<br>
<span style="color:#5B6470;font-size:13px">Due ${esc(fmtLagos(t.due_at))} · Owner: ${esc(t.owner_name || t.owner_unit || '–')}</span>
${t.link && !t.link.broken ? `<br><a href="${esc(goLink(base, t.id))}" style="color:#1D4ED8;font-size:13px">${esc(t.link.label || 'Go to task')} →</a>` : ''}</td></tr>`;

/** The "Email checklist" message (the PDF is attached). */
export function checklistEmail(c, { from, message, base }) {
  const outstanding = c.tasks.filter(t => !CLOSED_TASK.has(t.status));
  const inner = `<h1 style="margin:0 0 4px;font-size:22px">${esc(headline(c))}</h1>
<p style="margin:0 0 14px;color:#5B6470;font-size:13px">${esc(detailsLine(c))}</p>
${message ? `<div style="background:#F9FAFB;border-left:4px solid #FFC72C;padding:10px 12px;margin:0 0 14px;font-size:14px;white-space:pre-line">${esc(message)}</div>` : ''}
${progressHtml(c)}
<p style="margin:0 0 14px;font-size:14px">${outstanding.length ? `${outstanding.length} task${outstanding.length === 1 ? '' : 's'} still open.` : 'Every task is done or not applicable.'} The full checklist is attached as a PDF.</p>
<p style="margin:0 0 6px">${button(checklistLink(base, c.id), 'Open the checklist')}</p>
<p style="margin:14px 0 0;color:#6B7280;font-size:12px">Sent by ${esc(from)}.</p>`;
  return { subject: `Match checklist: ${headline(c)} — ${fmtLagos(c.match.kickoff || c.kickoffAt, { time: false })} (${c.progress.pct}% done)`, html: wrapEmail(inner, `${c.progress.pct}% done`) };
}

/**
 * The daily digest: ONE email per recipient covering every checklist with
 * outstanding tasks (items: [{ checklist, sections }], nearest match first).
 * brokenLinks is only passed for Super Admins.
 */
export function digestEmail(items, { base, subject, brokenLinks = [] }) {
  const block = (title, color, tasks) => tasks.length ? `<h2 style="margin:16px 0 6px;font-size:15px;color:${color}">${esc(title)} (${tasks.length})</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tasks.map(t => taskLine(t, base)).join('')}</table>` : '';
  const one = ({ checklist: c, sections }, i) => `${i ? '<hr style="border:0;border-top:2px solid #EEF0F2;margin:26px 0">' : ''}
<h1 style="margin:0 0 4px;font-size:22px">${esc(headline(c))}</h1>
<p style="margin:0 0 14px;color:#5B6470;font-size:13px">${esc(detailsLine(c))}</p>
${progressHtml(c)}
${block('Overdue', '#B91C1C', sections.overdue)}${block('Due today', '#B45309', sections.today)}${block('Due in the next 3 days', '#15181D', sections.soon)}
<p style="margin:18px 0 0">${button(checklistLink(base, c.id), 'Open the checklist')}</p>`;
  const broken = brokenLinks.length ? `<div style="margin:22px 0 0;background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px 12px;font-size:13px"><b>Broken task links</b> (Super Admins: fix them on Match Checklist › Templates):<br>${brokenLinks.map(b => `• ${esc(b)}`).join('<br>')}</div>` : '';
  const overdue = items.reduce((n, x) => n + x.sections.overdue.length, 0), today = items.reduce((n, x) => n + x.sections.today.length, 0);
  return { subject, html: wrapEmail(items.map(one).join('') + broken, `${overdue} overdue, ${today} due today`) };
}
export { offsetLabel };
