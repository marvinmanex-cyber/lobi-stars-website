// For tests: a Cookie value that makes a request come from an approved official WhatsApp device.
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './media-helpers.mjs';

export function officialCookie(secret = 'local-test-secret') {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(`mk-wa:${secret}:${token}`).digest('hex');
  const id = `wad-test-${token.slice(0, 12)}`;
  sql(`CREATE TABLE IF NOT EXISTS mk_wa_devices (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, added_by TEXT, added_at TEXT NOT NULL, removed_at TEXT, removed_by TEXT);
    INSERT INTO mk_wa_devices (id, token_hash, name, added_by, added_at) VALUES ('${id}', '${hash}', 'Test device', 'tests', '${new Date().toISOString()}');`);
  return `ls_mk_wa=${token}`;
}
