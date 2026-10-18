import { freshCodeCheck, exportName } from '../_lib/exportGuard.js';
import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { backupReady, backupStep, listBackups, decryptPart, KEEP_DAYS, encryptedCopy, weeklyOffsiteEmail } from '../_lib/autoBackup.js';
import { securitySettings, saveSecuritySetting } from '../_lib/adminSecurity.js';

// Admin › Settings › Data Backup (Super Admin only). The page downloads the
// tables piece by piece and builds the Excel / JSON file in the browser, so
// each request uses only a couple of database queries (Cloudflare limits
// queries per request).
// GET  /api/admin/backup                          -- tables with row counts, and past backups
// GET  /api/admin/backup?table=<name>&offset=<n>  -- up to 5,000 rows of one table
// POST /api/admin/backup { format, tables, rows }  -- records the finished backup in the Activity Log
// GET  /api/admin/backup?auto=status              -- automatic backups: set up?, the last one, failures, the list kept
// GET  /api/admin/backup?autoday=YYYY-MM-DD       -- the pieces of one automatic backup
// GET  /api/admin/backup?autopart=<key>           -- one piece, decrypted (for restoring; fresh two-step code)
// GET  /api/admin/backup?autoraw=YYYY-MM-DD        -- the whole backup still ENCRYPTED, as one file to keep outside
//                                                    Cloudflare (fresh two-step code); unlock it with the key and
//                                                    scripts/decrypt-backup.mjs (see DISASTER-RECOVERY.md)
// POST /api/admin/backup { action: 'backup_now' }  -- start an automatic backup now (it finishes over the next minutes)
// POST /api/admin/backup { action: 'offsite_email', email } -- email the encrypted copy here every Monday ('' = off)
// POST /api/admin/backup { action: 'offsite_send_now' }     -- email the newest encrypted copy now
// Passwords, sign-in tokens, two-step login secrets, push keys, private links
// and stored pictures are never included.
const SKIP_TABLES = new Set(['rate_limits', 'auth_tokens', 'food_photos', 'newsletter_assets', 'd1_migrations', 'sqlite_sequence']);
const SKIP_COLUMNS = /password|token_hash|secret|keys_json|^data$|totp|unsub_token|view_token|^token$/i;
const PAGE = 5000;
const noStore = { 'Cache-Control': 'no-store' };

/** { table: [columns] } for every table that is backed up (one query). */
async function schema(db) {
  const { results } = await db.prepare(
    `SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p
     WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' ORDER BY m.name, p.cid`
  ).all();
  const out = {};
  for (const { t, c } of results) {
    if (SKIP_TABLES.has(t) || !/^[A-Za-z0-9_]+$/.test(t) || SKIP_COLUMNS.test(c) || !/^[A-Za-z0-9_]+$/.test(c)) continue;
    (out[t] ||= []).push(c);
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const db = env.DB;
  const u = new URL(request.url);
  const tables = await schema(db);
  // Automatic backups.
  if (u.searchParams.get('auto') === 'status') {
    const s = await securitySettings(db, { force: true });
    const parse = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
    const prog = parse(s.auto_backup_progress);
    return Response.json({ ready: backupReady(env), keepDays: KEEP_DAYS, last: parse(s.auto_backup_last), error: parse(s.auto_backup_error), offsiteAt: s.offsite_copy_at || null, offsiteEmail: s.offsite_email || '',
      running: prog && !prog.done ? { day: prog.day, left: prog.todo.length + (prog.current ? 1 : 0), rows: prog.rows } : null,
      backups: await listBackups(env) }, { headers: noStore });
  }
  if (u.searchParams.get('autoday')) {
    const day = u.searchParams.get('autoday');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !backupReady(env)) return Response.json({ error: 'Not found' }, { status: 404 });
    const m = await env.BACKUP_BUCKET.get(`db/${day}/manifest.json`);
    if (!m) return Response.json({ error: 'That backup is not complete.' }, { status: 404 });
    const man = await m.json();
    return Response.json({ day, parts: man.parts.map(p => ({ key: p.key, table: p.table, rows: p.rows })), rows: man.rows, tables: man.tables }, { headers: noStore });
  }
  if (u.searchParams.get('autoraw')) {
    const day = u.searchParams.get('autoraw');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !backupReady(env)) return Response.json({ error: 'Not found' }, { status: 404 });
    const needCode = await freshCodeCheck(request, env, admin);
    if (needCode) return needCode;
    const copy = await encryptedCopy(env, day);
    if (copy.error) return Response.json({ error: copy.error }, { status: 404 });
    await saveSecuritySetting(env.DB, 'offsite_copy_at', new Date().toISOString(), admin.name);
    await logAdminAction(env.DB, admin, 'backup_download', `automatic backup ${day} downloaded ENCRYPTED to keep outside Cloudflare: ${copy.rows} rows`);
    return new Response(copy.body, { headers: { ...noStore, 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${copy.filename}"` } });
  }
  if (u.searchParams.get('autopart')) {
    const k = u.searchParams.get('autopart');
    if (!/^db\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_]+\.\d+\.bin$/.test(k) || !backupReady(env)) return Response.json({ error: 'Not found' }, { status: 404 });
    const needCode = await freshCodeCheck(request, env, admin);
    if (needCode) return needCode;
    const obj = await env.BACKUP_BUCKET.get(k);
    if (!obj) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(await decryptPart(env, await obj.arrayBuffer()), { headers: noStore });
  }
  const name = u.searchParams.get('table');
  if (name) {
    // The data itself: a fresh two-step code (one download pass covers the whole backup).
    const needCode = await freshCodeCheck(request, env, admin);
    if (needCode) return needCode;
    const cols = tables[name];
    if (!cols) return Response.json({ error: 'Unknown table' }, { status: 404 });
    const offset = Math.max(0, Number(u.searchParams.get('offset')) || 0);
    const { results } = await db.prepare(`SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM "${name}" LIMIT ? OFFSET ?`).bind(PAGE + 1, offset).all();
    const more = results.length > PAGE;
    const rows = results.slice(0, PAGE).map(r => cols.map(c => (r[c] instanceof ArrayBuffer || ArrayBuffer.isView(r[c]) ? '[binary]' : r[c])));
    return Response.json({ table: name, columns: cols, rows, next: more ? offset + PAGE : null }, { headers: noStore });
  }
  const names = Object.keys(tables);
  // Row counts: one query per 90 tables (each table is one column of the result row).
  const counts = [];
  for (let i = 0; i < names.length; i += 90) {
    const part = names.slice(i, i + 90);
    const row = await db.prepare(`SELECT ${part.map((n, j) => `(SELECT COUNT(*) FROM "${n}") AS c${j}`).join(', ')}`).first();
    part.forEach((n, j) => counts.push({ t: n, c: row[`c${j}`] }));
  }
  const { results: history } = await db.prepare(`SELECT ts, staff_name, detail FROM admin_log WHERE action = 'backup_download' ORDER BY id DESC LIMIT 10`).all();
  return Response.json({ tables: counts.map(r => ({ table: r.t, rows: r.c, columns: tables[r.t].length })), history }, { headers: noStore });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  if (b.action === 'offsite_email') {
    const email = String(b.email || '').trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return Response.json({ error: 'Not a valid email address.' }, { status: 400 });
    await saveSecuritySetting(env.DB, 'offsite_email', email, admin.name);
    await logAdminAction(env.DB, admin, 'backup_offsite_setting', email ? `weekly encrypted backup emailed to ${email}` : 'weekly emailed backup switched off');
    return Response.json({ ok: true });
  }
  if (b.action === 'offsite_send_now') {
    const r = await weeklyOffsiteEmail(env, { force: true, by: admin.name });
    if (r.skipped) return Response.json({ error: r.skipped === 'off' ? 'Enter an email address first.' : r.skipped === 'no backup yet' ? 'There is no finished backup yet.' : 'Email is not set up.' }, { status: 400 });
    if (r.error) return Response.json({ error: `Not sent: ${r.error}` }, { status: 500 });
    return Response.json({ ok: true, ...r });
  }
  if (b.action === 'backup_now') {
    const r = await backupStep(env, { force: true });
    if (!r.ready) return Response.json({ error: 'Automatic backups are not set up yet (BACKUP_BUCKET and BACKUP_KEY).' }, { status: 400 });
    if (r.error) return Response.json({ error: `The backup failed: ${r.error}` }, { status: 500 });
    await logAdminAction(env.DB, admin, 'backup_started', 'automatic backup started by hand');
    return Response.json({ ok: true, ...r });
  }
  if (b.action === 'restore_download') {
    await logAdminAction(env.DB, admin, 'backup_download', `automatic backup ${String(b.day || '').slice(0, 10)} downloaded for restoring: ${Number(b.rows) || 0} rows`);
    return Response.json({ ok: true });
  }
  const format = b.format === 'json' ? 'json' : 'xlsx';
  await logAdminAction(env.DB, admin, 'backup_download', `${format}: ${Number(b.tables) || 0} tables, ${Number(b.rows) || 0} rows`);
  return Response.json({ ok: true });
}
