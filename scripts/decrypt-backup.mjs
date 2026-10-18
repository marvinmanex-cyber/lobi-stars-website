// Unlocks an encrypted backup kept outside Cloudflare (Admin › Settings › Data
// Backup › "Download encrypted copy") with the backup key, and writes the same
// restore file as "Download for restoring". For when the Cloudflare project is
// lost; the full steps are in DISASTER-RECOVERY.md.
//
//   node scripts/decrypt-backup.mjs lobi-stars-encrypted-backup-2026-10-18.json backup-key.txt > restore.json
//   node scripts/restore-backup.mjs restore.json > restore.sql
//
// backup-key.txt: a text file containing the key (the long line from
// BACKUP-KEY-keep-safe.txt, or from the password manager). Use a file rather
// than typing the key in the command, so it isn't kept in the command history,
// and delete the file afterwards. The key is never printed.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { webcrypto } from 'node:crypto';

const [file, keyFile] = process.argv.slice(2);
if (!file || !keyFile) {
  console.error('Usage: node scripts/decrypt-backup.mjs <encrypted backup .json> <file containing the backup key> > restore.json');
  process.exit(1);
}
const backup = JSON.parse(readFileSync(file, 'utf8'));
if (backup.format !== 'lobi-stars-encrypted-backup' || !Array.isArray(backup.parts)) {
  console.error('This is not an encrypted Lobi Stars backup (use the file from "Download encrypted copy").');
  process.exit(1);
}
// The key file may hold just the key, or the whole BACKUP-KEY-keep-safe.txt: take the line that is a 32-byte base64 key.
const keyText = readFileSync(keyFile, 'utf8').split(/\r?\n/).map(l => l.trim()).find(l => /^[A-Za-z0-9+/]{43}=$/.test(l));
if (!keyText) { console.error('No backup key found in that file (it is a line of 44 letters and numbers ending in "=").'); process.exit(1); }
const key = await webcrypto.subtle.importKey('raw', Buffer.from(keyText, 'base64'), 'AES-GCM', false, ['decrypt']);

const tables = {};
let rows = 0;
for (const p of backup.parts) {
  const bytes = Buffer.from(p.data, 'base64');
  let plain;
  try { plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)); }
  catch { console.error(`Could not unlock ${p.table}: wrong key, or the file is damaged.`); process.exit(1); }
  const part = JSON.parse(gunzipSync(Buffer.from(plain)).toString('utf8'));
  (tables[part.table] ||= []).push(...part.rows.map(r => Object.fromEntries(part.columns.map((c, i) => [c, r[i]]))));
  rows += part.rows.length;
}
process.stdout.write(JSON.stringify({ site: backup.site, createdAt: backup.day, automatic: true, tables }));
console.error(`Unlocked the backup of ${backup.day}: ${Object.keys(tables).length} tables, ${rows} rows.`);
