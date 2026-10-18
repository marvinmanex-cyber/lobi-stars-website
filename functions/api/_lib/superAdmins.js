// The three Super Admins. Their emails live in the server setting
// SUPER_ADMIN_EMAILS (Cloudflare › Workers & Pages › lobi-stars-website ›
// Settings › Variables and Secrets); the list can't be changed from the website.
// Only an account whose email is on the list (compared trimmed and ignoring
// capitals), whose email is proven (the invite was accepted) and that has the
// Super Admin role gets full access. At most three. Anyone else with the Super
// Admin role is treated as Head of Media.
import { logAdminAction } from './adminSession.js';
import { securitySettings, saveSecuritySetting, securityEmail } from './adminSecurity.js';
import { ensureLifecycleSchema, sendStaffLink, NO_PASSWORD } from './staffLifecycle.js';
import { randomId } from './crypto.js';

export const MAX_SUPER_ADMINS = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normEmail = e => String(e || '').trim().toLowerCase();

/** The list from the server setting: trimmed, lower-case, no repeats, at most three. */
export function superAdminEmails(env) {
  const all = [...new Set(String(env.SUPER_ADMIN_EMAILS || '').split(/[\s,;]+/).map(normEmail).filter(e => EMAIL_RE.test(e)))];
  return all.slice(0, MAX_SUPER_ADMINS);
}
export const isSuperAdminEmail = (env, email) => superAdminEmails(env).includes(normEmail(email));
/** More than three emails in the setting (only the first three count). */
export const tooManySuperAdmins = env => String(env.SUPER_ADMIN_EMAILS || '').split(/[\s,;]+/).map(normEmail).filter(e => EMAIL_RE.test(e)).length > MAX_SUPER_ADMINS;

/** Why this email can't be a Super Admin, or null when it can. */
export function superAdminProblem(env, email) {
  if (isSuperAdminEmail(env, email)) return null;
  return `Only the three people in the Super Admin list (the SUPER_ADMIN_EMAILS server setting) can be Super Admins. ${normEmail(email)} isn't one of them: choose another role, such as Head of Media.`;
}

/**
 * Is this account a full Super Admin right now? Role, email on the list and a
 * proven email (they accepted the invite). Test accounts on the local test server
 * (STAFF_TEST_PASSWORDS=1) are exempt so the other tests can make Super Admins.
 */
export function isFullSuperAdmin(env, u) {
  if (!u || u.role !== 'super_admin') return false;
  if (env.STAFF_TEST_PASSWORDS === '1' && u.test_account) return true;
  return isSuperAdminEmail(env, u.email) && !!u.password_hash && u.password_hash !== NO_PASSWORD;
}

const nameFor = (env, email) => {
  // Optional SUPER_ADMIN_NAMES setting: "email=Name, email=Name".
  for (const part of String(env.SUPER_ADMIN_NAMES || '').split(',')) {
    const [e, n] = part.split('=').map(x => (x || '').trim());
    if (normEmail(e) === normEmail(email) && n) return n.slice(0, 80);
  }
  const local = normEmail(email).split('@')[0].replace(/[._-]+/g, ' ');
  return `${local.charAt(0).toUpperCase()}${local.slice(1)} (Super Admin)`;
};

/**
 * Keeps the accounts in line with the list (called every minute by the timer
 * Worker and when a Super Admin opens Staff or Login & Security):
 * - notices a change to the list: records it and emails everyone on the old and new list;
 * - makes an account for each listed email that has none (Pending invite), or
 *   upgrades an existing account to Super Admin (never a second account);
 * - sends each new Super Admin their invite, once, when invites are switched on
 *   (SUPER_ADMIN_INVITES=send, or the "Send the Super Admin invites" button);
 * - moves anyone else with the Super Admin role to Head of Media.
 */
export async function syncSuperAdmins(env, origin, { sendInvites = env.SUPER_ADMIN_INVITES === 'send', by = { id: 'system', name: 'Super Admin list' } } = {}) {
  const db = env.DB;
  await ensureLifecycleSchema(db);
  const list = superAdminEmails(env);
  const s = await securitySettings(db, { force: true });
  const out = { list, created: [], upgraded: [], invited: [], moved: [], changed: false };

  // A change to the list (made in Cloudflare, never on the website).
  const before = String(s.super_admin_list || '');
  if (before !== list.join(',')) {
    out.changed = true;
    await saveSecuritySetting(db, 'super_admin_list', list.join(','), 'Super Admin list');
    if (before) {
      await logAdminAction(db, by, 'super_admin_list_changed', `from [${before}] to [${list.join(', ')}]`);
      const to = [...new Set([...before.split(','), ...list].filter(Boolean))];
      await securityEmail(env, to, 'Lobi Stars admin: the Super Admin list was changed', [
        `The list of Super Admins (the SUPER_ADMIN_EMAILS server setting) was changed.`,
        `<strong>Before:</strong> ${before.split(',').join(', ') || '(none)'}<br><strong>Now:</strong> ${list.join(', ') || '(none)'}`,
        'If nobody meant to change it, tell the other Super Admins and check the setting in Cloudflare straight away.'], origin);
    } else {
      await logAdminAction(db, by, 'super_admin_list_set', `Super Admins: ${list.join(', ') || '(none)'}`);
    }
  }

  for (const email of list) {
    let u = await db.prepare(`SELECT * FROM admin_users WHERE email = ?`).bind(email).first();
    if (!u) {
      const id = randomId('adm', 10);
      await db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'super_admin')`).bind(id, nameFor(env, email), email, NO_PASSWORD).run();
      await logAdminAction(db, by, 'super_admin_created', `${email}: account made from the Super Admin list (Pending invite)`);
      u = await db.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(id).first();
      out.created.push(email);
    } else if (u.role !== 'super_admin' && u.active && !u.disabled_at) {
      await db.prepare(`UPDATE admin_users SET role = 'super_admin' WHERE id = ?`).bind(u.id).run();
      await logAdminAction(db, by, 'role_assigned', `${u.name} <${email}>: ${u.role} -> Super Admin (on the Super Admin list)`);
      out.upgraded.push(email);
    }
    // The invite, once (a Super Admin can resend it from the Staff page).
    if (sendInvites && u.password_hash === NO_PASSWORD && !u.invite_hash && u.active && !u.disabled_at) {
      const link = await sendStaffLink(env, origin, u, 'invite', by);
      await logAdminAction(db, by, 'staff_invited', `${u.name} <${email}> as Super Admin${link.emailed ? '' : ' (invite email not sent: Resend not set up)'}`);
      out.invited.push({ email, url: link.url });
    }
  }

  // Anyone else holding the Super Admin role becomes Head of Media.
  const { results: others } = await db.prepare(`SELECT id, name, email, test_account FROM admin_users WHERE role = 'super_admin' AND active = 1`).all();
  for (const o of others) {
    if (list.includes(normEmail(o.email)) || (env.STAFF_TEST_PASSWORDS === '1' && o.test_account)) continue;
    await db.prepare(`UPDATE admin_users SET role = 'head_of_media' WHERE id = ?`).bind(o.id).run();
    await logAdminAction(db, by, 'role_assigned', `${o.name} <${o.email}>: Super Admin -> Head of Media (not on the Super Admin list)`);
    out.moved.push(o.email);
  }
  if (out.upgraded.length || out.moved.length) {
    await securityEmail(env, list, 'Lobi Stars admin: Super Admin accounts updated', [
      out.upgraded.length ? `Made Super Admin (on the list): ${out.upgraded.join(', ')}` : '',
      out.moved.length ? `Moved to Head of Media (not on the list): ${out.moved.join(', ')}` : ''].filter(Boolean), origin);
  }
  return out;
}

/** The Super Admins who can stand in for each other: on the list, signed in with two-step login at least once. */
export async function readySuperAdmins(env) {
  const list = superAdminEmails(env);
  if (!list.length) return [];
  const { results } = await env.DB.prepare(`SELECT id, name, email FROM admin_users WHERE role = 'super_admin' AND active = 1 AND disabled_at IS NULL
    AND totp_enabled = 1 AND twostep_login_at IS NOT NULL AND email IN (${list.map(() => '?').join(',')})`).bind(...list).all();
  return results;
}
