import { randomId } from '../_lib/crypto.js';
import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { ROLE_DEFAULTS, ROLE_ALIASES, ASSIGNABLE_ROLES } from '../_lib/adminRoles.js';
import { securitySettings, passwordProblem, IDLE_MS } from '../_lib/adminSecurity.js';
import { hashPassword } from '../_lib/password.js';
import { isSuperAdminEmail, superAdminProblem, syncSuperAdmins, superAdminEmails } from '../_lib/superAdmins.js';
import { inviteStaff, contractorUntil } from '../_lib/staffLifecycle.js';
import { needsApproval, requestApproval, pendingResponse } from '../_lib/approvals.js';
import { ensureLifecycleSchema, staffStatus, sendStaffLink, accessReviewList, sendAccessReview, reviewMonth, INVITE_HOURS, NO_PASSWORD } from '../_lib/staffLifecycle.js';
import roleEmails from '../../../src/data/role-emails.json';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

// GET /api/admin/staff -- staff accounts (name, personal email, role, role email,
// two-step login, last login, Active / Disabled / Pending invite), the roles,
// the role email directory and the monthly access review (Super Admin only).
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const db = env.DB;
  await ensureLifecycleSchema(db);
  await syncSuperAdmins(env, new URL(request.url).origin);
  const now = Date.now();
  const { results } = await db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.role_email, u.active, u.access_until, u.created_at, u.last_login_at, u.totp_enabled, u.must_change_password, u.password_hash,
       u.invite_kind, u.invite_expires, u.invited_by, u.disabled_at, u.disabled_by, u.disabled_reason, u.reviewed_at,
       CASE WHEN u.locked_until > ? THEN u.locked_until END AS locked_until,
       (SELECT COUNT(*) FROM admin_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen > ?) AS signed_in
     FROM admin_users u ORDER BY (u.active = 0 OR u.disabled_at IS NOT NULL), u.name`
  ).bind(now, now, now - IDLE_MS).all();
  const staff = results.map(({ password_hash, ...s }) => ({
    ...s, role: ROLE_ALIASES[s.role] || s.role, oldRole: ROLE_ALIASES[s.role] ? s.role : undefined,
    status: staffStatus({ ...s, password_hash }), inviteExpired: s.invite_kind === 'invite' && s.invite_expires < now,
  }));
  // New accounts get one of the current roles; old role names still in use are listed so they show correctly.
  const inUse = [...new Set(staff.map(s => s.role))].filter(id => ROLE_DEFAULTS[id]?.legacy);
  const roles = [...ASSIGNABLE_ROLES, ...inUse].map(id => ({ id, label: ROLE_DEFAULTS[id].label, job: ROLE_DEFAULTS[id].job || '', legacy: !!ROLE_DEFAULTS[id].legacy }));
  const settings = await securitySettings(db);
  return json({
    staff, roles, roleEmails: roleEmails.roles, emailDomainOnly: settings.email_domain_only === '1', superAdminEmails: superAdminEmails(env),
    review: { month: reviewMonth(), lastSent: settings.access_review_month || null, people: await accessReviewList(db) },
  });
}

// POST /api/admin/staff
//   { name, email, role, roleEmail }   invite someone: they get a one-time link (48 hours) to choose their
//                                      own password and set up two-step login. No admin chooses a password.
//   { action: 'send_review' }          email the monthly access review now
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const db = env.DB;
  await ensureLifecycleSchema(db);
  const b = await request.json().catch(() => ({}));
  const origin = new URL(request.url).origin;
  if (b.action === 'send_review') return json({ ok: true, ...(await sendAccessReview(env, origin, { force: true })) });
  // Send the invites to the people in the Super Admin list who don't have one yet.
  if (b.action === 'invite_super_admins') return json({ ok: true, ...(await syncSuperAdmins(env, origin, { sendInvites: true, by: admin })) });

  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const roleEmail = typeof b.roleEmail === 'string' ? b.roleEmail.trim().toLowerCase() : '';
  if (!name) return json({ error: 'Please enter a name.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (roleEmail && !EMAIL_RE.test(roleEmail)) return json({ error: 'The role email is not a valid email address.' }, 400);
  // Old role names (media, commercial…) are accepted and stored as the new role.
  const want = ROLE_ALIASES[b.role] || b.role;
  const role = ASSIGNABLE_ROLES.includes(want) ? want : null;
  if (!role) return json({ error: 'Please choose a role.' }, 400);
  // Super Admin: only the three people in the Super Admin list (test accounts on the local test server excepted).
  const testAccount = env.STAFF_TEST_PASSWORDS === '1' && typeof b.password === 'string';
  if (role === 'super_admin' && !testAccount && superAdminProblem(env, email)) return json({ error: superAdminProblem(env, email) }, 400);
  // Contractors: an end date, at most 14 days away.
  let accessUntil = null;
  if (ROLE_DEFAULTS[role].contractor) { const c = contractorUntil(b.accessUntil); if (c.error) return json({ error: c.error }, 400); accessUntil = c.until; }
  const settings = await securitySettings(db);
  // The Super Admins' own (Gmail) addresses are the only exception to the @lobistarsfc.com rule.
  if (settings.email_domain_only === '1' && !email.endsWith('@lobistarsfc.com') && !isSuperAdminEmail(env, email)) return json({ error: "Use the person's own @lobistarsfc.com email address (Settings › Login & Security)." }, 400);
  if (await db.prepare(`SELECT id FROM admin_users WHERE email = ?`).bind(email).first()) return json({ error: 'A staff account with this email already exists.' }, 409);

  const id = randomId('adm', 10);
  // The local test server only (STAFF_TEST_PASSWORDS=1, never set on the live site): make a
  // ready-to-use account with a password so automated tests can sign in without an email.
  if (env.STAFF_TEST_PASSWORDS === '1' && typeof b.password === 'string') {
    const problem = await passwordProblem(env, b.password, { email, name });
    if (problem) return json({ error: problem }, 400);
    await db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, role, role_email, must_change_password, test_account, access_until) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .bind(id, name, email, await hashPassword(b.password), role, roleEmail || null, b.mustChange === true ? 1 : 0, accessUntil).run();
    await logAdminAction(db, admin, 'staff_created', `${name} <${email}> as ${ROLE_DEFAULTS[role].label} (test server)`);
    return json({ ok: true, id });
  }
  // A new staff account needs another Super Admin's approval (Settings › Approvals).
  if (await needsApproval(env, 'staff_invite', admin)) {
    return pendingResponse(await requestApproval(env, origin, { kind: 'staff_invite', summary: `Invite ${name} <${email}> as ${ROLE_DEFAULTS[role].label}`, payload: { name, email, role, roleEmail: roleEmail || null, accessUntil }, requester: admin }));
  }
  return json({ ok: true, ...(await inviteStaff(env, origin, { name, email, role, roleEmail, accessUntil }, admin)) });
}
