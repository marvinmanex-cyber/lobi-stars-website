// Local test data for the MatchDay Kitchen workflow: one venue and one test user per role.
//   node scripts/seed-kitchen-test.mjs            (local database only; it refuses to touch the live one)
// Staff sign in at /matchday-kitchen with the printed codes. The Super Admin signs in with the
// email and password below when the local server runs with STAFF_TEST_PASSWORDS=1.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../functions/api/_lib/password.js';

if (process.argv.includes('--remote')) { console.error('This script is for the local database only.'); process.exit(1); }
const SECRET = process.env.SESSION_SECRET || 'local-test-secret';
const VENUE = 'venue-main';
const hash = digits => createHash('sha256').update(`mk-code:${SECRET}:${digits}`).digest('hex');
const STAFF = [
  ['mks_seed_sup', 'LSK-T01', 'Test Supervisor', 'supervisor', '20260001'],
  ['mks_seed_pass', 'LSK-T02', 'Test Order Handler', 'pass', '20260002'],
  ['mks_seed_cook', 'LSK-T03', 'Test Cook', 'cook', '20260003'],
  ['mks_seed_run', 'LSK-T04', 'Test Runner', 'delivery', '20260004'],
];
const at = new Date().toISOString();
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const lines = [
  `INSERT OR IGNORE INTO mk_venues (id, name, active, settings_json, created_at) VALUES (${q(VENUE)}, 'Test Venue', 1, '{}', ${q(at)});`,
  ...STAFF.map(([id, sid, name, role, code]) => `INSERT OR REPLACE INTO mk_staff (id, staff_id, full_name, role, password_hash, login_code_hash, is_active, created_by, created_at, updated_at, venue_id) VALUES (${q(id)}, ${q(sid)}, ${q(name)}, ${q(role)}, 'login-code', ${q(hash(code))}, 1, 'seed', ${q(at)}, ${q(at)}, ${q(VENUE)});`),
  `INSERT OR REPLACE INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('mk_seed_sa', 'Test Super Admin', 'kitchen-sa@example.com', ${q(await hashPassword('Kitchen-Super-2026!'))}, 'super_admin', 1, 1);`,
];
const file = join(tmpdir(), `kitchen-seed-${Date.now()}.sql`);
writeFileSync(file, lines.join('\n'));
try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', file], { stdio: 'inherit', shell: true }); } finally { unlinkSync(file); }
console.log('\nSeeded. Local sign-ins at /matchday-kitchen:');
for (const [, sid, name, role, code] of STAFF) console.log(`  ${role.padEnd(11)} ${name.padEnd(20)} ${sid}  code ${code.slice(0, 4)}-${code.slice(4)}`);
console.log('  super admin kitchen-sa@example.com / Kitchen-Super-2026!');
