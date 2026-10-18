import { hashPassword } from '../../_lib/password.js';
import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ensureAdminSchema, logAdminAction } from '../../_lib/adminSession.js';
import { ROLE_DEFAULTS, ROLE_ALIASES, ASSIGNABLE_ROLES } from '../../_lib/adminRoles.js';
import { passwordProblem, revokeSessions } from '../../_lib/adminSecurity.js';

// PUT /api/admin/staff/:id { name?, role?, canExport?, active?, password?, mustChange?, resetTwoStep?, unlock?, signOut? }
// -- update a staff account (Super Admin only). Deactivating, a new password and
// resetting two-step login sign them out everywhere at once; signOut does only that;
// unlock ends a lockout after too many wrong attempts.
export async function onRequestPut({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  await ensureAdminSchema(env.DB);
  const u = await env.DB.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(params.id).first();
  if (!u) return Response.json({ error: 'Staff account not found.' }, { status: 404 });
  let b;
  try { b = await request.json(); } catch { b = {}; }

  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : u.name;
  const canExport = typeof b.canExport === 'boolean' ? (b.canExport ? 1 : 0) : u.can_export_fan_data;
  // A different current role; the same role (or its new name) keeps what is stored.
  const want = ROLE_ALIASES[b.role] || b.role;
  const role = ASSIGNABLE_ROLES.includes(want) && want !== (ROLE_ALIASES[u.role] || u.role) ? want : u.role;
  const active = typeof b.active === 'boolean' ? (b.active ? 1 : 0) : u.active;
  // Nobody locks themselves out: you can't deactivate yourself or take away your own Super Admin role.
  if (u.id === admin.id && (active === 0 || role !== u.role)) return Response.json({ error: "You can't deactivate yourself or change your own role. Ask another Super Admin." }, { status: 400 });
  let hash = u.password_hash;
  if (typeof b.password === 'string' && b.password) {
    const problem = await passwordProblem(env, b.password, { email: u.email, name: u.name });
    if (problem) return Response.json({ error: problem }, { status: 400 });
    hash = await hashPassword(b.password);
  }
  await env.DB.prepare(`UPDATE admin_users SET name = ?, role = ?, can_export_fan_data = ?, active = ?, password_hash = ? WHERE id = ?`)
    .bind(name, role, canExport, active, hash, u.id).run();
  const newPassword = hash !== u.password_hash;
  if (newPassword) await env.DB.prepare(`UPDATE admin_users SET must_change_password = ?, failed_logins = 0, locked_until = NULL WHERE id = ?`).bind(b.mustChange === false ? 0 : 1, u.id).run();
  // A Super Admin can switch off someone's two-step login (e.g. a lost phone); they set it up again.
  if (b.resetTwoStep === true && u.totp_enabled) {
    await env.DB.prepare(`UPDATE admin_users SET totp_enabled = 0, totp_secret = NULL, totp_pending = NULL, totp_last_step = 0 WHERE id = ?`).bind(u.id).run();
    await env.DB.prepare(`DELETE FROM admin_backup_codes WHERE user_id = ?`).bind(u.id).run();
  }
  const unlocked = b.unlock === true && u.locked_until > Date.now();
  if (b.unlock === true) await env.DB.prepare(`UPDATE admin_users SET failed_logins = 0, locked_until = NULL WHERE id = ?`).bind(u.id).run();
  // Leavers, new passwords and reset two-step: every device is signed out straight away.
  let signedOut = 0;
  if ((active === 0 && u.active) || newPassword || (b.resetTwoStep === true && u.totp_enabled) || b.signOut === true) {
    signedOut = await revokeSessions(env.DB, u.id, active === 0 ? 'account deactivated' : b.signOut === true ? 'signed out by a Super Admin' : 'password or two-step login reset by a Super Admin');
  }
  const changes = [
    name !== u.name && `name -> ${name}`,
    role !== u.role && `role -> ${ROLE_DEFAULTS[role]?.label || role}`,
    canExport !== u.can_export_fan_data && `export permission ${canExport ? 'granted' : 'removed'}`,
    active !== u.active && (active ? 'reactivated' : 'deactivated'),
    newPassword && `password reset${b.mustChange === false ? '' : ' (must choose a new one at next sign-in)'}`,
    b.resetTwoStep === true && u.totp_enabled && 'two-step login reset',
    unlocked && 'unlocked',
    signedOut && `signed out of ${signedOut} device(s)`,
  ].filter(Boolean).join(', ');
  if (changes) await logAdminAction(env.DB, admin, 'staff_updated', `${u.name} <${u.email}>: ${changes}`);
  return Response.json({ ok: true });
}
