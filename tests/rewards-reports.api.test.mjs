// Lobi Stars Rewards reports: figures for the charts (summary, 12 months,
// sources, tiers, rewards), checks (one device, large manual adjustments), the Excel download (export permission), and the Rewards
// Member / Tier / Star Points columns in the fan database export.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, FANS_DEV_LINKS=1.
// Edits the LOCAL D1 database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 9);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));
const pub = (p, body) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() });
const phone = () => '0803' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const localSql = sql => execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });

async function member(points = 50) {
  const email = `rp-${uid()}@example.com`;
  const reg = await pub('/api/fans/register', { firstName: 'Iveren', surname: 'Gbaa', email, confirmEmail: email, phone: phone(), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, joinRewards: true, rewardsAgree: true });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const look = (await call('GET', `/api/admin/rewards/member?q=${encodeURIComponent(email)}`)).data;
  if (points !== 50) assert.equal((await call('POST', '/api/admin/rewards/member', { memberId: look.member.id, action: 'adjust', points: points - 50, reason: 'Test points' })).status, 200);
  return { email, id: look.member.id, no: look.member.memberNo };
}

test('report figures: summary, 12 months, tiers, sources', async () => {
  await member(300);
  const r = await call('GET', '/api/admin/rewards/analytics');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = r.data;
  for (const k of ['members', 'active', 'issued', 'used', 'expired', 'outstanding', 'outstandingKobo', 'pointValueKobo', 'takenBack']) assert.equal(typeof d.summary[k], 'number', k);
  assert.ok(d.summary.members >= 1);
  assert.equal(d.summary.outstandingKobo, d.summary.outstanding * d.summary.pointValueKobo);
  assert.equal(d.months.length, 12);
  assert.equal(d.months[11].month, new Date().toISOString().slice(0, 7));
  assert.deepEqual(d.tiers.map(t => t.key), ['red', 'gold', 'legend']);
  assert.ok(d.sources.some(s => s.source === 'welcome' && s.label === 'Welcome bonus'));
  assert.equal((await call('GET', '/api/admin/rewards/analytics', undefined, {})).status, 401);
});

test('checks: one device, large manual adjustments', async () => {
  const a = await member(), b = await member(), c = await member(1500);
  const dev = `dev-${uid()}`;
  localSql(`UPDATE members SET signup_device = '${dev}' WHERE id IN ('${a.id}', '${b.id}', '${c.id}')`);
  const flags = (await call('GET', '/api/admin/rewards/analytics')).data.flags;
  const has = (type, m) => flags.some(f => f.type === type && f.members.some(p => p.email === m.email));
  assert.ok(has('device', a) && has('device', b) && has('device', c), 'one device, 3 accounts');
  assert.ok(has('adjust', c) && !has('adjust', a), 'large adjustment');
  assert.ok(!has('spike', c), 'club adjustments are not a points spike');
});

test('Excel download (export permission) and Rewards columns in the fan export', async () => {
  const m = await member(700);
  const x = await fetch(`${BASE}/api/admin/rewards/analytics?format=xlsx`, { headers: ADMIN });
  assert.equal(x.status, 200);
  assert.match(x.headers.get('Content-Disposition'), /lobi-stars-rewards-\d{4}-\d{2}-\d{2}\.xlsx/);
  const files = unzipSync(new Uint8Array(await x.arrayBuffer()));
  const names = [...strFromU8(files['xl/workbook.xml']).matchAll(/<sheet name="([^"]+)"/g)].map(n => n[1]);
  assert.deepEqual(names, ['Summary', 'By month', 'How points are earned', 'Tiers', 'Rewards redeemed', 'Members', 'Checks']);
  const all = Object.keys(files).filter(f => f.startsWith('xl/')).map(f => strFromU8(files[f])).join('');
  assert.ok(all.includes(m.no) && all.includes(m.email));
  const f = await fetch(`${BASE}/api/admin/fans/export?type=xlsx`, { headers: ADMIN });
  const ff = unzipSync(new Uint8Array(await f.arrayBuffer()));
  const sheet = strFromU8(ff['xl/worksheets/sheet1.xml']);
  for (const col of ['Rewards Member', 'Rewards Tier', 'Star Points']) assert.ok(sheet.includes(col), col);
});
