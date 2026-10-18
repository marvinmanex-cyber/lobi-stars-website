import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { verifyTotp } from '../_lib/totp.js';
import { rateLimit, tooMany, ensureFanSchema } from '../_lib/fans.js';
import { looksLikeBackupCode, useBackupCode } from '../_lib/adminSecurity.js';
import { createExportTicket, TICKET_MINUTES } from '../_lib/exportGuard.js';

// POST /api/admin/export-ticket { otp } -- swap a fresh two-step login code (or a
// backup code) for a download pass, valid 5 minutes for this person only. Downloads
// of fans' details send it as x-export-ticket (see exportGuard.js).
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureFanSchema(db);
  if (admin.id === 'owner') return Response.json({ ok: true, ticket: await createExportTicket(db, admin), minutes: TICKET_MINUTES });
  if (!(await rateLimit(db, `export-code:${admin.id}`, 8, 900))) return tooMany();
  const u = await db.prepare(`SELECT id, totp_enabled, totp_secret, totp_last_step FROM admin_users WHERE id = ?`).bind(admin.id).first();
  if (!u?.totp_enabled) return Response.json({ error: "Downloads of fans' details need two-step login. Turn it on in My account first." }, { status: 400 });
  const otp = String((await request.json().catch(() => ({}))).otp || '').trim();
  let ok = false;
  if (looksLikeBackupCode(otp)) ok = (await useBackupCode(db, u.id, otp)) !== null;
  else {
    const step = await verifyTotp(u.totp_secret, otp, u.totp_last_step);
    if (step) ok = !!(await db.prepare(`UPDATE admin_users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`).bind(step, u.id, step).run()).meta?.changes;
  }
  if (!ok) {
    await logAdminAction(db, admin, 'export_code_wrong', 'wrong two-step code before a download');
    return Response.json({ error: 'That code is not right or has already been used. Wait for the next code.' }, { status: 400 });
  }
  return Response.json({ ok: true, ticket: await createExportTicket(db, admin), minutes: TICKET_MINUTES });
}
