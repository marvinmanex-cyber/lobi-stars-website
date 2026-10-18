// Restore helper (for the developer). Turns a backup file downloaded from
// Admin › Settings › Data Backup (the JSON download, or "Download for restoring"
// for an automatic backup, or the output of scripts/decrypt-backup.mjs) into SQL
// statements for the D1 database.
//
//   node scripts/restore-backup.mjs lobi-stars-backup-2026-10-18-restore.json [table ...] > restore.sql
//   npx wrangler d1 execute lobi-stars-tickets --remote --file=restore.sql
//
// Rows are written with INSERT OR REPLACE (a row with the same id is put back to
// how it was in the backup; newer rows are left alone). Activity Log entries are
// only added if missing (the log can't be changed). Name tables to restore only those.
// Automatic backups also hold the database structure: on a brand-new, empty
// database the tables are created first and indexes and triggers added after the
// rows (DISASTER-RECOVERY.md).
// Passwords, PINs and two-step secrets are never in backups. Where the database
// needs a value, the "no password set" marker '!' is written: staff get a new
// invite, fans use "Forgot password", gate helpers get a new PIN.
// For the last 7 days (30 on the paid plan), Cloudflare D1 "Time Travel" can put
// the whole database back to any minute instead:
//   npx wrangler d1 time-travel restore lobi-stars-tickets --timestamp=2026-10-18T09:00:00Z
import { readFileSync } from 'node:fs';

const [file, ...only] = process.argv.slice(2);
if (!file) { console.error('Usage: node scripts/restore-backup.mjs <backup.json> [table ...] > restore.sql'); process.exit(1); }
const backup = JSON.parse(readFileSync(file, 'utf8'));
const tables = backup.tables || {};
const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`;
const name = s => `"${String(s).replace(/"/g, '')}"`;
// Left out: short-lived sign-in codes, and phone-notification subscriptions (their keys are never
// backed up: fans and staff turn alerts on again).
const SKIP = new Set(['_schema', 'fan_login_codes', 'rewards_codes', 'fan_push_subs', 'push_subs']);
const ifNotExists = (sql, type) => sql.replace(new RegExp(`^\\s*CREATE\\s+(UNIQUE\\s+)?${type}\\s+(IF\\s+NOT\\s+EXISTS\\s+)?`, 'i'), (m, u) => `CREATE ${u || ''}${type.toUpperCase()} IF NOT EXISTS `);
const schema = (tables._schema || []).filter(s => !only.length || only.includes(s.type === 'table' ? s.name : ''));
let count = 0;
console.log(`-- Restore from ${file} (created ${backup.createdAt || 'unknown'})`);
// 1. Tables (only created if missing, so this is safe on the live database too).
const made = schema.filter(s => s.type === 'table');
if (made.length) console.log(`-- Database structure: ${made.length} tables`);
for (const s of made) console.log(`${ifNotExists(s.sql, 'table').trim().replace(/;?$/, ';')}`);
// Required columns (NOT NULL, no default) that backups leave out on purpose (passwords, PINs): the
// "not set" marker '!' (it never matches a password).
const FILL = {};
for (const s of made) {
  const sql = s.sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); // without comments
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  for (const def of body.split(/,(?![^(]*\))/)) {
    const m = def.trim().match(/^"?(\w+)"?\s+(.*)$/s);
    if (m && /NOT\s+NULL/i.test(m[2]) && !/DEFAULT|PRIMARY\s+KEY/i.test(m[2]) && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)$/i.test(m[1])) (FILL[s.name] ||= {})[m[1]] = '!';
  }
}
// 2. Rows: parent tables before the tables that point to them, and the links checked at the end.
const refs = Object.fromEntries(made.map(s => [s.name, [...s.sql.matchAll(/REFERENCES\s+"?(\w+)"?/gi)].map(m => m[1]).filter(t => t !== s.name)]));
const order = [], seen = new Set();
const visit = t => { if (seen.has(t)) return; seen.add(t); (refs[t] || []).forEach(visit); order.push(t); };
Object.keys(tables).sort().forEach(visit);
console.log('PRAGMA defer_foreign_keys = ON;');
for (const table of order) {
  const rows = tables[table];
  if (SKIP.has(table) || (only.length && !only.includes(table))) continue;
  if (!Array.isArray(rows) || !rows.length) continue;
  const verb = table === 'admin_log' ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE';
  console.log(`-- ${table}: ${rows.length} rows`);
  for (const r of rows) {
    const row = { ...Object.fromEntries(Object.entries(FILL[table] || {}).filter(([c]) => !(c in r))), ...r };
    const cols = Object.keys(row);
    console.log(`${verb} INTO ${name(table)} (${cols.map(name).join(', ')}) VALUES (${cols.map(c => q(row[c])).join(', ')});`);
    count++;
  }
}
// 3. Indexes and triggers (after the rows, e.g. the Activity Log's "can't be changed" triggers).
for (const s of (tables._schema || []).filter(s => s.type !== 'table' && !only.length)) {
  console.log(`${ifNotExists(s.sql, s.type).trim().replace(/;?$/, ';')}`);
}
console.error(`${count} rows written${made.length ? `, ${made.length} tables` : ''}.`);
