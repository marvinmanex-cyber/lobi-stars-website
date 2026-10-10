// Phase 6 (commercial) tests: membership, members' ticket priority window,
// members-only stories, shirt personalisation (off by default), hospitality.
// Needs the local Pages dev server with FANS_DEV_LINKS=1 and ADMIN_CODE=test-code-123.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 10);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const H = 3600e3;

async function post(path, body, cookie) {
  const res = await fetch(BASE + path, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp(), ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
}
const get = (path, cookie) => fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {} }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const admin = (path, method = 'GET', body) => fetch(BASE + path, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

async function fan(first = 'Member', last = 'Test') {
  const email = `cm-${uid()}@example.com`;
  const reg = await post('/api/fans/register', {
    firstName: first, surname: last, email, confirmEmail: email, phone: `0803${r7()}`,
    password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, marketing: false,
  });
  assert.ok(reg.data.devLink, 'start the dev server with --binding FANS_DEV_LINKS=1');
  await fetch(reg.data.devLink.replace('https://lobistarsfc.com', BASE), { redirect: 'manual' });
  const login = await post('/api/auth/login', { email, password: 'Lobi-Stars-2026' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = (await get('/api/auth/me', cookie)).data.member;
  return { cookie, id: me.id, email };
}
const confirmMember = id => admin('/api/admin/members', 'POST', { memberId: id, action: 'confirm', note: 'Test payment' });

test('membership: staff confirm it (with a payment note); the account shows it; it can be removed', async () => {
  assert.equal((await fetch(`${BASE}/api/admin/members`)).status, 401);
  const f = await fan('Card', 'Holder');
  let me = (await get('/api/auth/me', f.cookie)).data.member;
  assert.equal(me.membership.active, false);
  assert.match(me.membership.season, /^\d{4}\/\d{2}$/);

  const noNote = await admin('/api/admin/members', 'POST', { memberId: f.id, action: 'confirm' });
  assert.equal(noNote.status, 400);
  assert.equal((await confirmMember(f.id)).status, 200);
  me = (await get('/api/auth/me', f.cookie)).data.member;
  assert.equal(me.membership.active, true);
  assert.ok(me.membership.since);

  const list = (await admin('/api/admin/members')).data;
  assert.ok(list.members.some(m => m.id === f.id && m.season === list.season && /Test payment/.test(m.note)));
  const found = (await admin(`/api/admin/members?q=${encodeURIComponent(f.email)}`)).data;
  assert.equal(found.members[0].id, f.id);

  assert.equal((await admin('/api/admin/members', 'POST', { memberId: f.id, action: 'remove' })).status, 200);
  assert.equal((await get('/api/auth/me', f.cookie)).data.member.membership.active, false);
});

test('online membership payment and shirt personalisation are OFF by default', async () => {
  const f = await fan();
  const pay = await post('/api/membership/checkout', {}, f.cookie);
  assert.equal(pay.status, 404);
  const p = await get('/api/shop/personalise');
  assert.equal(p.data.enabled, false);
  assert.deepEqual(p.data.shirts, []);
  const order = await post('/api/shop/personalise', { product: 'home-jersey', size: 'M', printName: 'TERNA', printNumber: '9' });
  assert.equal(order.status, 404);
  const shop = await fetch(`${BASE}/shop/`).then(r => r.text());
  assert.doesNotMatch(shop, /data-personalise=/);
  assert.doesNotMatch(shop, /id="pzDialog"/);
});

test("ticket priority window: only confirmed members can buy before general sale", async () => {
  const create = await fetch(`${BASE}/api/admin/events`, {
    method: 'POST', headers: ADMIN, body: JSON.stringify({
      home_team: 'Lobi Stars FC', away_team: `Priority Test ${uid()}`, competition: 'NNL Conference D',
      venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 72 * H).toISOString(),
      vip_price_kobo: 500000, premium_price_kobo: 300000, regular_price_kobo: 100000, active: true,
      public_sale_at: new Date(Date.now() + 24 * H).toISOString(),
    }),
  }).then(r => r.json());
  assert.ok(create.id, JSON.stringify(create));
  const events = (await get('/api/events')).data.events;
  assert.ok(events.find(e => e.id === create.id)?.public_sale_at, 'general sale time is published');

  const buy = cookie => post('/api/checkout', { eventId: create.id, tier: 'Regular', quantity: 1, buyerName: 'Test Buyer', buyerEmail: 'buyer@example.com', buyerPhone: '08031234567' }, cookie);
  const anon = await buy();
  assert.equal(anon.status, 403);
  assert.equal(anon.data.code, 'members_only');
  assert.match(anon.data.error, /log in/i);
  const plain = await fan();
  assert.equal((await buy(plain.cookie)).status, 403);
  const member = await fan();
  await confirmMember(member.id);
  const ok = await buy(member.cookie);
  assert.notEqual(ok.status, 403, 'members pass the window (payment itself needs a real Paystack key)');

  // Without a window anyone can buy (again, stops only at Paystack locally).
  const open = await fetch(`${BASE}/api/admin/events/${create.id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({
    home_team: 'Lobi Stars FC', away_team: 'Priority Test Open', venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 72 * H).toISOString(),
    vip_price_kobo: 500000, premium_price_kobo: 300000, regular_price_kobo: 100000, active: true, public_sale_at: '',
  }) });
  assert.equal(open.status, 200);
  assert.notEqual((await buy()).status, 403);
  await fetch(`${BASE}/api/admin/events/${create.id}`, { method: 'DELETE', headers: ADMIN });
});

test('members-only stories: text never in the public page; members get it, uncached', async t => {
  const index = await fetch(`${BASE}/data/news-index.json`).then(r => r.json());
  const story = index.find(a => a.membersOnly);
  if (!story) return t.skip('no members-only story in the content');
  const url = `${BASE}/news/${story.slug}/`;
  const anon = await fetch(url);
  assert.equal(anon.headers.get('cache-control'), 'private, no-store');
  const anonHtml = await anon.text();
  assert.match(anonHtml, /This story is for Lobi Stars members/);
  const staticHtml = await fetch(`${BASE}/news/${story.slug}/index.html`).then(r => r.text());
  assert.doesNotMatch(staticHtml, /data-ms-start/);

  const m = await fan();
  await confirmMember(m.id);
  const memberHtml = await fetch(url, { headers: { Cookie: m.cookie } }).then(r => r.text());
  assert.doesNotMatch(memberHtml, /This story is for Lobi Stars members/);
  assert.doesNotMatch(memberHtml, /data-ms-lock/, 'the lock is replaced by the story text');
  assert.notEqual(memberHtml, anonHtml);
  const plain = await fan();
  const plainHtml = await fetch(url, { headers: { Cookie: plain.cookie } }).then(r => r.text());
  assert.match(plainHtml, /This story is for Lobi Stars members/);
});

test('hospitality: page with enquiry form; enquiries are saved as hospitality contacts', async () => {
  const html = await fetch(`${BASE}/hospitality/`).then(r => r.text());
  assert.match(html, /<h1[^>]*>Hospitality<\/h1>/);
  assert.match(html, /name="guests"/);
  assert.match(html, /value="hospitality"/);
  const r = await post('/api/enquiry', { form: 'hospitality', first_name: 'Hosp', last_name: 'Guest', email: `h-${uid()}@example.com`, phone: '08031234567', guests: '12', subject: 'Next home game', message: 'Company outing', privacy_consent: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const sources = (await admin('/api/admin/fans')).data.sources;
  assert.equal(sources.hospitality, 'Hospitality Enquiry');
});

test('Paystack webhook still rejects unsigned calls', async () => {
  const r = await fetch(`${BASE}/api/paystack-webhook`, { method: 'POST', body: JSON.stringify({ event: 'charge.success', data: { reference: 'x', amount: 1 } }) });
  assert.equal(r.status, 401);
});
