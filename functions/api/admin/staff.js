import { randomId } from '../_lib/crypto.js';
import { hashPassword } from '../_lib/password.js';
import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAdminSchema, logAdminAction } from '../_lib/adminSession.js';
import { ROLE_DEFAULTS, ROLE_ALIASES, ASSIGNABLE_ROLES } from '../_lib/adminRoles.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// GET /api/admin/staff -- list staff accounts and the roles (Super Admin only).
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  await ensureAdminSchema(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT id, name, email, role, can_export_fan_data, active, created_at, last_login_at, totp_enabled FROM admin_users ORDER BY active DESC, name`
  ).all();
  // New accounts get one of the current roles; old role names still in use are listed so they show correctly.
  const inUse = [...new Set(results.map(s => ROLE_ALIASES[s.role] || s.role))].filter(id => ROLE_DEFAULTS[id]?.legacy);
  const roles = [...ASSIGNABLE_ROLES, ...inUse].map(id => ({ id, label: ROLE_DEFAULTS[id].label, legacy: !!ROLE_DEFAULTS[id].legacy }));
  return Response.json({ staff: results.map(s => ({ ...s, role: ROLE_ALIASES[s.role] || s.role, oldRole: ROLE_ALIASES[s.role] ? s.role : undefined })), roles });
}

// POST /api/admin/staff { name, email, password, role, canExport } -- create a staff account.
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
  if (password.length < 10) return Response.json({ error: 'Staff passwords must be at least 10 characters.' }, { status: 400 });
  const exists = await env.DB.prepare(`SELECT id FROM admin_users WHERE email = ?`).bind(email).first();
  if (exists) return Response.json({ error: 'A staff account with this email already exists.' }, { status: 409 });

  const id = randomId('adm', 10);
  await env.DB.prepare(
    `INSERT INTO admin_users (id, name, email, password_hash, role, can_export_fan_data) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, name, email, await hashPassword(password), role, b.canExport ? 1 : 0).run();
  await logAdminAction(env.DB, admin, 'staff_created', `${name} <${email}> as ${ROLE_DEFAULTS[role].label}${b.canExport ? ' (can export fan data)' : ''}`);
  return Response.json({ ok: true, id });
}
