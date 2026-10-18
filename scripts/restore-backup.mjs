// Restore helper (for the developer). Turns a backup file downloaded from
// Admin › Settings › Data Backup (the JSON download, or "Download for restoring"
// for an automatic backup) into SQL statements for the D1 database.
//
//   node scripts/restore-backup.mjs lobi-stars-backup-2026-10-18-restore.json [table ...] > restore.sql
//   npx wrangler d1 execute lobi-stars-tickets --remote --file=restore.sql
//
// Rows are written with INSERT OR REPLACE (a row with the same id is put back to
// how it was in the backup; newer rows are left alone). Activity Log entries are
// only added if missing (the log can't be changed). Name tables to restore only those.
// Passwords and two-step secrets are never in backups: staff may need new invites.
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
let count = 0;
console.log(`-- Restore from ${file} (created ${backup.createdAt || 'unknown'})`);
for (const [table, rows] of Object.entries(tables)) {
  if (only.length && !only.includes(table)) continue;
  if (!Array.isArray(rows) || !rows.length) continue;
  const verb = table === 'admin_log' ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE';
  console.log(`-- ${table}: ${rows.length} rows`);
  for (const r of rows) {
    const cols = Object.keys(r);
    console.log(`${verb} INTO ${name(table)} (${cols.map(name).join(', ')}) VALUES (${cols.map(c => q(r[c])).join(', ')});`);
    count++;
  }
}
console.error(`${count} rows written.`);
