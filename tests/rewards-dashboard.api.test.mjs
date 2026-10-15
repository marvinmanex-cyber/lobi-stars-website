// Lobi Stars Rewards fan pages: My Rewards data (badges, next reward,
// spendable), points history filters and paging, header balance, member card
// and voucher QR codes (own only), staff member-card lookup, and points expiry
// after months with no activity (30-day warning, then an EXPIRE row).
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, FANS_DEV_LINKS=1,
// SESSION_SECRET=local-test-secret. Switches Rewards live for the test, then
// puts the settings back. The expiry test edits the LOCAL D1 database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const SECRET = process.env.SESSION_SECRET || 'local-test-secret';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 9);
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const call = (method, p, body, headers = ADMIN) => fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }));
const pub = (p, body, cookie) => call('POST', p, body, { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip(), ...(cookie ? { Cookie: cookie } : {}) });
const get = (p, cookie) => call('GET', p, undefined, cookie ? { Cookie: cookie } : {});
const phone = () => '0803' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const localSql = sql => execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });

let saved;
before(async () => {
  saved = (await call('GET', '/api/admin/rewards')).data.settings;
  assert.equal((await call('PUT', '/api/admin/rewards', { settings: { live: true } })).status, 200);
});
after(async () => { await call('PUT', '/api/admin/rewards', { settings: saved }); });

async function member(points) {
  const email = `db-${uid()}@example.com`;
  const reg = await pub('/api/fans/register', { firstName: 'Mnena', surname: 'Tyav', email, confirmEmail: email, phone: phone(), password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, joinRewards: true, rewardsAgree: true });
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const cookie = (await pub('/api/auth/login', { email, password: 'Lobi-Stars-2026' })).headers.get('set-cookie').split(';')[0];
  const look = (await call('GET', `/api/admin/rewards/member?q=${encodeURIComponent(email)}`)).data;
  if (points !== 50) assert.equal((await call('POST', '/api/admin/rewards/member', { memberId: look.member.id, action: 'adjust', points: points - 50, reason: 'Test points' })).status, 200);
  return { cookie, email, id: look.member.id };
}
const redeem = (cookie, itemId) => pub('/api/rewards/redeem', { itemId, key: `k-${uid()}-${uid()}` }, cookie);

test('My Rewards: badges, next reward, spendable; guests get nothing', async () => {
  const m = await member(320);
  const d = (await get('/api/rewards/me', m.cookie)).data;
  assert.equal(d.badges.length, 8);
  assert.deepEqual(d.badges.map(b => b.name), ['First Ticket', 'Jersey Owner', '5 Home Games', '10 Home Games', 'Predictor', 'MOTM Voter', 'Gold Member', 'Legend Member']);
  assert.ok(d.badges.every(b => !b.earned), 'a new member has no badges');
  assert.equal(d.spendable, 320);
  assert.ok(d.nextReward && d.nextReward.points > 320 && d.nextReward.toGo === d.nextReward.points - 320);
  assert.ok(d.canAfford >= 1, 'food voucher (300) is affordable');
  assert.equal(d.expiring, null);
  assert.equal((await get('/api/rewards/balance')).data.show, false);
  const b = (await get('/api/rewards/balance', m.cookie)).data;
  assert.equal(b.show, true); assert.equal(b.balance, 320);
});

test('history: filters (earned / used) and paging', async () => {
  const m = await member(1000);
  const r = await redeem(m.cookie, 'food-1500');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const all = (await get('/api/rewards/history', m.cookie)).data.items;
  assert.ok(all.length >= 3);
  const earned = (await get('/api/rewards/history?filter=earned', m.cookie)).data.items;
  assert.ok(earned.length >= 1 && earned.every(h => h.points > 0 && ['EARN', 'BONUS'].includes(h.type)));
  const used = (await get('/api/rewards/history?filter=used', m.cookie)).data.items;
  assert.equal(used.length, 1); assert.equal(used[0].points, -300);
  assert.equal((await get('/api/rewards/history?filter=expired', m.cookie)).data.items.length, 0);
  const page2 = (await get(`/api/rewards/history?before=${all[0].id}`, m.cookie)).data.items;
  assert.equal(page2.length, all.length - 1);
  assert.equal((await get('/api/rewards/history')).status, 401);
});

test('QR codes: own member card and voucher only; staff look up the card', async () => {
  const m = await member(1000);
  const me = (await get('/api/rewards/me', m.cookie)).data;
  const v = (await redeem(m.cookie, 'food-1500')).data.redemption;
  const card = await fetch(`${BASE}/api/rewards/qr?card=1`, { headers: { Cookie: m.cookie } });
  assert.equal(card.status, 200); assert.equal(card.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${BASE}/api/rewards/qr?voucher=${v.voucherCode}`, { headers: { Cookie: m.cookie } })).status, 200);
  const other = await member(50);
  assert.equal((await fetch(`${BASE}/api/rewards/qr?voucher=${v.voucherCode}`, { headers: { Cookie: other.cookie } })).status, 404, "someone else's voucher");
  assert.equal((await fetch(`${BASE}/api/rewards/qr?card=1`)).status, 401);
  // Staff: scanned card code (signed) or typed member number -> vouchers ready to use.
  const sig = createHmac('sha256', SECRET).update(`card:${me.memberNo}`).digest('hex').slice(0, 12).toUpperCase();
  const scan = (await call('GET', `/api/admin/rewards/fulfilment?code=${encodeURIComponent(`LSR-CARD:${me.memberNo}:${sig}`)}`)).data;
  assert.equal(scan.card.memberNo, me.memberNo);
  assert.deepEqual(scan.card.vouchers.map(x => x.voucherCode), [v.voucherCode]);
  assert.equal((await call('GET', `/api/admin/rewards/fulfilment?code=${me.memberNo}`)).data.card.vouchers.length, 1);
  assert.equal((await call('GET', `/api/admin/rewards/fulfilment?code=${encodeURIComponent(`LSR-CARD:${me.memberNo}:000000000000`)}`)).status, 404, 'forged card');
  assert.equal((await call('GET', `/api/admin/rewards/fulfilment?code=${me.memberNo}`, undefined, {})).status, 401, 'staff only');
});

test('expiry: 30-day warning, then points expire after months with no activity', async () => {
  const m = await member(400);
  // Make every row 11 months and 10 days old: inside the 30-day warning window.
  localSql(`UPDATE rewards_ledger SET created_at = datetime('now', '-11 months', '-10 days') WHERE member_id = '${m.id}'`);
  localSql(`UPDATE rewards_members SET joined_at = datetime('now', '-13 months') WHERE member_id = '${m.id}'`);
  const warn = (await get('/api/rewards/me', m.cookie)).data.expiring;
  assert.ok(warn && warn.points === 400 && warn.days > 0 && warn.days <= 30, JSON.stringify(warn));
  const run1 = (await call('POST', '/api/admin/rewards/run')).data;
  assert.ok(run1.warned >= 1, JSON.stringify(run1));
  assert.equal((await get('/api/rewards/me', m.cookie)).data.balance, 400, 'not expired yet');
  // Now 13 months quiet: the points expire, once.
  localSql(`UPDATE rewards_ledger SET created_at = datetime('now', '-13 months') WHERE member_id = '${m.id}'`);
  await call('POST', '/api/admin/rewards/run');
  await call('POST', '/api/admin/rewards/run');
  const after = (await get('/api/rewards/me', m.cookie)).data;
  assert.equal(after.balance, 0);
  const ex = (await get('/api/rewards/history?filter=expired', m.cookie)).data.items;
  assert.equal(ex.length, 1); assert.equal(ex[0].points, -400); assert.equal(ex[0].type, 'EXPIRE');
  assert.equal(after.tier.earned, 0);
});
