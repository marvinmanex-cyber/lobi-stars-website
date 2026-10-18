import { requireAdminUser } from '../_lib/adminEvents.js';
import { ensureAdminSchema, logAdminAction, twoStepDeadline } from '../_lib/adminSession.js';
import { roleOf, ROLE_DEFAULTS } from '../_lib/adminRoles.js';
import { clientIp } from '../_lib/fans.js';
import {
  securitySettings, saveSecuritySetting, listSessions, revokeSession, revokeSessions, parseAllowlist, ipAllowed,
  allowlistApplies, securityEmail, IDLE_MS, SESSION_MS, LOCK_AFTER, GRACE_DAYS, MIN_PASSWORD,
} from '../_lib/adminSecurity.js';

// Settings › Login & Security (Super Admin only).
// GET  /api/admin/security -- the settings, who has two-step login, everyone signed in now, recent security events
// POST /api/admin/security
//   { action: 'require_two_step', on }        every staff account must use two-step login (7 days to set it up).
//                                             Turning it on needs at least one Super Admin staff account that has
//                                             already signed in with two-step login, so nobody is locked out.
//   { action: 'email_domain_only', on }       new staff accounts must use a @lobistarsfc.com address
//   { action: 'ip_allowlist', scope, list }   off | super_admin | super_admin_crm | all; one address or range per line
//   { action: 'alert_emails', emails }        extra addresses for security alerts
//   { action: 'revoke_session', id }          sign out one device
//   { action: 'revoke_user', userId }         sign someone out everywhere ('owner' = the admin code sessions)
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const EVENTS = ['login', 'login_failed', 'login_blocked_ip', 'account_locked', 'owner_code_login', 'backup_code_used', 'backup_codes_new', 'sessions_revoked',
  'account_password', 'account_2fa_on', 'account_2fa_off', 'security_settings', 'staff_created', 'staff_updated', 'role_changed'];

async function readiness(db) {
  const { results } = await db.prepare(`SELECT id, name, email, role, totp_enabled, twostep_login_at, created_at, twostep_grace_until FROM admin_users WHERE active = 1 ORDER BY name`).all();
  const ready = results.filter(u => roleOf(u) === 'super_admin' && u.totp_enabled && u.twostep_login_at);
  return { staff: results, ready };
}

export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const db = env.DB;
  await ensureAdminSchema(db);
  const s = await securitySettings(db, { force: true });
  const { staff, ready } = await readiness(db);
  const required = s.require_two_step === '1';
  const { results: events } = await db.prepare(`SELECT ts, staff_name, action, detail FROM admin_log WHERE action IN (${EVENTS.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 60`).bind(...EVENTS).all();
  const sessions = (await listSessions(db)).map(x => ({
    id: x.id, userId: x.user_id, name: x.name || '(deleted account)', role: x.user_id === 'owner' ? 'Owner (admin code)' : ROLE_DEFAULTS[roleOf(x)]?.label || x.role,
    device: x.device, ip: x.ip, country: x.country, signedIn: new Date(x.created_at).toISOString(), lastActive: new Date(x.last_seen).toISOString(), twoStep: !!x.two_step, current: x.id === admin.sessionId,
  }));
  return json({
    rules: { idleMinutes: IDLE_MS / 60000, sessionHours: SESSION_MS / 3600e3, lockAfter: LOCK_AFTER, graceDays: GRACE_DAYS, minPassword: MIN_PASSWORD },
    settings: {
      requireTwoStep: required, twoStepSince: s.two_step_since ? new Date(Number(s.two_step_since)).toISOString() : null,
      emailDomainOnly: s.email_domain_only === '1', ipScope: s.ip_allowlist_scope, ipList: s.ip_allowlist, alertEmails: s.alert_emails,
    },
    twoStep: {
      readyToRequire: ready.length > 0, readyNames: ready.map(u => u.name),
      staff: staff.map(u => ({ id: u.id, name: u.name, email: u.email, role: ROLE_DEFAULTS[roleOf(u)]?.label || u.role, on: !!u.totp_enabled, usedAt: u.twostep_login_at,
        deadline: required && !u.totp_enabled ? new Date(twoStepDeadline(u, s)).toISOString() : null })),
    },
    myIp: clientIp(request), sessions, events,
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const db = env.DB;
  await ensureAdminSchema(db);
  const later = p => { try { waitUntil(p); } catch { p.catch(() => {}); } };
  const b = await request.json().catch(() => ({}));
  const s = await securitySettings(db, { force: true });
  const log = detail => logAdminAction(db, admin, 'security_settings', detail);

  if (b.action === 'require_two_step') {
    if (b.on === true) {
      const { staff, ready } = await readiness(db);
      if (!ready.length) return json({ error: 'First, at least one Super Admin needs a personal staff account with two-step login turned on, and must have signed in with it once (to prove it works). Then you can make it required for everyone.' }, 409);
      if (s.require_two_step === '1') return json({ ok: true });
      const since = Date.now();
      await saveSecuritySetting(db, 'two_step_since', String(since), admin.name);
      await saveSecuritySetting(db, 'require_two_step', '1', admin.name);
      await log(`two-step login required for all staff (${GRACE_DAYS} days to set it up)`);
      // Tell everyone who still needs to set it up, and by when.
      const due = new Date(since + GRACE_DAYS * 86400e3).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long' });
      const origin = new URL(request.url).origin;
      for (const u of staff.filter(x => !x.totp_enabled)) {
        later(securityEmail(env, u.email, 'Lobi Stars admin: please turn on two-step login', [`Hello ${u.name.split(' ')[0]},`,
          `The club now requires two-step login for every admin account. Please turn it on by <strong>${due}</strong>: sign in, open <strong>My account</strong> and press <strong>Turn on two-step login</strong> (it takes 2 minutes and needs an authenticator app on your phone).`,
          'After that date you will only be able to open My account until it is on.'], origin));
      }
      return json({ ok: true });
    }
    await saveSecuritySetting(db, 'require_two_step', '0', admin.name);
    await log('two-step login no longer required');
    return json({ ok: true });
  }
  if (b.action === 'email_domain_only') {
    await saveSecuritySetting(db, 'email_domain_only', b.on === true ? '1' : '0', admin.name);
    await log(b.on === true ? 'new staff accounts must use @lobistarsfc.com' : 'any email address allowed for new staff accounts');
    return json({ ok: true });
  }
  if (b.action === 'ip_allowlist') {
    const scope = ['off', 'super_admin', 'super_admin_crm', 'all'].includes(b.scope) ? b.scope : 'off';
    const list = String(b.list || '').slice(0, 2000);
    const { rules, bad } = parseAllowlist(list);
    if (bad.length) return json({ error: `Not a network address or range: ${bad.join(', ')}` }, 400);
    if (scope !== 'off' && !rules.length) return json({ error: 'Add at least one address or range, or choose "Off".' }, 400);
    // Don't let a Super Admin lock themselves out (the owner admin code always works).
    if (admin.id !== 'owner' && allowlistApplies({ ip_allowlist_scope: scope }, roleOf(admin)) && !ipAllowed(clientIp(request), list)) {
      return json({ error: `Your own network address (${clientIp(request)}) is not on the list, so saving this would sign you out. Add it first.` }, 400);
    }
    await saveSecuritySetting(db, 'ip_allowlist', list, admin.name);
    await saveSecuritySetting(db, 'ip_allowlist_scope', scope, admin.name);
    await log(scope === 'off' ? 'IP allowlist off' : `IP allowlist for ${scope === 'all' ? 'all staff' : scope === 'super_admin_crm' ? 'Super Admins and CRM Managers' : 'Super Admins'}: ${rules.length} address(es)/range(s)`);
    return json({ ok: true });
  }
  if (b.action === 'alert_emails') {
    const list = String(b.emails || '').split(/[\s,;]+/).filter(Boolean);
    const badEmails = list.filter(e => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
    if (badEmails.length) return json({ error: `Not a valid email: ${badEmails.join(', ')}` }, 400);
    await saveSecuritySetting(db, 'alert_emails', list.slice(0, 10).join(', '), admin.name);
    await log(`security alert emails: ${list.length ? list.join(', ') : 'Super Admins only'}`);
    return json({ ok: true });
  }
  if (b.action === 'revoke_session') {
    const n = await revokeSession(db, String(b.id || ''), `signed out by ${admin.name}`);
    if (n) await logAdminAction(db, admin, 'sessions_revoked', 'signed out one device (Login & Security)');
    return json({ ok: true, signedOut: n });
  }
  if (b.action === 'revoke_user') {
    const userId = String(b.userId || '');
    const n = await revokeSessions(db, userId, `signed out by ${admin.name}`, { keepId: admin.sessionId });
    await logAdminAction(db, admin, 'sessions_revoked', `signed out ${userId === 'owner' ? 'the admin code sessions' : userId} everywhere (${n})`);
    return json({ ok: true, signedOut: n });
  }
  return json({ error: 'Unknown action' }, 400);
}
