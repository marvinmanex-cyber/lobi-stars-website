// Admin Phase 3: contact sources chart, downloads, configurable sources, possible duplicates.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const get = (path, headers = ADMIN) => fetch(BASE + path, { headers }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const post = (path, body, headers = ADMIN) => fetch(BASE + path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const sheets = async path => {
  const r = await fetch(BASE + path, { headers: ADMIN });
  assert.equal(r.status, 200, path);
  const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const names = [...strFromU8(files['xl/workbook.xml']).matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  return { names, sheet: i => strFromU8(files[`xl/worksheets/sheet${i}.xml`]), styles: strFromU8(files['xl/styles.xml']), disposition: r.headers.get('content-disposition') };
};
const made = [];
after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false, reason: 'test finished' }) }); });
async function staff(role, canExport = false) {
  const email = `cs-${role}-${uid()}@example.com`;
  const r = await post('/api/admin/staff', { name: `CS ${role}`, email, password: 'Role-Test-2026!', role, canExport });
  made.push(r.data.id);
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  return { Cookie: login.headers.get('set-cookie').split(';')[0] };
}

test('pie: each contact counted once by first source, adds up to exactly 100%; bars count every channel used', async () => {
  const { data } = await get('/api/admin/contact-sources?range=all');
  assert.ok(data.total > 0);
  const sum = Math.round(data.pie.reduce((s, x) => s + x.pct, 0) * 10) / 10;
  assert.equal(sum, 100);
  assert.equal(data.pie.reduce((s, x) => s + x.contacts, 0), data.total, 'every contact in exactly one slice');
  for (const slice of data.pie) {
    const bar = data.bars.find(b => b.key === slice.key);
    if (bar) assert.ok(bar.contacts >= slice.contacts, `${slice.key}: everyone whose first source it is also used it`);
  }
  assert.ok(data.cards.top && data.cards.total === data.total);
  const week = (await get('/api/admin/contact-sources?range=7d')).data;
  assert.ok(week.total <= data.total, 'the date range narrows the count');
});

test('clicking a slice lists only the people who first came from that source', async () => {
  const { data } = await get('/api/admin/contact-sources?range=all');
  const slice = data.pie[0];
  const list = (await get(`/api/admin/contact-sources?range=all&list=1&firstSource=${slice.key}`)).data;
  assert.equal(list.total, slice.contacts);
  assert.ok(list.rows.every(r => r.firstSource === slice.key));
});

test('Download All Contacts: real Excel, one row per person, summary and one sheet per source, red header and alternating rows', async () => {
  const x = await sheets('/api/admin/fans/export?type=xlsx');
  assert.match(x.disposition, /lobi-stars-contacts-\d{4}-\d{2}-\d{2}\.xlsx/);
  assert.deepEqual(x.names.slice(0, 2), ['All Contacts', 'Summary']);
  assert.ok(x.names.includes('Newsletter') && x.names.includes('Food Order'));
  const all = x.sheet(1);
  for (const h of ['First Name', 'Surname', 'Email', 'Phone', 'State', 'All Sources', 'First Source', 'First Seen', 'Last Seen', 'Number of Interactions', 'Email Verified', 'Member', 'Marketing Consent']) assert.ok(all.includes(`>${h}<`), h);
  const emails = [...all.matchAll(/<t xml:space="preserve">([^<]+@[^<]+)<\/t>/g)].map(m => m[1].toLowerCase());
  assert.equal(new Set(emails).size, emails.length, 'no duplicate people');
  assert.match(x.styles, /FFE31E24/, 'club red header');
  assert.match(all, /state="frozen"/);
  assert.match(all, /<autoFilter /);
  assert.match(all, / s="2"/, 'alternating row colour');
  assert.match(x.sheet(2), /adds up to 100%/);
});

test('Filtered List and Marketing List download exactly the right people', async () => {
  const f = await sheets('/api/admin/fans/export?type=filtered&source=newsletter');
  assert.deepEqual(f.names, ['Filtered Contacts', 'Summary']);
  const { data } = await get('/api/admin/fans?source=newsletter');
  const rows = (f.sheet(1).match(/<row /g) || []).length - 1;
  assert.equal(rows, data.total, 'same number of people as the filtered table');
  const m = await sheets('/api/admin/fans/export?type=marketing');
  assert.equal(m.names[0], 'Marketing List');
  assert.ok(!/>No<\/t><\/is><\/c><c r="N/.test(m.sheet(1)), 'everyone has marketing consent');
  assert.match(m.sheet(1), /\/unsubscribe\/\?t=/);
});

test('sources can be renamed and added (Settings access only); new names show everywhere', async () => {
  const before = (await get('/api/admin/contact-source-defs')).data.sources.find(s => s.key === 'fan_account');
  const r = await post('/api/admin/contact-source-defs', { action: 'save', key: 'fan_account', label: 'Predictor Registration', color: '#8B5CF6' });
  assert.equal(r.status, 200);
  assert.equal((await get('/api/admin/fans')).data.sources.fan_account, 'Predictor Registration');
  const add = await post('/api/admin/contact-source-defs', { action: 'add', label: `Test Form ${uid()}`, color: '#123456' });
  assert.match(add.data.key, /^test_form_/);
  assert.ok(add.data.sources.some(s => s.key === add.data.key && !s.builtin));
  const analyst = await staff('fan_support'); // sees the contact sources, cannot manage sources or download fans
  assert.equal((await get('/api/admin/contact-sources?range=all', analyst)).status, 200, 'report readers see the chart');
  assert.equal((await post('/api/admin/contact-source-defs', { action: 'save', key: 'fan_account', label: 'X', color: '#000000' }, analyst)).status, 403);
  assert.equal((await fetch(`${BASE}/api/admin/fans/export?type=xlsx`, { headers: analyst })).status, 403, 'no download without the export permission');
  const list = (await get('/api/admin/contact-sources?range=all&list=1', analyst)).data;
  assert.ok(list.rows.every(x => !x.email || x.email.includes('***')), 'emails partly hidden');
  await post('/api/admin/contact-source-defs', { action: 'save', key: 'fan_account', label: before.label, color: before.color });
  assert.equal((await post('/api/admin/contact-source-defs', { action: 'delete', key: 'newsletter' })).status, 400, 'built-in sources stay');
  assert.equal((await post('/api/admin/contact-source-defs', { action: 'delete', key: add.data.key })).status, 200, 'unused added source removed');
});

test('possible duplicates: same name + similar email are suggested; merge keeps all sources; keep separate hides the pair', async () => {
  const name = `Dupe ${uid()} Person`;
  const e1 = `dupe.person.${uid()}@example.com`, e2 = e1.replace('dupe.person.', 'dupeperson.');
  for (const email of [e1, e2]) assert.equal((await pub('/api/newsletter', { fullName: name, phone: `0803${r7()}`, email, confirmEmail: email, consent: true, source: 'test' })).status, 200);
  await pub('/api/enquiry', { form: 'contact', first_name: name.split(' ').slice(0, 2).join(' '), last_name: 'Person', email: e2, subject: 'Hi', message: 'Hello', privacy_consent: true });
  let pairs = (await get('/api/admin/fans/duplicates')).data.pairs;
  const pair = pairs.find(p => [p.a.email, p.b.email].includes(e1));
  assert.ok(pair, 'suggested');
  assert.match(pair.why, /dots/);
  const m = await post('/api/admin/fans/duplicates', { action: 'merge', keep: pair.a.id, merge: pair.b.id });
  assert.equal(m.status, 200);
  const rows = (await get(`/api/admin/fans?q=${encodeURIComponent(name.toLowerCase())}`)).data.rows;
  assert.equal(rows.length, 1, 'one person now');
  assert.ok(rows[0].sources.includes('newsletter'));
  pairs = (await get('/api/admin/fans/duplicates')).data.pairs;
  assert.ok(!pairs.some(p => [p.a.email, p.b.email].includes(e1)));

  const name2 = `Twin ${uid()} Name`;
  const f1 = `twin${uid()}@example.com`, f2 = f1.replace('@example.com', '@example.org');
  for (const email of [f1, f2]) await pub('/api/newsletter', { fullName: name2, phone: `0803${r7()}`, email, confirmEmail: email, consent: true, source: 'test' });
  const p2 = (await get('/api/admin/fans/duplicates')).data.pairs.find(p => [p.a.email, p.b.email].includes(f1));
  assert.ok(p2);
  assert.equal((await post('/api/admin/fans/duplicates', { action: 'separate', a: p2.a.id, b: p2.b.id })).status, 200);
  assert.ok(!(await get('/api/admin/fans/duplicates')).data.pairs.some(p => [p.a.email, p.b.email].includes(f1)));
});

test('fan profile shows messages and food orders; pages are staff-only', async () => {
  const email = `prof-${uid()}@example.com`;
  await pub('/api/enquiry', { form: 'contact', first_name: 'Profile', last_name: 'Fan', email, subject: 'Tickets question', message: 'When do tickets go on sale?', privacy_consent: true });
  const row = (await get(`/api/admin/fans?q=${encodeURIComponent(email)}`)).data.rows[0];
  const prof = (await get(`/api/admin/fans/${row.id}`)).data;
  assert.equal(prof.activity.messages[0].subject, 'Tickets question');
  for (const path of ['/admin/contact-sources/', '/admin/fans/duplicates/']) assert.equal((await fetch(BASE + path, { redirect: 'manual' })).status, 302, path);
});
