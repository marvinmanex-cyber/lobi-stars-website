// Shared by the Media Centre tests: run SQL against the local database.
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const sql = command => {
  const file = path.join(tmpdir(), `mc-${Math.random().toString(36).slice(2, 8)}.sql`);
  writeFileSync(file, command);
  try { return execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--file', `"${file}"`], { stdio: 'pipe', shell: true }).toString(); }
  finally { rmSync(file, { force: true }); }
};
