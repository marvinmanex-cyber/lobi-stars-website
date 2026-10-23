// Squad roles (Phase 3, 23 Oct 2026): the list behind "Position at the club".
// Each role has a category: COACHING (shown on the website's Squad page as
// Coaching Staff) or CLUB_STAFF (kept in the club's records only), a display
// order and an on/off switch. A role typed under "Other" is tidied (Title Case,
// single spaces) and compared with the list ignoring capitals, hyphens and
// punctuation: a match is reused; anything new becomes a PENDING role that a
// Super Admin approves in Squad › Approvals, after which everyone can pick it.
// Super Admins rename, merge, re-categorise, reorder and switch roles off in
// Squad › Roles; a category change moves people on or off /squad at once.
import { logAdminAction } from './adminSession.js';

const nowIso = () => new Date().toISOString();
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export const CATEGORIES = { COACHING: 'Coaching staff', CLUB_STAFF: 'Club staff' };
export const SEED = [
  ['Head Coach', 'COACHING'], ['Assistant Coach', 'COACHING'], ['Goalkeeper Coach', 'COACHING'], ['Fitness Coach', 'COACHING'], ['Technical Adviser', 'COACHING'], ['Performance Analyst', 'COACHING'],
  ['Team Manager', 'CLUB_STAFF'], ['Team Doctor', 'CLUB_STAFF'], ['Physiotherapist', 'CLUB_STAFF'], ['Kit Manager', 'CLUB_STAFF'], ['Media Officer', 'CLUB_STAFF'], ['Welfare Officer', 'CLUB_STAFF'], ['Team Secretary', 'CLUB_STAFF'], ['Driver', 'CLUB_STAFF'],
];
export const RENAMED = { 'Goalkeeper Trainer': 'Goalkeeper Coach' };

/** "  assistant   kit-manager " → "Assistant Kit-Manager" (short all-capital words such as "GK" are kept). */
export function tidyRole(s) {
  return String(s || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
    .split(' ').map(w => (/^[A-Z]{2,4}$/.test(w) ? w : w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()))).join(' ');
}
/** For comparing: capitals, hyphens, punctuation and spaces ignored. */
export const roleKey = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

let ready = false;
export async function ensureRolesSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active', created_by TEXT, created_at TEXT NOT NULL)`),
  ]);
  const n = (await db.prepare(`SELECT COUNT(*) AS n FROM squad_roles`).first())?.n || 0;
  if (!n) {
    const at = nowIso();
    await db.batch(SEED.map(([name, cat], i) => db.prepare(`INSERT OR IGNORE INTO squad_roles (name, key, category, sort, created_by, created_at) VALUES (?, ?, ?, ?, 'Starting list', ?)`).bind(name, roleKey(name), cat, (i + 1) * 10, at)));
    // "Goalkeeper Trainer" is now "Goalkeeper Coach": the profiles follow.
    for (const [from, to] of Object.entries(RENAMED)) await moveProfiles(db, from, to);
  }
  ready = true;
}

/** Every profile (working copy, live version, saved versions) with role `from` gets role `to`. */
async function moveProfiles(db, from, to) {
  const rows = (await db.prepare(`SELECT id, data_json, live_json FROM squad_profiles WHERE type = 'staff' AND (data_json LIKE ? OR live_json LIKE ?)`).bind(`%${from}%`, `%${from}%`).all().catch(() => ({ results: [] }))).results;
  let moved = 0;
  for (const r of rows) {
    const d = parse(r.data_json, {}), l = parse(r.live_json, null);
    const fix = x => { if (!x) return false; if (x.role === from) { x.role = to; return true; } if (x.role === 'Other' && roleKey(x.roleOther) === roleKey(from)) { x.role = to; delete x.roleOther; delete x.roleCoaching; return true; } return false; };
    const a = fix(d), b = l ? fix(l.data) : false;
    if (!a && !b) continue;
    await db.prepare(`UPDATE squad_profiles SET data_json = ?, live_json = ?, role = ? WHERE id = ?`).bind(JSON.stringify(d), l ? JSON.stringify(l) : null, d.role === 'Other' ? d.roleOther || 'Other' : d.role, r.id).run();
    for (const v of (await db.prepare(`SELECT id, snapshot_json FROM squad_profile_versions WHERE profile_id = ?`).bind(r.id).all().catch(() => ({ results: [] }))).results) {
      const sn = parse(v.snapshot_json, null);
      if (sn && fix(sn.data)) await db.prepare(`UPDATE squad_profile_versions SET snapshot_json = ? WHERE id = ?`).bind(JSON.stringify(sn), v.id).run();
    }
    moved++;
  }
  return moved;
}

export async function listRoles(db, { includePending = true } = {}) {
  await ensureRolesSchema(db);
  const rows = (await db.prepare(`SELECT * FROM squad_roles ${includePending ? `WHERE status != 'rejected'` : `WHERE status = 'active'`} ORDER BY CASE category WHEN 'COACHING' THEN 0 ELSE 1 END, sort, name`).all()).results;
  const counts = new Map((await db.prepare(`SELECT role, COUNT(*) AS n FROM squad_profiles WHERE type = 'staff' AND deleted_at IS NULL AND status NOT IN ('DELETED') GROUP BY role`).all().catch(() => ({ results: [] }))).results.map(r => [r.role, r.n]));
  return rows.map(r => ({ id: r.id, name: r.name, category: r.category, sort: r.sort, active: !!r.active, status: r.status, people: counts.get(r.name) || 0 }));
}
/** For the "Position at the club" dropdown: active, approved roles in display order. */
export async function pickList(db) {
  return (await listRoles(db, { includePending: false })).filter(r => r.active).map(r => ({ name: r.name, category: r.category }));
}
/** name → { category, sort } for every approved role (the website and the Data Package). */
export async function roleMap(db) {
  await ensureRolesSchema(db);
  return new Map((await db.prepare(`SELECT name, category, sort FROM squad_roles WHERE status = 'active'`).all()).results.map(r => [r.name, { category: r.category, sort: r.sort }]));
}
export async function isPickable(db, name) {
  await ensureRolesSchema(db);
  return !!(await db.prepare(`SELECT 1 FROM squad_roles WHERE name = ? AND status = 'active' AND active = 1`).bind(String(name || '')).first());
}

/**
 * When a profile with "Other" is sent for approval: an existing role (same words,
 * capitals and punctuation ignored) is used instead; otherwise a PENDING role and a
 * "New role" request for the Super Admins. Returns { role } or { pending: name }.
 */
export async function resolveOther(env, actor, profile, typed, coaching) {
  const db = env.DB;
  await ensureRolesSchema(db);
  const name = tidyRole(typed);
  if (name.length < 2) return { error: 'Enter the role.' };
  const key = roleKey(name);
  const hit = await db.prepare(`SELECT * FROM squad_roles WHERE key = ?`).bind(key).first();
  if (hit && hit.status === 'active') return { role: hit.name };
  if (hit && hit.status === 'pending') return { pending: hit.name };
  const category = coaching === 'Yes' ? 'COACHING' : 'CLUB_STAFF';
  const at = nowIso();
  const max = (await db.prepare(`SELECT MAX(sort) AS m FROM squad_roles WHERE category = ?`).bind(category).first())?.m || 0;
  if (hit) await db.prepare(`UPDATE squad_roles SET name = ?, category = ?, status = 'pending', active = 1 WHERE id = ?`).bind(name, category, hit.id).run();
  else await db.prepare(`INSERT INTO squad_roles (name, key, category, sort, status, created_by, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`).bind(name, key, category, max + 10, actor.name, at).run();
  const { ensureApprovalSchema } = await import('./squadApprovals.js');
  await ensureApprovalSchema(db);
  await db.prepare(`INSERT INTO squad_requests (profile_id, kind, payload_json, submitted_by, submitted_at) VALUES (?, 'new_role', ?, ?, ?)`)
    .bind(profile.id, JSON.stringify({ role: name, category: CATEGORIES[category], categoryKey: category }), actor.name, at).run();
  await logAdminAction(db, actor, 'squad_role', `${actor.name} asked for a new role "${name}" (${CATEGORIES[category].toLowerCase()}); waiting for a Super Admin`);
  return { pending: name };
}

/** Approving a "New role" request: the role is available to everyone; profiles that typed it use it. */
export async function approveNewRole(env, admin, req, payload) {
  const db = env.DB;
  await ensureRolesSchema(db);
  const r = await db.prepare(`SELECT * FROM squad_roles WHERE key = ?`).bind(roleKey(payload.role)).first();
  if (!r) return { error: 'That role is no longer in the list.', status: 404 };
  await db.prepare(`UPDATE squad_roles SET status = 'active', active = 1 WHERE id = ?`).bind(r.id).run();
  await moveProfiles(db, r.name, r.name); // "Other: <name>" → the role itself
  return { ok: true };
}
export async function rejectNewRole(env, admin, req, payload) {
  const db = env.DB;
  await db.prepare(`UPDATE squad_roles SET status = 'rejected' WHERE key = ? AND status = 'pending'`).bind(roleKey(payload.role)).run();
  return { ok: true };
}

// ── Squad › Roles (Super Admins) ──
export async function renameRole(db, admin, id, newName) {
  await ensureRolesSchema(db);
  const r = await db.prepare(`SELECT * FROM squad_roles WHERE id = ?`).bind(Number(id)).first();
  if (!r) return { error: 'Role not found.', status: 404 };
  const name = tidyRole(newName);
  if (name.length < 2) return { error: 'Type the new name.', status: 400 };
  const clash = await db.prepare(`SELECT id FROM squad_roles WHERE key = ? AND id != ?`).bind(roleKey(name), r.id).first();
  if (clash) return { error: 'Another role already has that name: merge them instead.', status: 409 };
  await db.prepare(`UPDATE squad_roles SET name = ?, key = ? WHERE id = ?`).bind(name, roleKey(name), r.id).run();
  const n = await moveProfiles(db, r.name, name);
  await logAdminAction(db, admin, 'squad_role', `${admin.name} renamed the role "${r.name}" to "${name}" (${n} profile${n === 1 ? '' : 's'} updated)`);
  return { ok: true, moved: n };
}
export async function mergeRoles(db, admin, fromId, intoId) {
  await ensureRolesSchema(db);
  const a = await db.prepare(`SELECT * FROM squad_roles WHERE id = ?`).bind(Number(fromId)).first(), b = await db.prepare(`SELECT * FROM squad_roles WHERE id = ?`).bind(Number(intoId)).first();
  if (!a || !b || a.id === b.id) return { error: 'Choose two different roles.', status: 400 };
  const n = await moveProfiles(db, a.name, b.name);
  await db.prepare(`DELETE FROM squad_roles WHERE id = ?`).bind(a.id).run();
  await logAdminAction(db, admin, 'squad_role', `${admin.name} merged the role "${a.name}" into "${b.name}" (${n} profile${n === 1 ? '' : 's'} moved)`);
  return { ok: true, moved: n };
}
export async function setRole(db, admin, id, { category, active } = {}) {
  await ensureRolesSchema(db);
  const r = await db.prepare(`SELECT * FROM squad_roles WHERE id = ?`).bind(Number(id)).first();
  if (!r) return { error: 'Role not found.', status: 404 };
  if (category !== undefined) {
    if (!CATEGORIES[category]) return { error: 'Choose Coaching staff or Club staff.', status: 400 };
    await db.prepare(`UPDATE squad_roles SET category = ? WHERE id = ?`).bind(category, r.id).run();
    await logAdminAction(db, admin, 'squad_role', `${admin.name} moved the role "${r.name}" to ${CATEGORIES[category].toLowerCase()} (${category === 'COACHING' ? 'shown on the Squad page' : 'no longer on the Squad page'})`);
  }
  if (active !== undefined) {
    await db.prepare(`UPDATE squad_roles SET active = ? WHERE id = ?`).bind(active ? 1 : 0, r.id).run();
    await logAdminAction(db, admin, 'squad_role', `${admin.name} ${active ? 'switched on' : 'switched off'} the role "${r.name}" in the portal list`);
  }
  return { ok: true };
}
/** ids in the new order (within their category). */
export async function reorderRoles(db, admin, ids) {
  await ensureRolesSchema(db);
  const list = [].concat(ids || []).map(Number).filter(Number.isInteger).slice(0, 100);
  if (!list.length) return { error: 'Nothing to order.', status: 400 };
  await db.batch(list.map((id, i) => db.prepare(`UPDATE squad_roles SET sort = ? WHERE id = ?`).bind((i + 1) * 10, id)));
  await logAdminAction(db, admin, 'squad_role', `${admin.name} changed the order of the roles`);
  return { ok: true };
}
