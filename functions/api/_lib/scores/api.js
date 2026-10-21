// Shared by the score verification admin API (functions/api/admin/scores/):
// permission matchday.scores (Website & Data Officer = Matchday Admin, and
// Super Admins), checked here on the server; changes must come from this
// website (Origin check, on top of the SameSite=Strict admin cookie).
import { requireAdminUser } from '../adminEvents.js';
import { can, roleOf } from '../adminRoles.js';
import { ensureScoreSchema } from './model.js';

export const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

export async function scoresGuard(request, env, { write = false } = {}) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  if (!can(admin, 'matchday.scores')) return { denied: json({ error: 'Score verification is for the Website & Data Officer and Super Admins.' }, 403) };
  if (write) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return { denied: json({ error: 'This request must come from the Lobi Stars admin.' }, 403) };
  }
  await ensureScoreSchema(env);
  return { admin, superAdmin: roleOf(admin) === 'super_admin' };
}
