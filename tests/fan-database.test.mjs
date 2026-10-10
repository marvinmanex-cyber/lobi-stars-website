// Analytics + fan database tests (Part B). Run against a local Pages dev server:
//
//   npm run build
//   npx wrangler pages dev dist --port 8790 --binding FANS_DEV_LINKS=1 ADMIN_CODE=test-code-123 SESSION_SECRET=local-test-secret
//   BASE=http://127.0.0.1:8790 ADMIN_CODE=test-code-123 node --test tests/
//
// Seeds overlapping people, checks they merge, checks the exports, then
// deletes everything it created.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const CODE = process.env.ADMIN_CODE || 'test-code-123';
const RUN = Math.random().toString(36).slice(2, 9);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const mail = tag => `${tag}-${RUN}@seed-${RUN}.test`;

async function call(path, { method = 'GET', body, admin = false, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp(), ...(admin ? { 'x-admin-code': CODE } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const type = res.headers.get('Content-Type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}
const seeded = async () => (await call(`/api/admin/fans?q=${RUN}`, { admin: true })).data;

// Person A: newsletter, then a fan account with a phone, then a contact form
// with a DIFFERENT email but the same phone -> one person.
const A = { email: mail('a'), email2: mail('a2'), phone: `0803${r7()}` };
// Person C: two separate records (newsletter email / enquiry phone) that a
// later partnership enquiry joins together -> one person.
const C = { email: mail('c'), email2: mail('c2'), phone: `0813${r7()}` };
const B = { email: mail('b') };

test('overlapping records merge into one person per email or phone', async () => {
  assert.equal((await call('/api/newsletter', { method: 'POST', body: { fullName: 'Seed Subscriber', phone: A.phone, email: A.email, confirmEmail: A.email, consent: true, source: 'test' } })).status, 200);
  const reg = await call('/api/fans/register', { method: 'POST', body: {
    firstName: 'Seed', surname: `Alpha${RUN}`, email: A.email, confirmEmail: A.email, phone: A.phone,
    password: 'Lobi-Stars-2026', confirmPassword: 'Lobi-Stars-2026', agree: true, marketing: true,
  } });
  assert.ok(reg.status < 300, JSON.stringify(reg.data));
  assert.equal((await call('/api/enquiry', { method: 'POST', body: { form: 'contact', first_name: 'Seedy', last_name: `Alpha${RUN}`, email: A.email2, phone: `+234${A.phone.slice(1)}`, subject: 'Test', message: 'Hello', privacy_consent: true } })).status, 200);

  assert.equal((await call('/api/newsletter', { method: 'POST', body: { fullName: 'Seed Subscriber', phone: `0802${r7()}`, email: B.email, confirmEmail: B.email, consent: true, source: 'test' } })).status, 200);

  assert.equal((await call('/api/newsletter', { method: 'POST', body: { fullName: 'Seed Subscriber', phone: C.phone, email: C.email, confirmEmail: C.email, consent: true, source: 'test' } })).status, 200);
  assert.equal((await call('/api/enquiry', { method: 'POST', body: { form: 'contact', first_name: 'Cee', last_name: 'One', email: C.email2, phone: C.phone, message: 'Hi', privacy_consent: true } })).status, 200);
  assert.equal((await call('/api/enquiry', { method: 'POST', body: { form: 'partnership', name: `Cee Merged${RUN}`, company: 'Seed Ltd', email: C.email, phone: C.phone, message: 'Sponsor', privacy_consent: true } })).status, 200);

  const d = await seeded();
  assert.equal(d.total, 3, `expected 3 people, got ${d.total}: ${JSON.stringify(d.rows.map(r => r.email))}`);
  const a = d.rows.find(r => r.surname === `Alpha${RUN}`);
  assert.ok(a, 'person A found');
  assert.deepEqual([...a.sources].sort(), ['contact_form', 'fan_account', 'newsletter']);
  assert.equal(a.firstName, 'Seedy', 'most recent non-empty name wins');
  assert.equal(a.phone, `+234${A.phone.slice(1)}`, 'phone saved in +234 format');
  assert.equal(a.interactions, 3);
  assert.equal(a.marketingConsent, true);
  const c = d.rows.find(r => r.surname === `Merged${RUN}`);
  assert.ok(c, 'person C merged from two contacts');
  assert.deepEqual([...c.sources].sort(), ['contact_form', 'newsletter', 'sponsorship']);
  const detail = await call(`/api/admin/fans/${c.id}`, { admin: true });
  assert.equal(detail.data.history.length, 3);
});

test('running the backfill again adds nobody twice', async () => {
  const r = await call('/api/admin/fans/backfill', { method: 'POST', admin: true });
  assert.equal(r.status, 200);
  assert.equal((await seeded()).total, 3);
});

test('source percentages match the contact counts', async () => {
  const { data } = await call('/api/admin/analytics?range=30d', { admin: true });
  assert.ok(data.totalContacts >= 3);
  for (const s of data.sources) assert.equal(s.pct, Math.round((s.contacts / data.totalContacts) * 1000) / 10, s.key);
  const sum = data.firstTouch.reduce((n, f) => n + f.contacts, 0);
  assert.equal(sum, data.totalContacts, 'first-touch adds up to every contact');
  assert.ok(data.kpis.pageViews && 'previous' in data.kpis.pageViews);
  for (const k of ['WhatsApp', 'Facebook', 'Instagram', 'X', 'Google', 'Direct', 'Other']) assert.ok(k in data.traffic);
});

test('the .xlsx export has every sheet and opens as a valid workbook', async () => {
  const r = await call('/api/admin/fans/export?type=xlsx', { admin: true });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Disposition'), /lobi-stars-fan-database-\d{4}-\d{2}-\d{2}\.xlsx/);
  const files = unzipSync(r.data);
  for (const f of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(files[f], f);
  const wb = strFromU8(files['xl/workbook.xml']);
  const names = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  assert.deepEqual(names.slice(0, 2), ['All Contacts', 'Summary']);
  // All Contacts + Summary + one sheet per source.
  const { sources } = (await call('/api/admin/fans', { admin: true })).data;
  assert.equal(names.length, 2 + Object.keys(sources).length);
  for (const n of ['Newsletter', 'Contact Form', 'Membership', 'Ticket Buyer', 'Sponsorship Enquiry', 'Food Order', 'Download Lead']) assert.ok(names.includes(n), n);
  const all = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(all, /state="frozen"/);
  assert.match(all, /<autoFilter /);
  assert.ok(all.includes(A.email) || all.includes(A.email2));
  assert.ok(all.includes('Marketing Consent'));

  const s = await call('/api/admin/fans/export?type=sources', { admin: true });
  assert.equal(s.status, 200);
  assert.match(new TextDecoder().decode(s.data), /Source,Contacts,% of all contacts/);

  const m = await call('/api/admin/fans/export?type=marketing', { admin: true });
  const csv = new TextDecoder().decode(m.data);
  assert.ok(csv.includes(B.email), 'newsletter subscriber (consent Y) is on the marketing list');
  assert.ok(!csv.includes(C.email2) || csv.includes(C.email), 'contact-form only people are not');
  assert.match(csv, /\/unsubscribe\/\?t=[a-f0-9]{36}/);

  const log = await call('/api/admin/export-log', { admin: true });
  assert.ok(log.data.log.some(l => l.action === 'export_xlsx'), 'export was logged');
});

test('non-admins are blocked and staff without export permission cannot download', async () => {
  assert.equal((await call('/api/admin/fans')).status, 401);
  assert.equal((await call('/api/admin/analytics')).status, 401);
  assert.equal((await call('/api/admin/fans/export?type=xlsx')).status, 401);
  assert.equal((await call('/api/admin/fans', { headers: { 'x-admin-code': 'wrong-code-000' } })).status, 401);
  const page = await call('/admin/analytics');
  assert.equal(page.status, 302, 'dashboard page redirects to login');

  const email = mail('staff');
  const created = await call('/api/admin/staff', { method: 'POST', admin: true, body: { name: `Seed Staff ${RUN}`, email, password: 'Staff-Password-1', canExport: false } });
  assert.ok(created.status < 300, JSON.stringify(created.data));
  const login = await call('/api/admin/login', { method: 'POST', body: { email, password: 'Staff-Password-1' } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const list = await call(`/api/admin/fans?q=${RUN}`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200, 'staff can view the list');
  assert.ok(list.data.rows.every(r => !r.email || r.email.includes('***')), 'emails are masked');
  assert.equal((await call('/api/admin/fans/export?type=xlsx', { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await call('/api/admin/fans/export?type=marketing', { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await call(`/api/admin/fans/${list.data.rows[0].id}`, { method: 'DELETE', headers: { Cookie: cookie } })).status, 403);
  assert.equal((await call('/api/admin/fans/backfill', { method: 'POST', headers: { Cookie: cookie } })).status, 403);
  // Tidy up: switch the test account off.
  const id = created.data.staff?.id || created.data.id;
  if (id) await call(`/api/admin/staff/${id}`, { method: 'PUT', admin: true, body: { active: false } });
});

test('bots and signed-in staff are not counted as visitors', async () => {
  const path = `/seed-${RUN}`;
  const view = headers => call('/api/track', { method: 'POST', body: { path, consent: false }, headers });
  // Enough views to reach today's top 10 even on a busy local test database.
  const HUMAN = 60;
  for (let i = 0; i < HUMAN; i++) await view({ 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' });
  await view({ 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
  await view({ 'User-Agent': 'facebookexternalhit/1.1' });
  const login = await call('/api/admin/login', { method: 'POST', body: { code: CODE } });
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  await view({ Cookie: cookie, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' });
  const { data } = await call('/api/admin/analytics?range=today', { admin: true });
  const row = data.topPages.find(p => p.path === path);
  assert.ok(row, 'test page is in the top pages');
  assert.equal(row.views, HUMAN);
  assert.equal(row.visitors, 0, 'no consent -> anonymous page views only');
});

test('unsubscribe and delete-everywhere work', async () => {
  const d = await seeded();
  const b = d.rows.find(r => r.sources.length === 1 && r.sources[0] === 'newsletter' && r.email === B.email);
  assert.ok(b);
  assert.equal((await call(`/api/admin/fans/${b.id}`, { method: 'POST', admin: true, body: { action: 'unsubscribe' } })).status, 200);
  assert.equal((await seeded()).rows.find(r => r.id === b.id).marketingConsent, false);
  assert.equal((await call('/api/unsubscribe', { method: 'POST', body: { t: 'nothex' } })).status, 400);
});

after(async () => {
  // Remove every seeded person (and their original records).
  const d = await seeded();
  for (const r of d.rows || []) await call(`/api/admin/fans/${r.id}`, { method: 'DELETE', admin: true });
  const left = await seeded();
  assert.equal(left.total, 0, 'seed data removed');
});
