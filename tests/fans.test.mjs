// Fan account tests (Phase 1). Run against a local Pages dev server:
//
//   npm run build
//   npx wrangler pages dev dist --port 8790 --binding FANS_DEV_LINKS=1
//   BASE=http://127.0.0.1:8790 node --test tests/
//
// FANS_DEV_LINKS=1 (local only, with no RESEND_API_KEY) makes the API return
// the email links so the tests can follow them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const uid = () => Math.random().toString(36).slice(2, 10);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const phone = () => `0803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

async function post(path, body, ip = randIp(), cookie) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
}

function fan(over = {}) {
  const email = `fan-${uid()}@example.com`;
  return {
    firstName: 'Terna', surname: 'Akaa', email, confirmEmail: email, phone: phone(),
    password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, marketing: false, ...over,
  };
}

test('mismatched email addresses are rejected', async () => {
  const f = fan();
  const r = await post('/api/fans/register', { ...f, confirmEmail: `x${f.email}` });
  assert.equal(r.status, 400);
  assert.match(r.data.errors.confirmEmail, /do not match/);
});

test('invalid phone, short password, mismatched passwords and missing 18+ box are rejected', async () => {
  const r = await post('/api/fans/register', fan({ phone: '12345', password: 'short', confirmPassword: 'short', agree: false }));
  assert.equal(r.status, 400);
  assert.ok(r.data.errors.phone);
  assert.ok(r.data.errors.password);
  assert.ok(r.data.errors.agree);
  const r2 = await post('/api/fans/register', fan({ confirmPassword: 'Different-123' }));
  assert.match(r2.data.errors.confirmPassword, /do not match/);
});

test('phone numbers in every accepted format are saved as +234', async () => {
  const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
  const formats = [
    () => `0803${r7()}`,
    () => `+234703${r7()}`,
    () => { const r = r7(); return `234 813 ${r.slice(0, 3)} ${r.slice(3)}`; },
    () => { const r = r7(); return `0903-${r.slice(0, 3)}-${r.slice(3)}`; },
    () => `0913${r7()}`,
  ];
  for (const make of formats) {
    const p = make();
    const r = await post('/api/fans/register', fan({ phone: p }));
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.data)}`);
  }
});

test('register -> unverified login blocked -> confirm -> login works', async () => {
  const f = fan();
  const reg = await post('/api/fans/register', { ...f, next: '/fixtures' });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.ok(reg.data.devLink, 'start the dev server with --binding FANS_DEV_LINKS=1');

  const blocked = await post('/api/auth/login', { email: f.email, password: f.password });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'unverified');

  const v = await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  assert.equal(v.status, 302);
  const loc = v.headers.get('location');
  assert.match(loc, /\/fans\/login\/\?/);
  assert.match(loc, /confirmed=1/);
  assert.match(loc, /next=%2Ffixtures/);

  // The link only works once.
  const again = await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  assert.match(again.headers.get('location'), /verify=expired/);

  const ok = await post('/api/auth/login', { email: f.email, password: f.password });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie') || '', /ls_session=/);
  const me = await fetch(BASE + '/api/auth/me', { headers: { Cookie: ok.headers.get('set-cookie').split(';')[0] } }).then(r => r.json());
  assert.equal(me.member.emailVerified, true);
});

test('duplicate email and duplicate phone are rejected', async () => {
  const f = fan();
  assert.equal((await post('/api/fans/register', f)).status, 200);
  const dupEmail = await post('/api/fans/register', fan({ email: f.email.toUpperCase(), confirmEmail: f.email.toUpperCase() }));
  assert.equal(dupEmail.status, 400);
  assert.match(dupEmail.data.errors.email, /already exists/);
  const dupPhone = await post('/api/fans/register', fan({ phone: f.phone.replace(/^0/, '+234') }));
  assert.equal(dupPhone.status, 400);
  assert.match(dupPhone.data.errors.phone, /already linked/);
});

test('wrong password gives a generic error', async () => {
  const r = await post('/api/auth/login', { email: `nobody-${uid()}@example.com`, password: 'whatever-123' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'Incorrect email or password.');
});

test('forgot password -> reset -> log in with the new password (and the link works once)', async () => {
  const f = fan();
  const reg = await post('/api/fans/register', f);
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const forgot = await post('/api/fans/forgot', { email: f.email });
  assert.equal(forgot.status, 200);
  const token = new URL(forgot.data.devLink).searchParams.get('token');
  const mismatch = await post('/api/fans/reset', { token, password: 'New-Password-1', confirmPassword: 'nope' });
  assert.equal(mismatch.status, 400);
  const reset = await post('/api/fans/reset', { token, password: 'New-Password-1', confirmPassword: 'New-Password-1' });
  assert.equal(reset.status, 200);
  assert.equal((await post('/api/fans/reset', { token, password: 'Another-Pass-1', confirmPassword: 'Another-Pass-1' })).status, 400);
  assert.equal((await post('/api/auth/login', { email: f.email, password: f.password })).status, 401);
  assert.equal((await post('/api/auth/login', { email: f.email, password: 'New-Password-1' })).status, 200);
});

test('forgot password for an unknown email still answers ok (no account enumeration)', async () => {
  const r = await post('/api/fans/forgot', { email: `ghost-${uid()}@example.com` });
  assert.equal(r.status, 200);
  assert.equal(r.data.devLink, undefined);
});

test('registration is rate limited per IP', async () => {
  const ip = randIp();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await post('/api/fans/register', fan({ confirmEmail: 'mismatch@example.com' }), ip)).status);
  assert.deepEqual(codes.slice(0, 5), [400, 400, 400, 400, 400]);
  assert.equal(codes[5], 429);
});

test('login is rate limited per email', async () => {
  const email = `brute-${uid()}@example.com`;
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await post('/api/auth/login', { email, password: `guess-${i}-xyz` })).status);
  assert.equal(codes[8], 429);
});

test('membership sign-up now requires email confirmation', async () => {
  const email = `member-${uid()}@example.com`;
  const r = await post('/api/auth/signup', { firstName: 'Ada', lastName: 'Ochi', email, password: 'Member-Pass-1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.needsVerification, true);
  assert.equal((await post('/api/auth/login', { email, password: 'Member-Pass-1' })).data.code, 'unverified');
});
