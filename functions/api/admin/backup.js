import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';

// Admin › Settings › Data Backup (Super Admin only). The page downloads the
// tables piece by piece and builds the Excel / JSON file in the browser, so
// each request uses only a couple of database queries (Cloudflare limits
// queries per request).
// GET  /api/admin/backup                          -- tables with row counts, and past backups
// GET  /api/admin/backup?table=<name>&offset=<n>  -- up to 5,000 rows of one table
// POST /api/admin/backup { format, tables, rows }  -- records the finished backup in the Activity Log
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
  const { denied } = await requireAdminUser(request, env, { ownerOnly: true });
  if (denied) return denied;
  const db = env.DB;
  const u = new URL(request.url);
  const tables = await schema(db);
  const name = u.searchParams.get('table');
  if (name) {
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
  const format = b.format === 'json' ? 'json' : 'xlsx';
  await logAdminAction(env.DB, admin, 'backup_download', `${format}: ${Number(b.tables) || 0} tables, ${Number(b.rows) || 0} rows`);
  return Response.json({ ok: true });
}
