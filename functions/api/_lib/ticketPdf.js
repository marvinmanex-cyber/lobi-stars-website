// The match tickets of a basket as a PDF, one page per ticket, designed like
// the ticket email (navy and gold, crests, date / kick-off / venue bar, stub
// with the QR code). Attached to the ticket email and downloaded from the
// ticket pages (/api/tickets/pdf). The QR code is drawn as squares and opens
// the same verification page as /api/qr/{id}, so the gate scanner reads it.
import qrcodeGenerator from 'qrcode-generator';
import { PdfDoc, pdfSafe, wrap, textWidth } from './pdfLite.js';
import { lagosParts, splitVenue } from './fixtureCard.js';
import { TEAM_LOGOS } from './teamLogos.js';
import { TIER_LABELS } from './tickets/rules.js';

const SITE = 'https://lobistarsfc.com';
const NAVY = '#0D1A33', NAVY2 = '#0A1226', GOLD = '#C9A227', GREY = '#5A6270', CHILD = '#FFC72C';
const W = 340, H = 640; // points: a phone-shaped page

/** A team's crest, the same file as on the website: a see-through PNG (no white box), or a JPEG if that is all the site has. */
async function crestImage(env, doc, team) {
  const path = TEAM_LOGOS[team];
  if (!path) return null;
  try {
    const res = await env.ASSETS.fetch(new Request(`${SITE}${path}`));
    const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    if (!bytes) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8) { const img = doc.addJpeg(bytes); return img && { ...img, boxed: true }; }
    return await doc.addPng(bytes);
  } catch { return null; }
}

/** Draws the QR code as rows of black runs (far fewer boxes than one per module). */
function drawQr(doc, text, x, y, size) {
  const qr = qrcodeGenerator(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), cell = size / n;
  for (let row = 0; row < n; row++) {
    let start = -1;
    for (let col = 0; col <= n; col++) {
      const dark = col < n && qr.isDark(row, col);
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) { doc.rect(x + start * cell, y + row * cell, (col - start) * cell + 0.3, cell + 0.3, { fill: '#000000' }); start = -1; }
    }
  }
}

/**
 * matches: the shape basketTickets returns ([{ homeTeam, awayTeam, kickoff, venue, tier, tickets: [{ id, status, type, priceKobo }] }]).
 * Only tickets that can still be used (not cancelled) are included. Returns PDF bytes, or null when there are none.
 */
export async function ticketsPdf(env, { reference, matches }) {
  const doc = new PdfDoc({ width: W, height: H });
  const imgIds = new Map();
  const imgFor = async team => {
    if (!imgIds.has(team)) imgIds.set(team, await crestImage(env, doc, team));
    return imgIds.get(team);
  };
  let pages = 0;
  for (const m of matches) {
    const live = m.tickets.filter(t => t.status !== 'void');
    for (const [i, t] of live.entries()) {
      if (pages++) doc.addPage();
      await ticketPage(doc, m, t, i, live.length, await imgFor(m.homeTeam), await imgFor(m.awayTeam));
    }
  }
  if (!pages) return null;
  return doc.toBytes({ title: `Lobi Stars FC match tickets ${reference || ''}`.trim(), author: 'Lobi Stars FC' });
}

async function ticketPage(doc, m, t, i, of, homeImg, awayImg) {
  const when = lagosParts(m.kickoff);
  const venue = splitVenue(m.venue);
  const stand = TIER_LABELS[m.tier] || m.tier;
  // Gold frame and navy top half.
  doc.rect(0, 0, W, H, { fill: GOLD });
  doc.rect(4, 4, W - 8, 330, { fill: NAVY });
  doc.rect(4, 250, W - 8, 84, { fill: NAVY2 });
  doc.text('NIGERIA NATIONAL LEAGUE', W / 2, 30, { size: 7.5, color: '#8C94A6', align: 'center' });
  doc.text('OFFICIAL MATCH TICKET', W / 2, 50, { size: 14, bold: true, color: GOLD, align: 'center' });
  // Crests (or the team's initial in a gold ring).
  const crest = (team, img, cx) => {
    if (img) {
      // Fitted into a 60-point square, keeping its shape; a JPEG (white background) sits on a white box.
      const s = 60 / Math.max(img.width, img.height), w = img.width * s, h = img.height * s;
      if (img.boxed) doc.rect(cx - 30, 66, 60, 60, { fill: '#FFFFFF' });
      doc.drawImage(cx - w / 2, 66 + (60 - h) / 2, w, h, img.id);
    }
    else { doc.rect(cx - 30, 66, 60, 60, { stroke: GOLD, lineWidth: 1.5 }); doc.text(pdfSafe(team).charAt(0).toUpperCase(), cx, 106, { size: 26, bold: true, color: '#FFFFFF', align: 'center' }); }
  };
  crest(m.homeTeam, homeImg, W / 2 - 62); crest(m.awayTeam, awayImg, W / 2 + 62);
  doc.text('VS', W / 2, 101, { size: 12, bold: true, color: GOLD, align: 'center' });
  // Team names (wrapped to two lines when long).
  let y = 150;
  for (const l of wrap(`${m.homeTeam} vs ${m.awayTeam}`, W - 40, 16, true).slice(0, 2)) { doc.text(l, W / 2, y, { size: 16, bold: true, color: '#FFFFFF', align: 'center' }); y += 20; }
  // White info bar: DATE | KICK-OFF | VENUE.
  const by = 186, bw = W - 40, col = bw / 3;
  doc.rect(20, by, bw, 56, { fill: '#F4F5F7' });
  doc.line(20 + col, by + 8, 20 + col, by + 48, { color: '#D5D9DF' }); doc.line(20 + col * 2, by + 8, 20 + col * 2, by + 48, { color: '#D5D9DF' });
  const cell = (label, lines, cx) => {
    doc.text(label, cx, by + 15, { size: 6.5, bold: true, color: GREY, align: 'center' });
    lines.slice(0, 3).forEach((l, k) => doc.text(l, cx, by + 28 + k * 9, { size: k === 0 ? 8 : 7, bold: k === 0, color: k === 0 ? NAVY : GREY, align: 'center' }));
  };
  cell('DATE', wrap(when?.date || 'To be confirmed', col - 8, 8, true), 20 + col / 2);
  cell('KICK-OFF', [when?.time || 'TBC'], 20 + col * 1.5);
  cell('VENUE', [...wrap(venue.name || '', col - 8, 8, true).slice(0, 2), ...(venue.place ? [pdfSafe(venue.place)] : [])], 20 + col * 2.5);
  doc.text('TICKET NO', W / 2, 268, { size: 6.5, color: '#8C94A6', align: 'center' });
  doc.text(pdfSafe(t.id), W / 2, 284, { size: 11, bold: true, color: '#FFFFFF', align: 'center' });
  doc.text(`Ticket ${i + 1} of ${of}`, W / 2, 300, { size: 7.5, color: '#8C94A6', align: 'center' });
  doc.text('Keep it private: anyone with this code can use it.', W / 2, 318, { size: 7, color: '#8C94A6', align: 'center' });
  // Tear line, then the white stub with the QR code.
  for (let x = 12; x < W - 12; x += 10) doc.line(x, 342, x + 5, 342, { color: NAVY, width: 1 });
  doc.rect(4, 348, W - 8, H - 352, { fill: '#FFFFFF' });
  doc.text('MATCH TICKET', W / 2, 370, { size: 10, bold: true, color: NAVY, align: 'center' });
  const qs = 132, qx = (W - qs) / 2, qy = 382;
  doc.rect(qx - 7, qy - 7, qs + 14, qs + 14, { stroke: '#E2E6ED', lineWidth: 1 });
  drawQr(doc, `${SITE}/verify/${t.id}`, qx, qy, qs);
  doc.text('VERIFY TICKET', W / 2, qy + qs + 24, { size: 7.5, bold: true, color: NAVY, align: 'center' });
  doc.text('Scan the QR code to confirm this ticket is genuine.', W / 2, qy + qs + 35, { size: 7, color: GREY, align: 'center' });
  // Stand, ADULT / CHILD and price.
  const standY = qy + qs + 56;
  doc.text(pdfSafe(stand).toUpperCase(), W / 2, standY, { size: 12, bold: true, color: NAVY, align: 'center' });
  const type = t.type === 'child' ? 'CHILD' : 'ADULT';
  const tw = textWidth(type, 8, true) + 14;
  doc.rect(W / 2 - tw / 2, standY + 7, tw, 14, { fill: t.type === 'child' ? CHILD : '#E8EBF0' });
  doc.text(type, W / 2, standY + 17, { size: 8, bold: true, color: NAVY, align: 'center' });
  if (t.priceKobo != null) {
    // The built-in font has no ₦: an N with the two strokes drawn through it.
    const price = `N${Math.round(t.priceKobo / 100).toLocaleString('en-NG')}`, py = standY + 38;
    const x0 = W / 2 - textWidth(price, 12, true) / 2, nw = textWidth('N', 12, true);
    doc.text(price, W / 2, py, { size: 12, bold: true, color: NAVY, align: 'center' });
    for (const dy of [-5.2, -3]) doc.line(x0 - 1, py + dy, x0 + nw + 1, py + dy, { color: NAVY, width: 0.9 });
  }
  doc.text('One scan per ticket, on the day of the match only.  lobistarsfc.com', W / 2, H - 14, { size: 6.5, color: GREY, align: 'center' });
}
