import { ensureAccreditationSchema, eventById, letterPdf } from '../../../_lib/mediaAccreditation.js';
import { mcLog, mediaActor } from '../../../_lib/mediaCentre.js';

// GET /api/media-centre/accreditations/:id/letter -- the approval letter (A4 PDF) that was emailed.
export async function onRequestGet({ request, env, params, data }) {
  await ensureAccreditationSchema(env.DB);
  const r = await env.DB.prepare(`SELECT * FROM mc_accreditations WHERE id = ?`).bind(params.id).first();
  if (!r || !['approved', 'revoked'].includes(r.status)) return new Response('Not found', { status: 404 });
  const e = await eventById(env.DB, r.event_id);
  if (!e) return new Response('Match not found', { status: 404 });
  const pdf = await letterPdf(env, r, e);
  await mcLog(env.DB, mediaActor(data.mc.user), 'download_letter', { section: 'accreditation', itemType: 'accreditation', itemId: r.id, itemTitle: `${r.full_name} (${r.number})`, request });
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Lobi-Stars-accreditation-approval-${r.number}.pdf"`, 'Cache-Control': 'no-store' } });
}
