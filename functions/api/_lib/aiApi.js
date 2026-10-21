// Shared by the AI Fix admin API (functions/api/admin/ai/). Two levels, both
// checked here on the server:
//   ai.prepare (roles with all reports): see AI Fix, ask Claude to prepare a fix,
//              Ask Claude, Fix history and Fix results;
//   ai.fix     (Super Admins only): apply, edit, undo, discard, Fix all, settings,
//              code proposals.
// Changes must come from this website (Origin check, on top of the SameSite=Strict cookie).
import { requireAdminUser } from './adminEvents.js';
import { can } from './adminRoles.js';
import { ensureAiSchema } from './claude.js';

export const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
export const SUPER_ONLY = 'Only Super Admins can do this (applying, editing, undoing and settings).';

export async function aiGuard(request, env, { write = false, superOnly = false } = {}) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  const superAdmin = can(admin, 'ai.fix');
  if (!superAdmin && (superOnly || !can(admin, 'ai.prepare'))) return { denied: json({ error: superOnly ? SUPER_ONLY : 'AI Fix is not part of your role.' }, 403) };
  if (write) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return { denied: json({ error: 'This request must come from the Lobi Stars admin.' }, 403) };
  }
  await ensureAiSchema(env.DB);
  return { admin, superAdmin };
}
