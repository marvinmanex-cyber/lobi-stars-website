import { randomId } from '../_lib/crypto.js';
import { hashPassword } from '../_lib/password.js';
import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAdminSchema, logAdminAction } from '../_lib/adminSession.js';
import { ROLE_DEFAULTS, ROLE_ALIASES, ASSIGNABLE_ROLES } from '../_lib/adminRoles.js';
import { passwordProblem, securitySettings, IDLE_MS } from '../_lib/adminSecurity.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// GET /api/admin/staff -- list staff accounts and the roles (Super Admin only).
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  await ensureAdminSchema(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.can_export_fan_data, u.active, u.created_at, u.last_login_at, u.totp_enabled, u.must_change_password,
       CASE WHEN u.locked_until > ? THEN u.locked_until END AS locked_until,
       (SELECT COUNT(*) FROM admin_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen > ?) AS signed_in
     FROM admin_users u ORDER BY u.active DESC, u.name`
  ).bind(Date.now(), Date.now(), Date.now() - IDLE_MS).all();
  // New accounts get one of the current roles; old role names still in use are listed so they show correctly.
  const inUse = [...new Set(results.map(s => ROLE_ALIASES[s.role] || s.role))].filter(id => ROLE_DEFAULTS[id]?.legacy);
  const roles = [...ASSIGNABLE_ROLES, ...inUse].map(id => ({ id, label: ROLE_DEFAULTS[id].label, legacy: !!ROLE_DEFAULTS[id].legacy }));
  return Response.json({ staff: results.map(s => ({ ...s, role: ROLE_ALIASES[s.role] || s.role, oldRole: ROLE_ALIASES[s.role] ? s.role : undefined })), roles });
}

// POST /api/admin/staff { name, email, password, role, canExport, mustChange } -- create a staff account.
// mustChange: they must choose their own password the first time they sign in.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  await ensureAdminSchema(env.DB);
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!name) return Response.json({ error: 'Please enter a name.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  // Old role names (media, commercial…) are accepted and stored as the new role.
  const want = ROLE_ALIASES[b.role] || b.role;
  const role = ASSIGNABLE_ROLES.includes(want) ? want : null;
  if (!role) return Response.json({ error: 'Please choose a role.' }, { status: 400 });
  const settings = await securitySettings(env.DB);
  if (settings.email_domain_only === '1' && !email.endsWith('@lobistarsfc.com')) return Response.json({ error: 'Staff accounts must use a @lobistarsfc.com email address (Settings › Login & Security).' }, { status: 400 });
  const problem = await passwordProblem(env, password, { email, name });
  if (problem) return Response.json({ error: `Temporary password: ${problem}` }, { status: 400 });
  const exists = await env.DB.prepare(`SELECT id FROM admin_users WHERE email = ?`).bind(email).first();
  if (exists) return Response.json({ error: 'A staff account with this email already exists.' }, { status: 409 });

  const id = randomId('adm', 10);
  await env.DB.prepare(
    `INSERT INTO admin_users (id, name, email, password_hash, role, can_export_fan_data, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, email, await hashPassword(password), role, b.canExport ? 1 : 0, b.mustChange === true ? 1 : 0).run();
  await logAdminAction(env.DB, admin, 'staff_created', `${name} <${email}> as ${ROLE_DEFAULTS[role].label}${b.canExport ? ' (can export fan data)' : ''}${b.mustChange === true ? '; must choose own password' : ''}`);
  return Response.json({ ok: true, id });
}
