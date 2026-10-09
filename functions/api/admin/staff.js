import { randomId } from '../_lib/crypto.js';
import { hashPassword } from '../_lib/password.js';
import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAdminSchema, logAdminAction } from '../_lib/adminSession.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// GET /api/admin/staff -- list staff accounts (owner only).
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  await ensureAdminSchema(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT id, name, email, role, can_export_fan_data, active, created_at, last_login_at FROM admin_users ORDER BY active DESC, name`
  ).all();
  return Response.json({ staff: results });
}

// POST /api/admin/staff { name, email, password, canExport } -- create a staff account.
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
  if (password.length < 10) return Response.json({ error: 'Staff passwords must be at least 10 characters.' }, { status: 400 });
  const exists = await env.DB.prepare(`SELECT id FROM admin_users WHERE email = ?`).bind(email).first();
  if (exists) return Response.json({ error: 'A staff account with this email already exists.' }, { status: 409 });

  const id = randomId('adm', 10);
  await env.DB.prepare(
    `INSERT INTO admin_users (id, name, email, password_hash, role, can_export_fan_data) VALUES (?, ?, ?, ?, 'staff', ?)`
  ).bind(id, name, email, await hashPassword(password), b.canExport ? 1 : 0).run();
  await logAdminAction(env.DB, admin, 'staff_created', `${name} <${email}>${b.canExport ? ' (can export fan data)' : ''}`);
  return Response.json({ ok: true, id });
}
