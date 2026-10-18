// Staff login security: login sessions (each sign-in is a row, so "log out of
// all devices" works and idle sessions end), lockout after wrong attempts,
// the password rules (12+ characters, not a known leaked password), backup
// codes for two-step login, devices and new-device emails, the optional IP
// allowlist and the security settings a Super Admin changes on
// Settings › Login & Security.
import { sendEmail } from './email.js';
import { clientIp } from './fans.js';

export const IDLE_MS = 30 * 60 * 1000;          // signed out after 30 minutes without activity
export const SESSION_MS = 12 * 60 * 60 * 1000;  // and after 12 hours at most
export const LOCK_AFTER = 5;                     // wrong passwords / codes in a row
export const LOCK_MS = 15 * 60 * 1000;
export const CAPTCHA_AFTER = 3;                  // the human check appears after 3 wrong attempts
export const GRACE_DAYS = 7;                     // to set up two-step login once it is required
export const MIN_PASSWORD = 12;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
export const randomHex = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let schemaReady = false;
export async function ensureSecuritySchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, ip TEXT, country TEXT, user_agent TEXT, device_id TEXT,
      two_step INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER, revoked_reason TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS admin_sessions_user ON admin_sessions (user_id, revoked_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_devices (
      user_id TEXT NOT NULL, device_id TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      user_agent TEXT, ip TEXT, PRIMARY KEY (user_id, device_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_backup_codes (
      user_id TEXT NOT NULL, code_hash TEXT NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER,
      PRIMARY KEY (user_id, code_hash)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_security (
      key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT
    )`),
  ]);
  const cols = new Set((await db.prepare(`PRAGMA table_info(admin_users)`).all()).results.map(r => r.name));
  for (const [name, type] of [['failed_logins', 'INTEGER NOT NULL DEFAULT 0'], ['locked_until', 'INTEGER'], ['must_change_password', 'INTEGER NOT NULL DEFAULT 0'],
    ['twostep_grace_until', 'INTEGER'], ['twostep_login_at', 'TEXT'], ['password_changed_at', 'TEXT'], ['email_code_hash', 'TEXT'], ['email_code_expires', 'INTEGER'],
    ['test_account', 'INTEGER NOT NULL DEFAULT 0'], ['gmail_notice_at', 'TEXT'], ['access_until', 'INTEGER']]) {
    if (!cols.has(name)) {
      try { await db.prepare(`ALTER TABLE admin_users ADD COLUMN ${name} ${type}`).run(); }
      catch (err) { if (!/duplicate column/i.test(String(err))) throw err; }
    }
  }
  schemaReady = true;
}

// ── Settings (Settings › Login & Security), cached for 30 seconds per server ──

export const SETTING_DEFAULTS = {
  require_two_step: '0',      // '1' = every staff account must use two-step login
  two_step_since: '',         // when it was switched on (ms)
  email_domain_only: '0',     // '1' = new staff emails must end with @lobistarsfc.com
  ip_allowlist_scope: 'off',  // off | super_admin | super_admin_crm | all
  ip_allowlist: '',           // one address or range per line
  alert_emails: '',           // extra addresses for security alerts (comma separated)
  alert_only: '',             // one Super Admin's email: security alerts go only to them (empty = every Super Admin)
  security_events_cleared: '', // when the security contact last cleared the Recent security events list (ISO time)
  access_review_month: '',    // the last month the access review was emailed (YYYY-MM)
  super_admin_list: '',       // the Super Admin list last seen (to notice changes)
  admin_code_off: '0',        // '1' = the old emergency admin code no longer works
  approvals_staff: '1',       // approvals (see approvals.js): new staff, Super Admin / download rights
  approvals_points: '1',      //   Rewards points adjustments over 1,000
  approvals_official: '1',    //   news marked "Official statement"
  approvals_all_news: '0',    //   every news article
  approvals_predict: '1',     //   the Prediction League prize: Super Admins only in the CMS
  statements_notified: '',    // official statements the approvers have been emailed about
  key_fingerprints: '',       // short fingerprints of the payment/email keys (to notice changes; never the keys)
  weekly_summary_week: '',    // the last week the security summary was emailed (YYYY-MM-DD of that Monday)
  auto_backup_progress: '',   // automatic backups (autoBackup.js): the one in progress
  auto_backup_day: '',        //   the last day backed up
  auto_backup_last: '',       //   the last finished backup (day, tables, rows, size)
  auto_backup_error: '',      //   the last failure (cleared when a backup finishes)
  media_backup_since: '',     //   programme files copied up to this upload time
  backup_overdue_alert: '',   //   the day an overdue-backup alert was last sent
};
let cache = null, cachedAt = 0;
export async function securitySettings(db, { force = false } = {}) {
  if (cache && !force && Date.now() - cachedAt < 30000) return cache;
  await ensureSecuritySchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM admin_security`).all();
  cache = { ...SETTING_DEFAULTS, ...Object.fromEntries(results.map(r => [r.key, r.value ?? ''])) };
  cachedAt = Date.now();
  return cache;
}
export async function saveSecuritySetting(db, key, value, by) {
  if (!(key in SETTING_DEFAULTS)) throw new Error(`unknown setting ${key}`);
  await ensureSecuritySchema(db);
  await db.prepare(`INSERT INTO admin_security (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, String(value), new Date().toISOString(), by || null).run();
  await securitySettings(db, { force: true });
}

// ── Passwords ──

const COMMON = ['password', 'lobistars', 'lobi stars', 'lobistarsfc', 'makurdi', 'benue', 'qwerty', '123456', 'abc123', 'letmein', 'welcome', 'admin', 'football', 'iloveyou'];
/** Is the password on the list of passwords leaked in data breaches? (Have I Been Pwned; only the first
 *  5 characters of its SHA-1 leave the server.) null = could not check (the password is then allowed). */
export async function breachedPassword(env, password) {
  if (env.PASSWORD_BREACH_CHECK === 'off') return null;
  try {
    const sha1 = hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))).toUpperCase();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const rest = sha1.slice(5);
    return (await res.text()).split('\n').some(l => { const [h, n] = l.trim().split(':'); return h === rest && Number(n) > 0; });
  } catch { return null; }
}
/** The reason a new password is not allowed, or null when it is fine. */
export async function passwordProblem(env, password, { email = '', name = '' } = {}) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD) return `Passwords must be at least ${MIN_PASSWORD} characters. A short sentence you'll remember works well.`;
  if (p.length > 128) return 'Passwords can be at most 128 characters.';
  const low = p.toLowerCase().replace(/\s+/g, '');
  if (/^(.)\1+$/.test(p) || /^(0123456789|1234567890|abcdefghijkl)/.test(low)) return 'That password is too easy to guess.';
  const local = String(email).toLowerCase().split('@')[0];
  if (local.replace(/[^a-z0-9]/g, '').length >= 4 && low.replace(/[^a-z0-9]/g, '').includes(local.replace(/[^a-z0-9]/g, ''))) return "Don't use your email address in your password.";
  const full = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (full.length >= 6 && low.replace(/[^a-z0-9]/g, '').includes(full)) return "Don't use your name in your password.";
  if (COMMON.some(w => low === w.replace(/\s/g, '') || (low.startsWith(w.replace(/\s/g, '')) && low.length - w.length <= 4))) return 'That password is too common. Choose something less obvious.';
  if (await breachedPassword(env, p)) return 'That password has appeared in a data breach on another website, so criminals try it. Please choose a different one.';
  return null;
}

// ── Sessions ──

export function deviceIdFrom(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)ls_dev=([a-f0-9]{32})/);
  return m ? m[1] : null;
}
/** Remembers this browser (so a sign-in from a new device can be emailed about). */
export const deviceCookie = id => `ls_dev=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${400 * 86400}`;

export async function createSession(db, request, userId, { twoStep = false, deviceId, expiresAt } = {}) {
  await ensureSecuritySchema(db);
  const id = randomHex(24), now = Date.now();
  await db.prepare(`INSERT INTO admin_sessions (id, user_id, created_at, last_seen, expires_at, ip, country, user_agent, device_id, two_step)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, now, now, expiresAt || now + SESSION_MS, clientIp(request),
    request.headers.get('CF-IPCountry') || null, (request.headers.get('User-Agent') || '').slice(0, 300), deviceId || null, twoStep ? 1 : 0).run();
  return id;
}
/** The live session row, or null (unknown, signed out, idle for 30 minutes or older than 12 hours). */
export async function liveSession(db, id, now = Date.now()) {
  await ensureSecuritySchema(db);
  const s = await db.prepare(`SELECT * FROM admin_sessions WHERE id = ?`).bind(id).first();
  if (!s || s.revoked_at || now > s.expires_at) return null;
  // Matchday helpers stay signed in for the whole match day on their device (no idle timeout).
  if (now - s.last_seen > IDLE_MS && !String(s.user_id).startsWith('helper:')) {
    await db.prepare(`UPDATE admin_sessions SET revoked_at = ?, revoked_reason = 'idle' WHERE id = ? AND revoked_at IS NULL`).bind(now, id).run();
    return null;
  }
  return s;
}
export async function touchSession(db, s, now = Date.now()) {
  if (now - s.last_seen < 60000) return;
  await db.prepare(`UPDATE admin_sessions SET last_seen = ? WHERE id = ?`).bind(now, s.id).run();
}
/** Signs out sessions: all of a person's, or all but one (keepId). Returns how many. */
export async function revokeSessions(db, userId, reason, { keepId = null } = {}) {
  await ensureSecuritySchema(db);
  const r = await db.prepare(`UPDATE admin_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ${keepId ? 'AND id != ?' : ''}`)
    .bind(Date.now(), reason, userId, Date.now(), ...(keepId ? [keepId] : [])).run();
  return r.meta?.changes || 0;
}
export async function revokeSession(db, id, reason, userId = null) {
  await ensureSecuritySchema(db);
  const r = await db.prepare(`UPDATE admin_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL ${userId ? 'AND user_id = ?' : ''}`)
    .bind(Date.now(), reason, id, ...(userId ? [userId] : [])).run();
  return r.meta?.changes || 0;
}
/** Signed-in sessions (not idle, not expired), newest activity first. userId null = everyone's. */
export async function listSessions(db, userId = null) {
  await ensureSecuritySchema(db);
  const now = Date.now();
  const { results } = await db.prepare(`SELECT s.id, s.user_id, s.created_at, s.last_seen, s.ip, s.country, s.user_agent, s.two_step, u.name, u.email, u.role
    FROM admin_sessions s LEFT JOIN admin_users u ON u.id = s.user_id
    WHERE s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen > ? ${userId ? 'AND s.user_id = ?' : ''} ORDER BY s.last_seen DESC LIMIT 200`)
    .bind(now, now - IDLE_MS, ...(userId ? [userId] : [])).all();
  return results.map(s => ({ ...s, name: s.user_id === 'owner' ? 'Owner (admin code)' : s.name, device: describeDevice(s.user_agent) }));
}
/** "Chrome on Android" from a browser's User-Agent. */
export function describeDevice(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /node|undici|curl/i.test(ua) ? 'A program' : 'A browser';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iPhone / iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} on ${o}` : b;
}

// ── Devices: is this a new device for this person? ──

export async function rememberDevice(db, userId, deviceId, request) {
  await ensureSecuritySchema(db);
  const now = Date.now();
  const known = await db.prepare(`SELECT 1 FROM admin_devices WHERE user_id = ? AND device_id = ?`).bind(userId, deviceId).first();
  const firstEver = !known && !(await db.prepare(`SELECT 1 FROM admin_devices WHERE user_id = ? LIMIT 1`).bind(userId).first());
  await db.prepare(`INSERT INTO admin_devices (user_id, device_id, first_seen, last_seen, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, device_id) DO UPDATE SET last_seen = excluded.last_seen, user_agent = excluded.user_agent, ip = excluded.ip`)
    .bind(userId, deviceId, now, now, (request.headers.get('User-Agent') || '').slice(0, 300), clientIp(request)).run();
  return { isNew: !known, firstEver };
}

// ── Backup codes (two-step login) ──

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const newCode = () => { const b = crypto.getRandomValues(new Uint8Array(8)); const s = [...b].map(x => CODE_CHARS[x % CODE_CHARS.length]).join(''); return `${s.slice(0, 4)}-${s.slice(4)}`; };
export const normaliseBackupCode = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const looksLikeBackupCode = c => normaliseBackupCode(c).length === 8 && /[a-z]/.test(normaliseBackupCode(c));
/** Ten new codes (the old ones stop working). Shown once; only their hashes are kept. */
export async function newBackupCodes(db, userId) {
  await ensureSecuritySchema(db);
  const codes = Array.from({ length: 10 }, newCode);
  const now = Date.now();
  await db.batch([
    db.prepare(`DELETE FROM admin_backup_codes WHERE user_id = ?`).bind(userId),
    ...await Promise.all(codes.map(async c => db.prepare(`INSERT INTO admin_backup_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)`).bind(userId, await sha256Hex(`${userId}:${normaliseBackupCode(c)}`), now))),
  ]);
  return codes;
}
/** Uses a backup code (each works once). Returns how many are left, or null when it isn't right. */
export async function useBackupCode(db, userId, code) {
  await ensureSecuritySchema(db);
  const h = await sha256Hex(`${userId}:${normaliseBackupCode(code)}`);
  const r = await db.prepare(`UPDATE admin_backup_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`).bind(Date.now(), userId, h).run();
  if (!r.meta?.changes) return null;
  return backupCodesLeft(db, userId);
}
export async function backupCodesLeft(db, userId) {
  await ensureSecuritySchema(db);
  return (await db.prepare(`SELECT COUNT(*) AS n FROM admin_backup_codes WHERE user_id = ? AND used_at IS NULL`).bind(userId).first()).n || 0;
}

// ── IP allowlist ──

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
}
/** Each line: an address (102.89.1.5), an IPv4 range (102.89.0.0/16) or an IPv6 start (2c0f:f5c0:). */
export function parseAllowlist(text) {
  const rules = [], bad = [];
  for (const raw of String(text || '').split(/[\n,]+/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [addr, bits] = line.split('/');
    if (ipv4ToInt(addr) !== null && (bits === undefined || (Number(bits) >= 8 && Number(bits) <= 32))) rules.push({ v4: ipv4ToInt(addr), bits: bits === undefined ? 32 : Number(bits) });
    else if (/^[0-9a-f:]+$/i.test(addr) && addr.includes(':') && bits === undefined) rules.push({ v6: addr.toLowerCase() });
    else bad.push(line);
  }
  return { rules, bad };
}
export function ipAllowed(ip, text) {
  const { rules } = parseAllowlist(text);
  if (!rules.length) return true;
  const v4 = ipv4ToInt(ip || '');
  const low = String(ip || '').toLowerCase();
  return rules.some(r => r.v6 ? (r.v6.endsWith(':') ? low.startsWith(r.v6) : low === r.v6)
    : v4 !== null && (v4 >>> (32 - r.bits)) === (r.v4 >>> (32 - r.bits)));
}
/** Does the allowlist apply to this role id right now? (Never to the owner code: the way back in.) */
export const allowlistApplies = (settings, roleId) =>
  settings.ip_allowlist_scope === 'all' || (settings.ip_allowlist_scope === 'super_admin' && roleId === 'super_admin')
  || (settings.ip_allowlist_scope === 'super_admin_crm' && ['super_admin', 'crm_manager'].includes(roleId));

// ── Requests from other websites (CSRF) ──

/** Changes (POST, PUT, DELETE) must come from this website's own pages. */
export function crossSiteWrite(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  const origin = request.headers.get('Origin');
  if (origin && origin !== 'null') return origin !== new URL(request.url).origin;
  const site = request.headers.get('Sec-Fetch-Site');
  return !!site && !['same-origin', 'none'].includes(site);
}

// ── Strict browser rules for admin pages ──

export const ADMIN_PAGE_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net https://unpkg.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https: data: blob:",
    "frame-src 'self' blob: https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  // Pop-ups (the CMS GitHub sign-in) still work.
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

// ── Security emails ──

/** Who gets alerts: active Super Admin staff accounts (or only the one chosen in the settings) plus the extra addresses (or info@). */
export async function alertAddresses(env) {
  const s = await securitySettings(env.DB);
  const { results } = await env.DB.prepare(`SELECT email FROM admin_users WHERE active = 1 AND disabled_at IS NULL AND role = 'super_admin'`).all();
  const only = String(s.alert_only || '').trim().toLowerCase();
  const admins = only && results.some(r => r.email.toLowerCase() === only) ? [only] : results.map(r => r.email);
  const list = [...admins, ...String(s.alert_emails || '').split(/[\s,;]+/)].map(e => e.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
  return [...new Set(list.length ? list : [env.SECURITY_ALERT_EMAIL || 'info@lobistarsfc.com'])];
}
/** The Super Admin chosen to receive security emails (Settings › Login & Security), or ''. */
export async function securityContact(env) {
  return String((await securitySettings(env.DB)).alert_only || '').trim().toLowerCase();
}
/**
 * An email about someone's own account (password changed, two-step login on/off, backup code used),
 * with a copy for the chosen security contact. Never use it for sign-in codes or password links.
 */
export async function accountEmail(env, owner, subject, lines, origin) {
  const contact = await securityContact(env);
  const copy = contact && contact !== String(owner || '').toLowerCase()
    ? securityEmail(env, contact, `Copy: ${subject}`, [`A copy of an email sent to <strong>${owner}</strong> about their own admin account.`, ...lines], origin)
    : false;
  return Promise.all([securityEmail(env, owner, subject, lines, origin), copy]);
}
const when = (ms = Date.now()) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (Nigeria time)';
/** Sends a short security email; never stops the login if email isn't working. */
export async function securityEmail(env, to, subject, lines, origin = 'https://lobistarsfc.com') {
  if (!env.RESEND_API_KEY || !to || (Array.isArray(to) && !to.length)) return false;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#14171c;max-width:560px">
    <p style="font-size:13px;color:#5b6470;margin:0 0 12px">Lobi Stars FC admin · security</p>
    ${lines.map(l => `<p style="margin:0 0 12px">${l}</p>`).join('')}
    <p style="margin:18px 0 0"><a href="${origin}/admin/account/" style="color:#C11A1F;font-weight:700">Check your signed-in devices</a></p>
    <p style="font-size:12px;color:#5b6470;margin:18px 0 0">You get this email because you have a Lobi Stars admin account. If this wasn't you, sign in, press "Log out of all devices" and change your password, then tell a Super Admin.</p></div>`;
  try { await sendEmail(env, { to, subject, html }); return true; } catch (err) { console.error('[security email]', err); return false; }
}
export const loginDetails = request => {
  const ua = request.headers.get('User-Agent') || '';
  return `<strong>When:</strong> ${esc(when())}<br><strong>Device:</strong> ${esc(describeDevice(ua))}<br><strong>Network address:</strong> ${esc(clientIp(request))}${request.headers.get('CF-IPCountry') ? ` (${esc(request.headers.get('CF-IPCountry'))})` : ''}`;
};
