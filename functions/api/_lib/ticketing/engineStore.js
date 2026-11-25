// Ticketing engine: the switch (legacy | engine), the executive-controlled settings,
// the extra columns/tables (additive only: nothing is dropped or renamed) and the
// integration log. The local rows of an engine order are a DISPLAY COPY: the engine
// keeps the real records.
import { engineSecretsSet } from './engineClient.js';
import { ensureTicketShopSchema } from '../ticketShop.js';
import { ensureDiscountSchema } from '../ticketDiscounts.js';

export const SETTING_PROCESSOR = 'ticketing_legal_processor_name';
export const SETTING_IMPORT_CONFIRMED = 'ticketing_legacy_import_confirmed';

let ready = false;
const addCols = async (db, table, cols) => {
  const have = new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(c => c.name));
  for (const [name, type] of cols) if (!have.has(name)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run().catch(err => { if (!/duplicate column/i.test(String(err))) throw err; });
};

export async function ensureEngineSchema(db) {
  if (ready) return;
  await ensureTicketShopSchema(db);
  await ensureDiscountSchema(db);
  await addCols(db, 'league_ticket_orders', [['backend', "TEXT DEFAULT 'legacy'"], ['engine_order_id', 'TEXT'], ['engine_status', 'TEXT'], ['engine_payment_ref', 'TEXT'], ['engine_expires_at', 'TEXT']]);
  await addCols(db, 'orders', [['engine_event_id', 'TEXT'], ['engine_stand_id', 'TEXT']]);
  await addCols(db, 'tickets', [['engine_ticket_id', 'TEXT'], ['engine_event_id', 'TEXT']]);
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_lto_engine_order ON league_ticket_orders (engine_order_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_tickets_engine_id ON tickets (engine_ticket_id)`),
    // Callbacks already handled (event_id = the engine's idempotency key).
    db.prepare(`CREATE TABLE IF NOT EXISTS ticketing_callbacks (event_id TEXT PRIMARY KEY, type TEXT, order_ref TEXT, received_at TEXT NOT NULL, processed_at TEXT, result TEXT)`),
    // Nonces seen in the last 10 minutes (replay protection).
    db.prepare(`CREATE TABLE IF NOT EXISTS ticketing_nonces (nonce TEXT PRIMARY KEY, seen_at INTEGER NOT NULL)`),
    // Integration log: signature failures, engine errors, unmatched orders (no secrets, no full personal data).
    db.prepare(`CREATE TABLE IF NOT EXISTS ticketing_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ticketing_log_at ON ticketing_log (at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
  ]);
  ready = true;
}

export async function getSetting(db, key) {
  const r = await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first().catch(() => null);
  return r?.value ?? null;
}
export async function setSetting(db, key, value, by) {
  if (key === SETTING_PROCESSOR) nameMemo = { at: 0, value: null };
  await db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(key, value, by || null).run();
}
let nameMemo = { at: 0, value: null };
export const processorName = async db => {
  if (nameMemo.value !== null && Date.now() - nameMemo.at < 30e3) return nameMemo.value;
  const value = String((await getSetting(db, SETTING_PROCESSOR)) || '').trim();
  nameMemo = { at: Date.now(), value };
  return value;
};
export const _forgetProcessorName = () => { nameMemo = { at: 0, value: null }; };
export const legacyImportConfirmed = async db => (await getSetting(db, SETTING_IMPORT_CONFIRMED)) === '1';

/**
 * Which backend sells tickets now. 'engine' only when asked for (TICKETING_BACKEND=engine) AND the
 * secrets are set AND the payment processor's legal name is filled in (honesty rule: fans must be
 * told who receives the money). Anything missing keeps the site on 'legacy'.
 */
export async function ticketingStatus(env, db = env.DB) {
  const requested = String(env.TICKETING_BACKEND || 'legacy').trim().toLowerCase() === 'engine' ? 'engine' : 'legacy';
  const missing = engineSecretsSet(env);
  const name = requested === 'engine' ? await processorName(db) : '';
  const blockers = [];
  if (requested === 'engine') {
    if (missing.length) blockers.push(`Not set in Cloudflare: ${missing.join(', ')}`);
    if (!name) blockers.push('The legal name of the payment processor is not filled in (Admin › Tickets).');
  }
  return { requested, active: requested === 'engine' && !blockers.length ? 'engine' : 'legacy', blockers, processorName: name || null };
}
export const engineActive = async (env, db = env.DB) => (await ticketingStatus(env, db)).active === 'engine';
/** Callbacks and engine tickets keep working after a switch back to legacy (orders already made in the engine). */
export const engineReachable = env => !engineSecretsSet(env).length;

/**
 * Structured log line (and a row for the Super Admin). Never secrets or full personal data.
 * envOrDb: pass env (not env.DB) to also send alerts (security email, at most one per kind per hour).
 */
export async function logTicketing(envOrDb, level, kind, detail = {}) {
  const env = envOrDb?.DB ? envOrDb : null, db = env ? env.DB : envOrDb;
  const line = { at: new Date().toISOString(), level, kind, ...detail };
  (level === 'error' ? console.error : console.log)('[ticketing]', JSON.stringify(line));
  await db.prepare(`INSERT INTO ticketing_log (at, level, kind, detail) VALUES (?, ?, ?, ?)`).bind(line.at, level, kind, JSON.stringify(detail).slice(0, 1000)).run().catch(() => {});
  if (env && level === 'error') await maybeAlert(env, kind).catch(err => console.error('[ticketing] alert', err));
}

// When to alert: [how many in the window, window seconds].
const ALERTS = {
  callback_signature_failed: [5, 3600, 'Callbacks with a wrong signature were refused'],
  callback_failed: [3, 900, 'Callbacks could not be processed'],
  unmatched_order: [1, 3600, 'A paid order from the ticket system matches no order on this site'],
  order_create_failed: [5, 900, 'Orders could not be created in the ticket system'],
  events_failed: [5, 900, 'The match list could not be loaded from the ticket system'],
  scan_unreachable: [3, 600, 'Gate scanners could not reach the ticket system'],
  email_failed: [3, 3600, 'Ticket emails could not be sent'],
};
export async function maybeAlert(env, kind) {
  const rule = ALERTS[kind];
  if (!rule || !env.RESEND_API_KEY) return false;
  const [n, secs, label] = rule;
  const c = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ticketing_log WHERE kind = ? AND at >= ?`).bind(kind, new Date(Date.now() - secs * 1000).toISOString()).first())?.n || 0;
  if (c < n) return false;
  const key = `ticketing_alert_${kind}`, last = Number(await getSetting(env.DB, key)) || 0;
  if (Date.now() - last < 3600e3) return false;
  await setSetting(env.DB, key, String(Date.now()), 'alert');
  const { alertAddresses, securityEmail } = await import('../adminSecurity.js');
  return securityEmail(env, await alertAddresses(env), `Ticket sales alert: ${label}`, [
    `<strong>${label}</strong>: ${c} time${c === 1 ? '' : 's'} in the last ${secs >= 3600 ? `${secs / 3600} hour${secs === 3600 ? '' : 's'}` : `${secs / 60} minutes`}.`,
    "Online ticket sales may be affected. If this continues, a Super Admin can switch ticket sales back to the club's own system (Cloudflare variable TICKETING_BACKEND = legacy).",
  ]);
}

/** Records a nonce; true if it was already seen in the last 10 minutes (replay). */
export async function nonceSeen(db, nonce) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`DELETE FROM ticketing_nonces WHERE seen_at < ?`).bind(now - 600).run().catch(() => {});
  const r = await db.prepare(`INSERT OR IGNORE INTO ticketing_nonces (nonce, seen_at) VALUES (?, ?)`).bind(nonce, now).run();
  return !r.meta.changes;
}

/** "+2348031234567" from the site's stored phone ("08031234567", "2348031234567", …). */
export function intlPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (/^234\d{10}$/.test(d)) return `+${d}`;
  if (/^0\d{10}$/.test(d)) return `+234${d.slice(1)}`;
  if (/^\d{10}$/.test(d)) return `+234${d}`;
  return d ? `+${d}` : '';
}

/** Engine ticket tokens: base32, 24 to 32 characters (the only thing in their QR code). */
export const ENGINE_TOKEN_RE = /^[A-Z2-7]{24,32}$/;
export const isEngineToken = s => ENGINE_TOKEN_RE.test(String(s || ''));
/** What a ticket's QR code holds: the token alone (engine) or the verify link (legacy). */
export const qrTextFor = (id, site = 'https://lobistarsfc.com') => (isEngineToken(id) ? String(id) : `${site}/verify/${id}`);
