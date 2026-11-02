import { ensureAccreditationSchema, eventById } from '../../../_lib/mediaAccreditation.js';
import { matchSettings, cardHtml, printPage } from '../../../_lib/accreditationCards.js';
import { mcLog, mediaActor } from '../../../_lib/mediaCentre.js';

// GET /api/media-centre/accreditations/:id/card -- one card (front and back), ready to print (4 x 6 in).
export async function onRequestGet({ request, env, params, data }) {
  await ensureAccreditationSchema(env.DB);
  const r = await env.DB.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(params.id).first();
  if (!r || !['approved', 'revoked'].includes(r.status)) return new Response('Not found', { status: 404 });
  const e = await eventById(env.DB, r.event_id);
  if (!e) return new Response('Match not found', { status: 404 });
  const ms = await matchSettings(env.DB, e);
  await mcLog(env.DB, mediaActor(data.mc.user), 'download_card', { section: 'accreditation', itemType: 'accreditation', itemId: r.id, itemTitle: `${r.full_name} (${r.number})`, request });
  return new Response(printPage(`Card ${r.number}: ${r.full_name}`, [cardHtml(r, e, ms)]), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
