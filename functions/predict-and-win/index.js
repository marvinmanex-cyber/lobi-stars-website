// "/predict-and-win/" -- the page with the saved Predict & Win sponsor filled in on the server
// (Admin › Predict & Win Sponsor): logo or photo with the name, the name only if there is no picture,
// nothing if "Show sponsor" is off.
import { getGameSponsor, publicSponsor } from '../api/_lib/gameSponsors.js';
import { predictBoard, predictBoardHtml } from '../api/_lib/predictBoard.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const predictSponsorHtml = sp => (sp
  ? `<div class="pw-top-sp">${sp.photoUrl ? `<img data-predict-sponsor src="${esc(sp.photoUrl)}" alt="${esc(sp.name)}" width="72" height="72" loading="lazy">` : ''}<p data-predict-sponsor-line>Predict &amp; Win, sponsored by <strong>${esc(sp.name)}</strong></p></div>`
  : '');

export async function onRequestGet({ request, env }) {
  const page = await env.ASSETS.fetch(new URL('/predict-and-win/', request.url));
  if (!page.ok || !(page.headers.get('content-type') || '').includes('text/html')) return page;
  let sp, board = null;
  try { sp = publicSponsor(await getGameSponsor(env.DB, 'predict')); } catch (err) { console.error('[predict page]', err); return page; }
  try { board = await predictBoard(env); } catch (err) { console.error('[predict board]', err); }
  const headers = new Headers(page.headers);
  headers.set('Cache-Control', 'no-store');
  return new HTMLRewriter()
    .on('#predictSponsorTop', { element(e) { e.setInnerContent(predictSponsorHtml(sp), { html: true }); } })
    .on('#predictBoard', { element(e) {
      if (!board) return;
      e.setAttribute('data-state', board.current?.state || '');
      e.setAttribute('data-slug', board.current?.slug || '');
      e.setInnerContent(predictBoardHtml(board), { html: true });
    } })
    .transform(new Response(page.body, { status: page.status, headers }));
}
