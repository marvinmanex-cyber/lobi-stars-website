import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { ensureProgrammeSchema, programmeStats } from '../../../_lib/programme.js';
import { ensureFanSchema } from '../../../_lib/fans.js';

// GET /api/admin/programmes/:id/stats -- unique readers, opens, downloads,
// clicks per quick link, views of pages 1-4, new fans gained, QR sources.
export async function onRequestGet({ request, env, params }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    await ensureProgrammeSchema(env.DB);
    await ensureFanSchema(env.DB);
    const p = await env.DB.prepare(`SELECT id FROM programmes WHERE id = ?`).bind(Number(params.id) || 0).first();
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    return Response.json(await programmeStats(env.DB, p.id));
  } catch (err) {
    console.error('[admin programmes] stats', err);
    return Response.json({ error: 'Could not load the stats.' }, { status: 500 });
  }
}
