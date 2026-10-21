// Shared by the AI Fix admin API (functions/api/admin/ai/): Super Admins only
// (permission ai.fix), and changes must come from this website (Origin check,
// on top of the SameSite=Strict admin cookie).
import { requireAdminUser } from './adminEvents.js';
import { can } from './adminRoles.js';
import { ensureAiSchema } from './claude.js';

export const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

export async function aiGuard(request, env, { write = false } = {}) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  if (!can(admin, 'ai.fix')) return { denied: json({ error: 'AI Fix is for Super Admins only.' }, 403) };
  if (write) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return { denied: json({ error: 'This request must come from the Lobi Stars admin.' }, 403) };
  }
  await ensureAiSchema(env.DB);
  return { admin };
}
