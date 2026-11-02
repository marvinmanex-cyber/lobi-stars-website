import { ensureAccreditationSchema, eventById } from '../../_lib/mediaAccreditation.js';
import { matchSettings, cardHtml, printPage } from '../../_lib/accreditationCards.js';
import { mcLog, mediaActor } from '../../_lib/mediaCentre.js';

// GET /api/media-centre/accreditations/print?event=<id> -- every approved card for a match
// (front and back, by accreditation number), with a Print button and 4 x 6 in print pages.
export async function onRequestGet({ request, env, data }) {
  await ensureAccreditationSchema(env.DB);
  const e = await eventById(env.DB, new URL(request.url).searchParams.get('event') || '');
  if (!e) return new Response('Match not found', { status: 404 });
  const ms = await matchSettings(env.DB, e);
  const { results } = await env.DB.prepare(`SELECT * FROM mc_accreditations WHERE event_id = ? AND status = 'approved' ORDER BY seq`).bind(e.id).all();
  await mcLog(env.DB, mediaActor(data.mc.user), 'print_cards', { section: 'accreditation', itemType: 'match', itemId: e.id, itemTitle: `Lobi Stars FC vs ${ms.opponent}`, details: `${results.length} card(s)`, request });
  return new Response(printPage(`Lobi Stars FC vs ${ms.opponent}: ${results.length} approved card${results.length === 1 ? '' : 's'}`, results.map(r => cardHtml(r, e, ms))), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
