// Automatic daily backups of the database to a separate storage bucket
// (R2 binding BACKUP_BUCKET), encrypted with the BACKUP_KEY secret (AES-256-GCM),
// kept for 30 days. Uploaded media (the Matchday Programme files) are copied
// weekly. Passwords, sign-in tokens and two-step secrets are never included.
//
// Cloudflare limits the queries and storage calls one request can make, so a
// backup runs in small steps (a few tables each minute, called by the timer
// Worker) from 02:00 Nigeria time, and finishes with a manifest:
//   db/YYYY-MM-DD/<table>.<n>.bin   encrypted, gzipped JSON { table, columns, rows }
//   db/YYYY-MM-DD/manifest.json     (plain) tables, row counts, finished time
//   media/<key>                     copies of the programme files
import { securitySettings, saveSecuritySetting } from './adminSecurity.js';
import { logAdminAction } from './adminSession.js';

export const KEEP_DAYS = 30;
const PAGE = 5000;
const TABLES_PER_STEP = 12;
const SKIP_TABLES = new Set(['rate_limits', 'auth_tokens', 'food_photos', 'newsletter_assets', 'd1_migrations', 'sqlite_sequence', 'export_tickets', 'admin_sessions', 'admin_backup_codes']);
const SKIP_COLUMNS = /password|token_hash|secret|keys_json|^data$|totp|unsub_token|view_token|^token$|pin_hash|link_hash|invite_hash|code_hash/i;
const lagosDay = (t = Date.now()) => new Date(t + 3600e3).toISOString().slice(0, 10);

export const backupReady = env => !!(env.BACKUP_BUCKET && env.BACKUP_KEY);

async function key(env, usage) {
  const raw = Uint8Array.from(atob(String(env.BACKUP_KEY).trim()), c => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('BACKUP_KEY must be 32 bytes (base64).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}
async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
export async function encryptPart(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env, 'encrypt'), await gzip(JSON.stringify(obj))));
  const out = new Uint8Array(12 + data.length); out.set(iv); out.set(data, 12);
  return out;
}
export async function decryptPart(env, bytes) {
  const b = new Uint8Array(bytes);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, await key(env, 'decrypt'), b.slice(12));
  return JSON.parse(await gunzip(new Uint8Array(plain)));
}

/** { table: [columns] } for every table that is backed up. */
export async function backupSchema(db) {
  const { results } = await db.prepare(
    `SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p
     WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' ORDER BY m.name, p.cid`).all();
  const out = {};
  for (const { t, c } of results) {
    if (SKIP_TABLES.has(t) || !/^[A-Za-z0-9_]+$/.test(t) || SKIP_COLUMNS.test(c) || !/^[A-Za-z0-9_]+$/.test(c)) continue;
    (out[t] ||= []).push(c);
  }
  return out;
}

async function state(db) {
  const s = await securitySettings(db, { force: true });
  let p = null;
  try { p = s.auto_backup_progress ? JSON.parse(s.auto_backup_progress) : null; } catch { p = null; }
  return { s, p };
}
const save = (db, k, v) => saveSecuritySetting(db, k, typeof v === 'string' ? v : JSON.stringify(v), 'Automatic backup');

/**
 * One step of today's backup (called every minute). Starts after 02:00 Nigeria
 * time if today's backup isn't done; force = start now (the "Start a backup now" button).
 */
export async function backupStep(env, { force = false } = {}) {
  const db = env.DB;
  if (!backupReady(env)) return { ready: false };
  const { s, p } = await state(db);
  const day = lagosDay();
  let prog = p;
  if (!prog || prog.done) {
    const due = force || (s.auto_backup_day !== day && new Date(Date.now() + 3600e3).getUTCHours() >= 2);
    if (!due) return { ready: true, idle: true };
    const tables = Object.keys(await backupSchema(db));
    prog = { day, started: new Date().toISOString(), todo: tables, current: null, parts: [], rows: 0, bytes: 0, done: false };
    await save(db, 'auto_backup_progress', prog);
  }
  try {
    const schema = await backupSchema(db);
    let n = 0;
    while (n < TABLES_PER_STEP && (prog.current || prog.todo.length)) {
      const cur = prog.current || { t: prog.todo.shift(), offset: 0, part: 0 };
      const cols = schema[cur.t];
      if (!cols) { prog.current = null; continue; }
      const { results } = await db.prepare(`SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM "${cur.t}" LIMIT ? OFFSET ?`).bind(PAGE + 1, cur.offset).all();
      const rows = results.slice(0, PAGE).map(r => cols.map(c => (r[c] instanceof ArrayBuffer || ArrayBuffer.isView(r[c]) ? null : r[c])));
      const body = await encryptPart(env, { table: cur.t, columns: cols, offset: cur.offset, rows });
      const keyName = `db/${prog.day}/${cur.t}.${cur.part}.bin`;
      await env.BACKUP_BUCKET.put(keyName, body);
      prog.parts.push({ key: keyName, table: cur.t, rows: rows.length });
      prog.rows += rows.length; prog.bytes += body.length;
      prog.current = results.length > PAGE ? { t: cur.t, offset: cur.offset + PAGE, part: cur.part + 1 } : null;
      n++;
    }
    if (!prog.current && !prog.todo.length) {
      const tables = [...new Set(prog.parts.map(x => x.table))];
      await env.BACKUP_BUCKET.put(`db/${prog.day}/manifest.json`, JSON.stringify({ day: prog.day, started: prog.started, finished: new Date().toISOString(), tables: tables.length, rows: prog.rows, bytes: prog.bytes, parts: prog.parts }), { httpMetadata: { contentType: 'application/json' } });
      prog.done = true;
      await save(db, 'auto_backup_day', prog.day);
      await save(db, 'auto_backup_last', { day: prog.day, at: new Date().toISOString(), tables: tables.length, rows: prog.rows, bytes: prog.bytes });
      await save(db, 'auto_backup_error', '');
      await logAdminAction(db, { id: 'system', name: 'Automatic backup' }, 'backup_auto', `${prog.day}: ${tables.length} tables, ${prog.rows} rows, ${Math.round(prog.bytes / 1024)} KB (encrypted)`);
      await pruneOld(env);
    }
    await save(db, 'auto_backup_progress', prog);
    return { ready: true, done: prog.done, todo: prog.todo.length, rows: prog.rows };
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 300);
    await save(db, 'auto_backup_error', JSON.stringify({ at: new Date().toISOString(), error: msg }));
    await save(db, 'auto_backup_progress', { ...prog, done: true, failed: true });
    await logAdminAction(db, { id: 'system', name: 'Automatic backup' }, 'backup_failed', msg);
    return { ready: true, error: msg };
  }
}

/** Deletes backups older than 30 days (a few at a time). */
async function pruneOld(env) {
  const cutoff = lagosDay(Date.now() - KEEP_DAYS * 864e5);
  const list = await env.BACKUP_BUCKET.list({ prefix: 'db/', delimiter: '/' });
  const old = (list.delimitedPrefixes || []).map(x => x.slice(3, 13)).filter(d => d < cutoff).slice(0, 2);
  for (const d of old) {
    const objs = await env.BACKUP_BUCKET.list({ prefix: `db/${d}/` });
    if (objs.objects.length) await env.BACKUP_BUCKET.delete(objs.objects.map(o => o.key));
  }
}

/** Weekly (Sundays): copies new programme files into the backup bucket (a few each minute). */
export async function mediaStep(env) {
  if (!backupReady(env) || !env.PROGRAMME_BUCKET) return { ready: false };
  if (new Date(Date.now() + 3600e3).getUTCDay() !== 0) return { idle: true };
  const db = env.DB;
  const s = await securitySettings(db, { force: true });
  const since = s.media_backup_since || '1970-01-01T00:00:00.000Z';
  const list = await env.PROGRAMME_BUCKET.list({ limit: 200 });
  const fresh = list.objects.filter(o => new Date(o.uploaded).toISOString() > since).sort((a, b) => a.uploaded - b.uploaded).slice(0, 8);
  for (const o of fresh) {
    const obj = await env.PROGRAMME_BUCKET.get(o.key);
    if (obj) await env.BACKUP_BUCKET.put(`media/${o.key}`, obj.body, { httpMetadata: obj.httpMetadata });
  }
  if (fresh.length) await save(db, 'media_backup_since', new Date(fresh[fresh.length - 1].uploaded).toISOString());
  return { copied: fresh.length };
}

/** The backups kept (newest first), from their manifests. */
export async function listBackups(env) {
  if (!backupReady(env)) return [];
  const list = await env.BACKUP_BUCKET.list({ prefix: 'db/', delimiter: '/' });
  const days = (list.delimitedPrefixes || []).map(x => x.slice(3, 13)).sort().reverse().slice(0, KEEP_DAYS + 2);
  const out = [];
  for (const d of days.slice(0, 10)) {
    const m = await env.BACKUP_BUCKET.get(`db/${d}/manifest.json`);
    out.push(m ? { day: d, complete: true, ...(await m.json()), parts: undefined } : { day: d, complete: false });
  }
  return out.concat(days.slice(10).map(d => ({ day: d, complete: null })));
}
