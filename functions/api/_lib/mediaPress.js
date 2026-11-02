// Media Centre › Press Releases & Statements: a fixed layout (headline, date,
// FOR IMMEDIATE RELEASE, body, quote, media contact, ENDS), always approved by
// a Super Admin. Published releases appear on /media/press-releases (rendered
// from the database, a permanent archive), have an automatic branded PDF, and
// are emailed to the media contacts list.
import { sanitizeHtml, textOf } from './mediaSanitize.js';
import { slugify } from './mediaNews.js';
import { PdfDoc, pdfSafe, wrap } from './pdfLite.js';
import { sendEmail } from './email.js';
import { oneLine, clean, mcSettings, parseJson, ensureMediaSchema } from './mediaCentre.js';
import { setPublic, fileIdsIn } from './mediaFiles.js';

const SITE = 'https://lobistarsfc.com';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const prDate = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });

async function normalise(d) {
  d = d || {};
  return { value: {
    headline: oneLine(d.headline, 160), subheadline: oneLine(d.subheadline, 240),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || '')) ? String(d.date) : '',
    location: oneLine(d.location, 60) || 'MAKURDI',
    body: await sanitizeHtml(d.body, { max: 40000 }),
    quote: clean(d.quote, 1200), quoteBy: oneLine(d.quoteBy, 120),
    contact: clean(d.contact, 400),
    statement: !!d.statement,
  } };
}
function validate(v) {
  if (v.headline.length < 8) return 'Write the headline.';
  if (!v.date) return 'Choose the release date.';
  if (textOf(v.body).length < 60) return 'Write the release (at least a short paragraph).';
  if (v.quote && !v.quoteBy) return 'Say who the quote is from.';
  return null;
}
export function releaseHtml(v, { publishedAt = null, contactFallback = '' } = {}) {
  return `<article class="pr">
    <p class="pr-imm">${v.statement ? 'OFFICIAL STATEMENT' : 'FOR IMMEDIATE RELEASE'}</p>
    <h1 class="pr-h">${esc(v.headline)}</h1>${v.subheadline ? `<p class="pr-sub">${esc(v.subheadline)}</p>` : ''}
    <p class="pr-date"><b>${esc(v.location)}</b>, ${esc(prDate(v.date || publishedAt || new Date().toISOString()))} –</p>
    <div class="pr-body">${v.body}</div>
    ${v.quote ? `<blockquote class="pr-quote"><p>“${esc(v.quote)}”</p><footer>${esc(v.quoteBy)}</footer></blockquote>` : ''}
    <p class="pr-ends">ENDS</p>
    <section class="pr-contact"><h2>Media contact</h2><p>${esc(v.contact || contactFallback).replace(/\n/g, '<br>')}</p></section>
  </article>`;
}
const previewHtml = v => releaseHtml(v);

/** The branded PDF (A4). */
export async function releasePdf(env, v, { publishedAt, contact }) {
  const doc = new PdfDoc();
  const W = doc.w, M = 56, BLUE = '#4C76B2', RED = '#EE343C';
  doc.rect(0, 0, W, 86, { fill: BLUE }); doc.rect(0, 86, W, 5, { fill: RED });
  try { const res = await env.ASSETS.fetch(new Request(`${SITE}/images/lobi-stars-badge-print.jpg`)); if (res.ok) { const img = doc.addJpeg(new Uint8Array(await res.arrayBuffer())); if (img) doc.drawImage(M - 10, 12, 62, 62, img.id); } } catch { /* no badge */ }
  doc.text('LOBI STARS FOOTBALL CLUB', M + 66, 40, { size: 17, bold: true, color: '#FFFFFF' });
  doc.text('McCarthy Stadium, Makurdi, Benue State · lobistarsfc.com', M + 66, 60, { size: 9.5, color: '#FFFFFF' });
  let y = 126;
  const page = () => { doc.addPage(); y = 60; };
  const para = (text, { size = 11, bold = false, color = '#16181D', gap = 8, x = M, width = W - 2 * M } = {}) => {
    for (const l of wrap(pdfSafe(text), width, size, bold)) { if (y > 790) page(); doc.text(l, x, y, { size, bold, color }); y += size * 1.4; }
    y += gap;
  };
  para(v.statement ? 'OFFICIAL STATEMENT' : 'FOR IMMEDIATE RELEASE', { size: 10, bold: true, color: RED, gap: 10 });
  para(v.headline, { size: 19, bold: true, gap: 6 });
  if (v.subheadline) para(v.subheadline, { size: 12, color: '#4A505C', gap: 10 });
  para(`${v.location}, ${prDate(v.date || publishedAt)} -`, { size: 11, bold: true, gap: 6 });
  // The body: paragraphs, headings and list items from the HTML.
  const blocks = String(v.body).replace(/<\/(p|h2|h3|li|blockquote)>/gi, '\n\n').replace(/<li[^>]*>/gi, '• ').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  for (const b of blocks) para(b);
  if (v.quote) { y += 4; para(`"${v.quote}"`, { size: 12, color: '#16181D', x: M + 16, width: W - 2 * M - 32, gap: 2 }); para(`- ${v.quoteBy}`, { size: 10.5, bold: true, x: M + 16, gap: 12 }); }
  para('ENDS', { size: 11, bold: true, gap: 16 });
  if (y > 740) page();
  doc.line(M, y, W - M, y, { color: '#DDE3EC' }); y += 18;
  para('Media contact', { size: 10, bold: true, color: BLUE, gap: 2 });
  for (const l of String(contact || '').split('\n')) para(l, { size: 10, gap: 0 });
  return doc.toBytes({ title: v.headline, author: 'Lobi Stars FC' });
}

async function publish(env, r, v) {
  const db = env.DB;
  const slug = r.slug || `${(v.date || new Date().toISOString().slice(0, 10))}-${slugify(v.headline)}`.slice(0, 90);
  const clash = await db.prepare(`SELECT id FROM mc_items WHERE kind = 'press' AND slug = ? AND id <> ?`).bind(slug, r.id).first();
  const finalSlug = clash ? `${slug}-${r.id.slice(-4).toLowerCase()}` : slug;
  await setPublic(db, fileIdsIn(v), true);
  // Email everyone subscribed to the press list (first publication only; recorded under Press List › Sent messages).
  let note = `Published at /media/press-releases/${finalSlug}/.`;
  if (!r.published_at && env.RESEND_API_KEY) {
    const settings = await mcSettings(db);
    const pdf = await releasePdf(env, v, { publishedAt: new Date().toISOString(), contact: v.contact || settings.press_contact }).catch(() => null);
    let b64 = null; if (pdf) { let x = ''; for (let i = 0; i < pdf.length; i += 0x8000) x += String.fromCharCode(...pdf.subarray(i, i + 0x8000)); b64 = btoa(x); }
    const { sendReleaseToList } = await import('./pressList.js');
    const esc2 = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const body = `<h1 style="font-size:24px;line-height:1.2;margin:0 0 10px;color:#0E2A55">${esc2(v.headline)}</h1>${v.subheadline ? `<p><b>${esc2(v.subheadline)}</b></p>` : ''}${v.body}${v.quote ? `<blockquote style="margin:16px 0;padding:10px 14px;border-left:4px solid #D62839;background:#F7F8FA"><i>“${esc2(v.quote)}”</i><br><b>${esc2(v.quoteBy)}</b></blockquote>` : ''}<p style="text-align:center;font-weight:bold;letter-spacing:3px">ENDS</p>`;
    const res = await sendReleaseToList(env, { releaseId: r.id, subject: `${v.statement ? 'Statement' : 'Press release'}: ${v.headline}`, body, url: `${SITE}/media/press-releases/${finalSlug}/`, label: v.statement ? 'Official statement' : 'Press release', attachment: b64 ? { filename: `${finalSlug}.pdf`, content: b64 } : null }).catch(e => { console.error('[press] list', e); return { sent: 0 }; });
    note += ` Emailed to ${res.sent} press list contact${res.sent === 1 ? '' : 's'}.`;
  } else if (!r.published_at) note += ' Email is not set up, so it was not emailed to the press list.';
  return { ok: true, slug: finalSlug, note };
}

export const PRESS = {
  label: 'Press release', section: 'press', schedulable: true,
  normalise, validate, previewHtml, publish, unpublish: async () => ({ ok: true }),
  titleOf: v => v.headline || '(untitled press release)',
  adminFields: [
    { key: 'headline', label: 'Headline', type: 'text' }, { key: 'subheadline', label: 'Sub-headline', type: 'text' }, { key: 'date', label: 'Release date (YYYY-MM-DD)', type: 'text' },
    { key: 'body', label: 'Body (HTML)', type: 'html' }, { key: 'quote', label: 'Quote', type: 'textarea' }, { key: 'quoteBy', label: 'Quote from', type: 'text' }, { key: 'contact', label: 'Media contact', type: 'textarea' },
  ],
};

/** Published releases (newest first) for the public pages. */
export async function publishedReleases(db) {
  await ensureMediaSchema(db);
  return (await db.prepare(`SELECT id, slug, live_json, published_at FROM mc_items WHERE kind = 'press' AND status = 'published' ORDER BY published_at DESC LIMIT 300`).all()).results
    .map(r => ({ id: r.id, slug: r.slug, publishedAt: r.published_at, ...parseJson(r.live_json, {}) }));
}
