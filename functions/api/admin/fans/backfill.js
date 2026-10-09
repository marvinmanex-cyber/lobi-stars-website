import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { backfillContacts } from '../../_lib/contacts.js';

// POST /api/admin/fans/backfill -- imports every existing newsletter, member,
// ticket, food order, enquiry and download record into the fan database.
// Safe to run more than once (nothing is added twice).
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const result = await backfillContacts(env.DB);
  await logAdminAction(env.DB, admin, 'fan_backfill', `${result.added} added from ${result.records} records`);
  return Response.json({ ok: true, ...result });
}
