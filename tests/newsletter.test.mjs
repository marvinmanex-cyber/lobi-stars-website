// The Lobi Stars Weekly: sign-up with options, newsletter options from the
// email link, sponsor adverts (add / edit / switch off / reorder / delete,
// more than 3), picture uploads, the branded template, test send, sending to
// everyone (test mode), the web version, click counting and staff roles.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 and FANS_DEV_LINKS=1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const post = (path, body, headers = ADMIN) => fetch(BASE + path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (path, headers = ADMIN) => fetch(BASE + path, { headers }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const nl = body => post('/api/admin/newsletter', body);
const made = [];
after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) }); });
async function staff(role) {
  const email = `nl-${role}-${uid()}@example.com`;
  const r = await post('/api/admin/staff', { name: `NL ${role}`, email, password: 'Role-Test-2026!', role });
  made.push(r.data.id);
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  return { Cookie: login.headers.get('set-cookie').split(';')[0] };
}
async function tokenFor(email) {
  const r = await fetch(`${BASE}/api/admin/fans/export?type=marketing`, { headers: ADMIN });
  const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  const row = sheet.split('<row ').find(x => x.includes(email));
  return row?.match(/unsubscribe\/\?t=([a-f0-9]{36})/)?.[1];
}
const signup = (email, extra = {}) => pub('/api/newsletter', { fullName: 'Weekly Reader', phone: `0803${r7()}`, email, confirmEmail: email, consent: true, source: 'test', ...extra });

test('sign-up with newsletter options; options can be changed from the email link; unsubscribe from all', async () => {
  const before = (await get('/api/admin/newsletter')).data.counts;
  const email = `weekly-${uid()}@example.com`;
  assert.equal((await signup(email, { weekly: true, matchday: true, offers: false })).status, 200);
  const after1 = (await get('/api/admin/newsletter')).data.counts;
  assert.equal(after1.recipients - before.recipients, 1, 'will receive the newsletter');
  assert.equal(after1.matchday - before.matchday, 1);
  assert.equal((await signup(`x-${uid()}@example.com`, { consent: false })).status, 400, 'consent needed');

  const t = await tokenFor(email);
  assert.ok(t, 'token found');
  let p = (await get(`/api/newsletter/prefs?t=${t}`, {})).data;
  assert.deepEqual(p.prefs, { weekly: true, matchday: true, offers: false });
  assert.match(p.email, /\*\*\*@example\.com$/, 'email partly hidden');
  assert.equal((await pub('/api/newsletter/prefs', { t, weekly: false, matchday: true, offers: true })).status, 200);
  p = (await get(`/api/newsletter/prefs?t=${t}`, {})).data;
  assert.deepEqual(p.prefs, { weekly: false, matchday: true, offers: true });
  assert.equal((await get('/api/admin/newsletter')).data.counts.recipients, before.recipients, 'weekly off: not a newsletter recipient');
  await pub('/api/newsletter/prefs', { t, unsubscribeAll: true });
  p = (await get(`/api/newsletter/prefs?t=${t}`, {})).data;
  assert.equal(p.subscribed, false);
  assert.equal((await get('/api/newsletter/prefs?t=' + 'a'.repeat(36), {})).status, 404);
});

test('sponsor adverts: add more than 3, edit, switch off, reorder, delete; logos uploaded', async () => {
  const png = Buffer.from('89504E470D0A1A0A0000000D4948445200000001000000010806000000', 'hex');
  const up = await fetch(`${BASE}/api/admin/newsletter/asset`, { method: 'POST', headers: { 'x-admin-code': ADMIN['x-admin-code'], 'Content-Type': 'image/png' }, body: png });
  const asset = await up.json();
  assert.equal(up.status, 200);
  assert.equal((await fetch(BASE + asset.url)).headers.get('content-type'), 'image/png', 'logo is public for emails');
  assert.equal((await fetch(`${BASE}/api/admin/newsletter/asset`, { method: 'POST', headers: { 'x-admin-code': ADMIN['x-admin-code'], 'Content-Type': 'image/png' }, body: 'not an image' })).status, 400);

  const ids = [];
  for (let i = 1; i <= 5; i++) {
    const r = await nl({ action: 'save_sponsor', sponsor: { name: `Sponsor ${i} ${uid()}`, logo: asset.url, link: `https://sponsor${i}.example.com`, headline: 'Official Partner', text: `Advert ${i}`, button_text: 'Visit' } });
    assert.equal(r.status, 200); ids.push(r.data.id);
  }
  assert.equal((await nl({ action: 'save_sponsor', sponsor: { name: 'Bad link', link: 'javascript:alert(1)' } })).status, 400);
  let list = (await get('/api/admin/newsletter')).data.sponsors;
  assert.ok(ids.every(id => list.some(s => s.id === id)));
  const s1 = list.find(s => s.id === ids[0]);
  await nl({ action: 'save_sponsor', sponsor: { ...s1, text: 'Changed text', active: false } });
  list = (await get('/api/admin/newsletter')).data.sponsors;
  assert.equal(list.find(s => s.id === ids[0]).text, 'Changed text');
  assert.equal(list.find(s => s.id === ids[0]).active, 0);
  const order = [ids[4], ...list.map(s => s.id).filter(id => id !== ids[4])];
  await nl({ action: 'order_sponsors', ids: order });
  assert.equal((await get('/api/admin/newsletter')).data.sponsors[0].id, ids[4], 'reordered');
  assert.equal((await nl({ action: 'delete_sponsor', id: ids[0] })).status, 200);
  assert.ok(!(await get('/api/admin/newsletter')).data.sponsors.some(s => s.id === ids[0]), 'deleted');
  const imp = await nl({ action: 'import_partners', partners: [{ name: `Club Partner ${uid()}`, logo: '/images/novus.png', link: 'https://novusmfb.com', headline: 'Official Banking Partner' }] });
  assert.equal(imp.data.added, 1);
});

test('newsletter: branded template with club logo and sponsor adverts; test send; send to all; web version; clicks counted', async () => {
  // Someone to send to.
  await signup(`nl-recipient-${uid()}@example.com`);
  // Four sponsors with website links, made for this test.
  for (let i = 0; i < 4; i++) await nl({ action: 'save_sponsor', sponsor: { name: `Linked ${i} ${uid()}`, logo: '/images/novus.png', link: `https://linked${i}.example.com`, headline: 'Official Partner', text: 'Offer' } });
  const sponsors = (await get('/api/admin/newsletter')).data.sponsors.filter(s => s.active && /^Linked /.test(s.name)).slice(-4);
  assert.ok(sponsors.length >= 4, 'more than 3 sponsors');
  const issue = {
    subject: `Weekly test ${uid()}`, preheader: 'Preview text', headline: 'Derby day is here', intro: 'First paragraph.\n\nSecond <b>paragraph</b>.',
    hero_button_text: 'Buy tickets', hero_button_url: '/tickets/', include_match: true,
    stories: [{ title: 'Story one', text: 'Summary', url: '/news/' }, { title: '' }],
    sponsor_ids: sponsors.map(s => s.id), top_sponsor_id: sponsors[0].id,
  };
  const pv = await fetch(`${BASE}/api/admin/newsletter/preview`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ issue }) }).then(r => r.text());
  assert.match(pv, /lobi-stars-badge\.png/, 'club logo');
  assert.match(pv, /In partnership with/);
  for (const s of sponsors) { assert.ok(pv.includes(s.name), s.name); assert.ok(pv.includes(s.link), `${s.name} link`); }
  assert.match(pv, /Second &lt;b&gt;paragraph&lt;\/b&gt;/, 'text is escaped');
  assert.match(pv, /Hi Ngozi,/);
  assert.match(pv, /Unsubscribe/);

  const saved = await nl({ action: 'save_issue', issue });
  assert.equal(saved.status, 200);
  const id = saved.data.id;
  const got = (await nl({ action: 'get_issue', id })).data.issue;
  assert.equal(got.stories.length, 1, 'empty story dropped');
  assert.equal((await nl({ action: 'save_issue', issue: { subject: '' } })).status, 400);

  const t = await post('/api/admin/newsletter/send', { id, test: 'me@example.com' });
  assert.equal(t.status, 200);
  assert.deepEqual(t.data.sentTo, ['me@example.com']);
  assert.equal((await post('/api/admin/newsletter/send', { id, test: 'not-an-email' })).status, 400);
  assert.equal((await post('/api/admin/newsletter/send', { id })).status, 400, 'must confirm');

  const recipients = (await get('/api/admin/newsletter')).data.counts.recipients;
  let r;
  do { r = await post('/api/admin/newsletter/send', { id, confirm: true }); assert.equal(r.status, 200, JSON.stringify(r.data)); } while (r.data.remaining > 0);
  assert.equal(r.data.total, recipients, 'everyone got it');
  const row = (await get('/api/admin/newsletter')).data.issues.find(i => i.id === id);
  assert.equal(row.status, 'sent');
  assert.equal((await post('/api/admin/newsletter/send', { id, confirm: true })).status, 409, 'never sent twice');
  assert.equal((await nl({ action: 'save_issue', issue: { ...issue, id } })).status, 409, 'sent newsletters cannot be changed');

  const web = await fetch(`${BASE}/newsletter/${row.slug}/`);
  assert.equal(web.status, 200);
  const html = await web.text();
  assert.match(html, /Derby day is here/);
  assert.ok(html.includes(sponsors[1].name));
  assert.match(html, /\/api\/newsletter\/c\?i=/, 'links are counted');
  assert.ok(!/Hi Ngozi/.test(html), 'no personal greeting on the web version');
  assert.ok((await get('/api/newsletter/issues', {})).data.issues.some(i => i.slug === row.slug), 'in the archive');

  const click = await fetch(`${BASE}/api/newsletter/c?i=${id}&k=s&r=${sponsors[1].id}`, { redirect: 'manual' });
  assert.equal(click.status, 302);
  assert.match(click.headers.get('location'), new RegExp(`^${sponsors[1].link.replace(/\./g, '\\.')}/?\\?utm_source=lobistarsfc`));
  const bogus = await fetch(`${BASE}/api/newsletter/c?i=${id}&k=s&r=nope`, { redirect: 'manual' });
  assert.equal(bogus.headers.get('location'), 'https://lobistarsfc.com/', 'never an open redirect');
  const after2 = (await get('/api/admin/newsletter')).data;
  assert.equal(after2.issues.find(i => i.id === id).clicks, 1);
  assert.equal(after2.sponsors.find(s => s.id === sponsors[1].id).clicks >= 1, true);

  const dup = await nl({ action: 'duplicate_issue', id });
  assert.equal((await nl({ action: 'get_issue', id: dup.data.id })).data.issue.status, 'draft');
  assert.equal((await nl({ action: 'delete_issue', id: dup.data.id })).status, 200);
});

test('only Fan Relations, Commercial and Super Admin can use the newsletter admin; pages placed on the site', async () => {
  for (const [role, ok] of [['fan_relations', true], ['commercial', true], ['analyst', false], ['media', false], ['matchday', false]]) {
    const h = await staff(role);
    assert.equal((await get('/api/admin/newsletter', h)).status, ok ? 200 : 403, role);
  }
  assert.equal((await fetch(`${BASE}/api/admin/newsletter`)).status, 401);
  const page = await fetch(`${BASE}/newsletter/`).then(r => r.text());
  for (const t of ['name="weekly"', 'name="matchday"', 'name="offers"', 'Past newsletters']) assert.ok(page.includes(t), t);
  const home = await fetch(`${BASE}/`).then(r => r.text());
  assert.match(home, /href="\/newsletter\/#signup"/, 'homepage band');
  assert.match(home, /href="\/newsletter"/, 'footer link');
});

test('everything is editable: sponsor address, phone, email, offer, featured banner; template wording and footer', async () => {
  const sp = await nl({ action: 'save_sponsor', sponsor: { name: `Featured ${uid()}`, logo: '/images/novus.png', link: 'https://featured.example.com', headline: 'Official Banking Partner', text: 'Open an account today', button_text: 'Open an account', address: '12 Old Otukpo Road, Makurdi', phone: '0803 123 4567', email: 'hello@featured.example.com', offer: '10% off with code LOBISTARS', featured: true, banner_image: '/images/hero-1.jpg' } });
  assert.equal(sp.status, 200);
  assert.equal((await nl({ action: 'save_sponsor', sponsor: { name: 'Bad email', email: 'not-an-email' } })).status, 400);
  const saved = (await get('/api/admin/newsletter')).data.sponsors.find(s => s.id === sp.data.id);
  assert.equal(saved.featured, 1);
  assert.equal(saved.offer, '10% off with code LOBISTARS');

  const before = (await get('/api/admin/newsletter')).data.settings;
  assert.equal((await nl({ action: 'save_settings', settings: { facebook: 'http://not-secure.example.com' } })).status, 400);
  const st = await nl({ action: 'save_settings', settings: { title: 'Lobi Stars Matchday Mail', partnersLabel: 'Proudly supported by', footerAddress: 'Test address, Makurdi', youtube: 'https://www.youtube.com/@lobistars' } });
  assert.equal(st.status, 200);
  const pv = await fetch(`${BASE}/api/admin/newsletter/preview`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ issue: { subject: 'x', sponsor_ids: [sp.data.id] } }) }).then(r => r.text());
  for (const t of ['Lobi Stars Matchday Mail', 'From our partners', '10% off with code LOBISTARS', '12 Old Otukpo Road, Makurdi', 'hello@featured.example.com', 'Open an account', 'Test address, Makurdi', 'youtube.com/@lobistars', '/images/hero-1.jpg']) assert.ok(pv.includes(t), t);
  // Back to how it was.
  await nl({ action: 'save_settings', settings: before });
  await nl({ action: 'delete_sponsor', id: sp.data.id });
});
