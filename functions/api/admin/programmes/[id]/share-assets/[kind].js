import { requireAdminUser } from '../../../../_lib/adminEvents.js';
import { ensureProgrammeSchema, r2Keys, streamObject } from '../../../../_lib/programme.js';

// GET /api/admin/programmes/:id/share-assets/:kind.jpg (card | square | story) -- staff download / preview.
export async function onRequestGet({ request, env, params }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const kind = String(params.kind || '').replace(/\.jpg$/, '');
  if (!['card', 'square', 'story'].includes(kind)) return new Response('Not found', { status: 404 });
  await ensureProgrammeSchema(env.DB);
  const p = await env.DB.prepare(`SELECT slug, share_assets_version FROM programmes WHERE id = ?`).bind(Number(params.id) || 0).first();
  if (!p || !p.share_assets_version) return new Response('Not found', { status: 404 });
  return streamObject(env, r2Keys(p.slug, p.share_assets_version).share[kind], {
    'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="lobi-stars-programme-${kind}.jpg"`,
  });
}
