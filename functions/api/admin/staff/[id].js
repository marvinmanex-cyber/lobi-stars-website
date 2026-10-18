import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ROLE_DEFAULTS, ROLE_ALIASES, ASSIGNABLE_ROLES } from '../../_lib/adminRoles.js';
import { revokeSessions, alertAddresses, securityEmail } from '../../_lib/adminSecurity.js';
import { ensureLifecycleSchema, staffStatus, sendStaffLink, disableStaff, changeRole, contractorUntil } from '../../_lib/staffLifecycle.js';
import { needsApproval, requestApproval, pendingResponse } from '../../_lib/approvals.js';
import { rolePermissions, loadRoles } from '../../_lib/adminRoles.js';
import { isSuperAdminEmail, superAdminProblem } from '../../_lib/superAdmins.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

// PUT /api/admin/staff/:id -- change a staff account (Super Admin only).
//   { name?, role?, roleEmail? }        change details or role
//   { active: false, reason }           leaver: disabled at once, signed out on every device, who and why recorded
//   { active: true }                    re-enable a disabled account (they get a link to choose a new password)
//   { resendInvite: true }              a new invite link (the old one stops working)
//   { sendReset: true }                 email a link to choose a new password (2 hours)
//   { resetTwoStep: true }              lost phone: two-step login is switched off; they set it up again (alerted)
//   { unlock: true }                    end a lockout after too many wrong attempts
//   { signOut: true }                   sign out on every device
//   { keep: true }                      monthly access review: this account is still needed
// Accounts are never deleted, so their history in the Activity Log stays.
export async function onRequestPut({ request, env, params, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const db = env.DB;
  await ensureLifecycleSchema(db);
  const u = await db.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(params.id).first();
  if (!u) return json({ error: 'Staff account not found.' }, 404);
  const b = await request.json().catch(() => ({}));
  const origin = new URL(request.url).origin;
  const later = p => { try { waitUntil(p); } catch { p.catch(() => {}); } };
  const status = staffStatus(u);
  const self = u.id === admin.id;
  const log = detail => logAdminAction(db, admin, 'staff_updated', `${u.name} <${u.email}>: ${detail}`);

  // Leaver.
  if (b.active === false) {
    if (self) return json({ error: "You can't disable your own account. Ask another Super Admin." }, 400);
    if (status === 'disabled') return json({ ok: true });
    if (!String(b.reason || '').trim()) return json({ error: 'Please say why (for example "Left the club").' }, 400);
    const signedOut = await disableStaff(env, u, admin, b.reason);
    return json({ ok: true, signedOut });
  }
  if (b.active === true) {
    if (status !== 'disabled') return json({ ok: true });
    await db.prepare(`UPDATE admin_users SET active = 1, disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?`).bind(u.id).run();
    const link = await sendStaffLink(env, origin, u, u.password_hash === '!' ? 'invite' : 'reset', admin);
    await log(`re-enabled; ${u.password_hash === '!' ? 'invite' : 'password reset'} link sent`);
    return json({ ok: true, emailed: link.emailed, link: link.url });
  }
  if (status === 'disabled') return json({ error: 'This account is disabled. Re-enable it first.' }, 400);

  if (b.resendInvite === true) {
    if (status !== 'pending') return json({ error: 'This person has already set up their account. Use "Send password reset" instead.' }, 400);
    const link = await sendStaffLink(env, origin, u, 'invite', admin);
    await log('new invite link sent');
    return json({ ok: true, emailed: link.emailed, inviteUrl: link.url });
  }
  if (b.sendReset === true) {
    if (status === 'pending') return json({ error: "They haven't set up their account yet. Use \"Resend invite\" instead." }, 400);
    const link = await sendStaffLink(env, origin, u, 'reset', admin);
    await log('password reset link sent');
    return json({ ok: true, emailed: link.emailed, resetUrl: link.url });
  }
  if (b.resetTwoStep === true) {
    if (!u.totp_enabled) return json({ ok: true });
    await db.prepare(`UPDATE admin_users SET totp_enabled = 0, totp_secret = NULL, totp_pending = NULL, totp_last_step = 0 WHERE id = ?`).bind(u.id).run();
    await db.prepare(`DELETE FROM admin_backup_codes WHERE user_id = ?`).bind(u.id).run();
    const n = await revokeSessions(db, u.id, `two-step login reset by ${admin.name}`);
    await log(`two-step login reset; signed out of ${n} device(s)`);
    later(alertAddresses(env).then(to => Promise.all([
      securityEmail(env, to, `Lobi Stars admin: two-step login reset for ${u.name}`, [`<strong>${admin.name}</strong> reset the two-step login of <strong>${u.name}</strong> (${u.email}). They will set it up again at their next sign-in.`], origin),
      securityEmail(env, u.email, 'Lobi Stars admin: your two-step login was reset', [`Hello ${u.name.split(' ')[0]},`, `${admin.name} reset your two-step login (for example after a lost phone). Sign in with your password and set it up again in My account.`, "If you didn't ask for this, tell a Super Admin straight away."], origin),
    ])));
    return json({ ok: true });
  }
  if (b.unlock === true) {
    await db.prepare(`UPDATE admin_users SET failed_logins = 0, locked_until = NULL WHERE id = ?`).bind(u.id).run();
    await log('unlocked');
    return json({ ok: true });
  }
  if (b.signOut === true) {
    const n = await revokeSessions(db, u.id, `signed out by ${admin.name}`);
    await log(`signed out of ${n} device(s)`);
    return json({ ok: true, signedOut: n });
  }
  // A contractor's end date (at most 14 days from now).
  if (b.accessUntil !== undefined && !b.role) {
    if (!ROLE_DEFAULTS[ROLE_ALIASES[u.role] || u.role]?.contractor) return json({ error: 'Only contractor accounts have an end date.' }, 400);
    const c = contractorUntil(b.accessUntil);
    if (c.error) return json({ error: c.error }, 400);
    await db.prepare(`UPDATE admin_users SET access_until = ? WHERE id = ?`).bind(c.until, u.id).run();
    await log(`contractor access until ${new Date(c.until).toISOString()}`);
    return json({ ok: true });
  }
  if (b.keep === true) {
    await db.prepare(`UPDATE admin_users SET reviewed_at = datetime('now') WHERE id = ?`).bind(u.id).run();
    await logAdminAction(db, admin, 'access_review_keep', `${u.name} <${u.email}>: still needs access`);
    return json({ ok: true });
  }

  // Details and role.
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : u.name;
  let roleEmail = u.role_email;
  if (typeof b.roleEmail === 'string') {
    roleEmail = b.roleEmail.trim().toLowerCase() || null;
    if (roleEmail && !EMAIL_RE.test(roleEmail)) return json({ error: 'The role email is not a valid email address.' }, 400);
  }
  const want = ROLE_ALIASES[b.role] || b.role;
  const role = ASSIGNABLE_ROLES.includes(want) && want !== (ROLE_ALIASES[u.role] || u.role) ? want : u.role;
  // Nobody takes away their own Super Admin role.
  if (self && role !== u.role) return json({ error: "You can't change your own role. Ask another Super Admin." }, 400);
  // Super Admin is only for the three people in the list, and they stay Super Admins while they're on it.
  if (role !== u.role && role === 'super_admin' && !(env.STAFF_TEST_PASSWORDS === '1' && u.test_account) && superAdminProblem(env, u.email)) return json({ error: superAdminProblem(env, u.email) }, 400);
  if (role !== u.role && u.role === 'super_admin' && isSuperAdminEmail(env, u.email)) return json({ error: `${u.email} is in the Super Admin list, so they stay a Super Admin. To change that, edit the SUPER_ADMIN_EMAILS server setting.` }, 400);
  // Becoming a contractor needs an end date; leaving the role removes it.
  if (role !== u.role && ROLE_DEFAULTS[role]?.contractor) {
    const c = contractorUntil(b.accessUntil);
    if (c.error) return json({ error: c.error }, 400);
    await db.prepare(`UPDATE admin_users SET access_until = ? WHERE id = ?`).bind(c.until, u.id).run();
  } else if (role !== u.role && u.access_until) await db.prepare(`UPDATE admin_users SET access_until = NULL WHERE id = ?`).bind(u.id).run();
  // Giving Super Admin or a role that can download fan data needs another Super Admin's approval.
  await loadRoles(db);
  const approvalNeeded = role !== u.role && (role === 'super_admin' || rolePermissions(role).includes('fans.export')) && await needsApproval(env, 'role_change', admin);
  await db.prepare(`UPDATE admin_users SET name = ?, role_email = ? WHERE id = ?`).bind(name, roleEmail, u.id).run();
  if (approvalNeeded) {
    if (name !== u.name || roleEmail !== u.role_email) await log([name !== u.name && `name -> ${name}`, roleEmail !== u.role_email && `role email -> ${roleEmail || 'none'}`].filter(Boolean).join(', '));
    return pendingResponse(await requestApproval(env, origin, { kind: 'role_change', summary: `Make ${u.name} <${u.email}> ${ROLE_DEFAULTS[role]?.label || role}`, payload: { userId: u.id, role }, requester: admin }));
  }
  const changes = [
    name !== u.name && `name -> ${name}`,
    roleEmail !== u.role_email && `role email -> ${roleEmail || 'none'}`,
  ].filter(Boolean);
  if (changes.length) await log(changes.join(', '));
  if (role !== u.role) await changeRole(env, origin, u, role, admin);
  return json({ ok: true });
}
