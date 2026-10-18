// Matchday helper accounts: temporary gate and kitchen helpers for one match,
// made by the Matchday Operations Manager (helpers.create). Each gets a simple
// login (username + 6-digit PIN, or a one-time QR link shared on WhatsApp),
// sees only their one screen (the gate scanner or the Kitchen order board),
// stays signed in for the whole match day on that device (no 30-minute
// timeout, no two-step login), and stops working at 23:59 Nigeria time on match
// day (or the end time set). Every scan and kitchen step records their name.
import { hashPassword, verifyPassword } from './password.js';
import { sha256Hex, randomHex } from './adminSecurity.js';
import { logAdminAction } from './adminSession.js';
import { randomId } from './crypto.js';

export const HELPER_ROLES = { gate: { label: 'Gate Staff', role: 'gate_staff', screen: '/scan/' }, kitchen: { label: 'Kitchen Staff', role: 'kitchen_staff', screen: '/admin/kitchen/' } };
export const helperId = sessionUserId => String(sessionUserId || '').startsWith('helper:') ? sessionUserId.slice(7) : null;

let ready = false;
export async function ensureHelpersSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS matchday_helpers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, kind TEXT NOT NULL, event_id TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE, pin_hash TEXT NOT NULL, link_hash TEXT, expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      disabled_at TEXT, disabled_by TEXT, last_login_at TEXT, failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS matchday_helpers_event ON matchday_helpers (event_id)`),
  ]);
  ready = true;
}

/** 23:59 Nigeria time on the match day (Nigeria is UTC+1 all year). */
export function endOfMatchDay(eventDateIso) {
  const lagos = new Date(new Date(eventDateIso).getTime() + 3600e3);
  return Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate(), 23, 59, 0) - 3600e3;
}
const pin6 = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
// The first name, letters only (easy to type on a phone): "Terver Iorfa" -> "terver".
const slugName = n => String(n).trim().split(/\s+/)[0].toLowerCase().normalize('NFKD').replace(/[^a-z]+/g, '').slice(0, 10) || 'helper';

export const helperStatus = h => (h.disabled_at ? 'disabled' : h.expires_at <= Date.now() ? 'expired' : 'active');

/** Makes a helper. Returns the login details (PIN and link shown once). */
export async function createHelper(env, origin, { name, phone, kind, event, endsAt }, by) {
  const db = env.DB;
  await ensureHelpersSchema(db);
  const id = randomId('hlp', 10);
  let username;
  for (let i = 0; i < 5; i++) {
    username = `${kind}-${slugName(name)}-${String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0')}`;
    if (!(await db.prepare(`SELECT 1 FROM matchday_helpers WHERE username = ?`).bind(username).first())) break;
  }
  const pin = pin6(), token = randomHex(24);
  const expires = endsAt || endOfMatchDay(event.event_date);
  await db.prepare(`INSERT INTO matchday_helpers (id, name, phone, kind, event_id, username, pin_hash, link_hash, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, name, phone || null, kind, event.id, username, await hashPassword(pin), await sha256Hex(token), expires, by.name).run();
  await logAdminAction(db, by, 'helper_created', `${HELPER_ROLES[kind].label} ${name}${phone ? ` (${phone})` : ''} for ${event.home_team} v ${event.away_team}, until ${new Date(expires).toISOString()}`);
  return { id, username, pin, link: `${origin}/helper/?t=${token}`, expiresAt: new Date(expires).toISOString() };
}

/** A new PIN and login link (the old ones stop working). */
export async function resetHelperLogin(env, origin, h, by) {
  const pin = pin6(), token = randomHex(24);
  await env.DB.prepare(`UPDATE matchday_helpers SET pin_hash = ?, link_hash = ?, failed = 0, locked_until = NULL WHERE id = ?`).bind(await hashPassword(pin), await sha256Hex(token), h.id).run();
  await logAdminAction(env.DB, by, 'helper_login_reset', `${h.name} (${h.username}): new PIN and link`);
  return { username: h.username, pin, link: `${origin}/helper/?t=${token}` };
}

/** Signing in: username + PIN, or the one-time link. Returns the helper or an error. */
export async function helperLogin(env, { username, pin, token }) {
  const db = env.DB;
  await ensureHelpersSchema(db);
  let h;
  if (token) {
    if (!/^[a-f0-9]{48}$/.test(String(token))) return { error: 'This login link is not valid. Ask the Matchday Operations Manager for a new one.' };
    h = await db.prepare(`SELECT * FROM matchday_helpers WHERE link_hash = ?`).bind(await sha256Hex(token)).first();
    if (!h) return { error: 'This login link has already been used or replaced. Sign in with your username and PIN, or ask for a new link.' };
    // The link works once.
    await db.prepare(`UPDATE matchday_helpers SET link_hash = NULL WHERE id = ?`).bind(h.id).run();
  } else {
    h = await db.prepare(`SELECT * FROM matchday_helpers WHERE username = ?`).bind(String(username || '').trim().toLowerCase()).first();
    const now = Date.now();
    if (h?.locked_until && h.locked_until > now) return { error: 'Too many wrong PINs. Wait 15 minutes, or ask the Matchday Operations Manager for a new PIN.' };
    if (!h || !(await verifyPassword(String(pin || ''), h.pin_hash))) {
      if (h) {
        const n = (h.failed || 0) + 1;
        await db.prepare(`UPDATE matchday_helpers SET failed = ?, locked_until = ? WHERE id = ?`).bind(n >= 5 ? 0 : n, n >= 5 ? now + 15 * 60000 : null, h.id).run();
      }
      return { error: 'Username or PIN is incorrect.' };
    }
  }
  const st = helperStatus(h);
  if (st === 'disabled') return { error: 'This helper account has been switched off. Ask the Matchday Operations Manager.' };
  if (st === 'expired') return { error: 'This helper account has finished (it only works on its match day). Ask the Matchday Operations Manager.' };
  await db.prepare(`UPDATE matchday_helpers SET failed = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?`).bind(h.id).run();
  return { helper: h };
}

/** The helper behind a session, as an admin object (or null when switched off or finished). */
export async function helperAdmin(db, id, sessionId) {
  await ensureHelpersSchema(db);
  const h = await db.prepare(`SELECT * FROM matchday_helpers WHERE id = ?`).bind(id).first();
  if (!h || helperStatus(h) !== 'active') return null;
  return { id: `helper:${h.id}`, name: `${h.name} (${HELPER_ROLES[h.kind].label})`, email: '', role: HELPER_ROLES[h.kind].role, helper: true, helperKind: h.kind, eventId: h.event_id, screen: HELPER_ROLES[h.kind].screen, helperUntil: new Date(h.expires_at).toISOString(), sessionId };
}

/** Only these pages and APIs open for a helper. */
export const HELPER_PATHS = {
  gate: [/^\/api\/admin\/(me|logout)(\/|$)/, /^\/admin\/tickets\/scan(\/|$)/],
  kitchen: [/^\/admin\/kitchen(\/|$)/, /^\/api\/admin\/kitchen\/(orders|push)(\/|$)/, /^\/api\/admin\/(me|logout)(\/|$)/],
};
export const helperMayOpen = (admin, pathname) => (HELPER_PATHS[admin.helperKind] || []).some(re => re.test(pathname));
