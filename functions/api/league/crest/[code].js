import { ensureLeagueSchema } from '../../_lib/leagueDb.js';
import { logoFile } from '../../_lib/logoFiles.js';

// GET /api/league/crest/<code> -- the club's crest (its transparent copy when
// there is one), or the club's initials as plain text in the club colour when
// there is no crest yet (no circle behind them).
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function placeholderCrest(t) {
  const words = String(t.short_name || t.name).replace(/\bFC\b/g, '').trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  const colour = /^#[0-9a-fA-F]{6}$/.test(t.colour || '') ? t.colour : '#5B6470';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${esc(t.name)}"><text x="32" y="42" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="${colour}">${esc(initials)}</text></svg>`;
}

export async function onRequestGet({ request, env, params }) {
  const code = String(params.code || '').toUpperCase();
  if (!/^[A-Z0-9]{2,5}$/.test(code)) return new Response('Not found', { status: 404 });
  try {
    await ensureLeagueSchema(env);
    const t = await env.DB.prepare(`SELECT name, short_name, crest_url, colour FROM league_teams WHERE code = ?`).bind(code).first();
    if (!t) return new Response('Not found', { status: 404 });
    if (t.crest_url && /^(\/[^/]|https:\/\/)/.test(t.crest_url)) return Response.redirect(new URL(logoFile(t.crest_url), request.url).toString(), 302);
    return new Response(placeholderCrest(t), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' } });
  } catch (err) {
    console.error('[league] crest', err);
    return new Response('Not found', { status: 404 });
  }
}
