// Admin Phase 5 (handover): seed data shows up everywhere it should, every
// role can open exactly its own screens and APIs (and nothing else), the
// pre-reorganisation admin addresses still work, every sidebar link opens,
// and admin pages stay out of search engines.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const CODE = process.env.ADMIN_CODE || 'test-code-123';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': CODE };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const r7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const get = (path, headers = ADMIN) => fetch(BASE + path, { headers }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

const made = [];
const cookies = {};
async function login(body) {
  const r = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
const ROLES = ['super_admin', 'content_editor', 'media_editor', 'media_contributor', 'matchday_admin', 'broadcast_operator', 'crm_manager', 'fan_support', 'commercial_manager', 'matchday_ops_manager', 'gate_staff', 'kitchen_staff'];
before(async () => {
  for (const role of ROLES) {
    const email = `ho-${role}-${uid()}@example.com`;
    const r = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: `Handover ${role}`, email, password: 'Role-Test-2026!', role, canExport: false }) });
    const d = await r.json();
    assert.equal(r.status, 200, JSON.stringify(d));
    made.push(d.id);
    cookies[role] = await login({ email, password: 'Role-Test-2026!' });
  }
  cookies.owner = await login({ code: CODE });
});
after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) }); });
const as = (who, path, method = 'GET') => fetch(BASE + path, { method, redirect: 'manual', headers: { Cookie: cookies[who], 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });

// Who may open what. Written out by hand (not read from the code) so a
// mistake in the role rules shows up here.
const ALL = ROLES;
const SA = ['super_admin'];
const VIEW_MATCH = ['content_editor', 'media_editor', 'media_contributor', 'matchday_admin', 'broadcast_operator', 'matchday_ops_manager'];
const INBOX = ['media_editor', 'media_contributor', 'crm_manager', 'fan_support', 'commercial_manager'];
const FANS = ['crm_manager', 'fan_support'];
const FOOD = ['commercial_manager', 'matchday_ops_manager'];
const REPORTS = ['crm_manager', 'commercial_manager'];
const PAGES = {
  '/admin/dashboard/': ALL,
  '/admin/matches/': [...SA, 'matchday_admin'],
  '/admin/match-centre/': [...SA, ...VIEW_MATCH],
  '/admin/predictions/': [...SA, 'matchday_admin'],
  '/admin/commentary/': [...SA, 'matchday_admin', 'broadcast_operator'],
  '/admin/fan-alerts/': [...SA, 'matchday_admin', 'broadcast_operator'],
  '/admin/news/': [...SA, 'content_editor', 'media_editor', 'media_contributor'],
  '/admin/awards/': [...SA, 'content_editor', 'media_editor'],
  '/admin/inbox/': [...SA, ...INBOX],
  '/admin/newsletter/': [...SA, 'content_editor', 'media_editor', 'crm_manager', 'commercial_manager'],
  '/admin/fans/': [...SA, ...FANS],
  '/admin/fans/duplicates/': [...SA, ...FANS],
  '/admin/members/': [...SA, ...FANS],
  '/admin/contact-sources/': [...SA, ...FANS, 'commercial_manager'],
  '/admin/food-orders/': [...SA, ...FOOD],
  '/admin/food-orders/live/': [...SA, ...FOOD],
  '/admin/food-orders/menu/': [...SA, ...FOOD],
  '/admin/food-orders/analytics/': [...SA, ...FOOD, 'crm_manager'],
  '/admin/kitchen/': [...SA, ...FOOD, 'kitchen_staff'],
  '/admin/tickets/scan/': [...SA, 'matchday_admin', 'commercial_manager', 'matchday_ops_manager', 'gate_staff'],
  '/admin/shirt-orders/': [...SA, 'commercial_manager'],
  '/admin/partners/': [...SA, 'commercial_manager'],
  '/admin/analytics/': [...SA, ...REPORTS],
  '/admin/activity/': SA,
  '/admin/backup/': SA,
  '/admin/staff/': SA,
};
const APIS = {
  '/api/admin/dashboard': ALL,
  '/api/admin/me': ALL,
  '/api/admin/notifications': ALL,
  '/api/admin/events': [...SA, ...VIEW_MATCH, 'commercial_manager'],
  '/api/admin/commentary': [...SA, 'matchday_admin', 'broadcast_operator'],
  '/api/admin/awards': [...SA, 'content_editor', 'media_editor'],
  '/api/admin/inbox': [...SA, ...INBOX],
  '/api/admin/inbox/templates': [...SA, ...INBOX],
  '/api/admin/fans': [...SA, ...FANS],
  '/api/admin/fans/duplicates': [...SA, ...FANS],
  '/api/admin/members': [...SA, ...FANS],
  '/api/admin/contact-sources?range=7d': [...SA, ...FANS, 'commercial_manager'],
  '/api/admin/food-orders': [...SA, ...FOOD],
  '/api/admin/food-menu': [...SA, ...FOOD],
  '/api/admin/food-analytics?range=7d': [...SA, ...FOOD, 'crm_manager'],
  '/api/admin/kitchen/orders': [...SA, ...FOOD, 'kitchen_staff'],
  '/api/admin/shirt-orders': [...SA, 'commercial_manager'],
  '/api/admin/activity': SA,
  '/api/admin/export-log': [...SA, 'crm_manager'],
  '/api/admin/roles': SA,
  '/api/admin/staff': SA,
};

test('seed data: messages and sign-ups appear in the Inbox, the fan database, the sources chart, the dashboard and the bell', async () => {
  const tag = uid();
  const before = {
    inbox: (await get('/api/admin/inbox')).data,
    chart: (await get('/api/admin/contact-sources?range=all')).data,
    dash: (await get('/api/admin/dashboard')).data,
  };
  const seed = [
    ['/api/enquiry', { form: 'contact', first_name: 'Seed', last_name: `Contact${tag}`, email: `seed-c1-${tag}@example.com`, subject: 'Match tickets', message: 'Where can I buy tickets?' }],
    ['/api/enquiry', { form: 'contact', first_name: 'Seed', last_name: `Contact${tag}`, email: `seed-c2-${tag}@example.com`, subject: 'Lost property', message: 'I left my cap at the stadium.' }],
    ['/api/enquiry', { form: 'partnership', name: `Seed Sponsor${tag}`, company: 'Seed Ltd', email: `seed-s1-${tag}@example.com`, interest: 'Official Supplier', message: 'Partnership idea', privacy_consent: true }],
    ['/api/enquiry', { form: 'hospitality', first_name: 'Seed', last_name: `Host${tag}`, email: `seed-h1-${tag}@example.com`, guests: 4, message: 'Table for four', privacy_consent: true }],
  ];
  for (const [path, body] of seed) assert.equal((await pub(path, body)).status, 200, body.email);
  for (let i = 0; i < 2; i++) {
    const email = `seed-n${i}-${tag}@example.com`;
    assert.equal((await pub('/api/newsletter', { fullName: `Seed News${tag}`, phone: `0803${r7()}`, email, confirmEmail: email, consent: true, source: 'test' })).status, 200);
  }

  const inbox = (await get(`/api/admin/inbox?q=${tag}`)).data;
  assert.equal(inbox.total, 4, 'all four messages are conversations');
  assert.deepEqual(inbox.threads.map(t => t.source).sort(), ['contact_form', 'contact_form', 'hospitality', 'sponsorship']);
  assert.ok(inbox.threads.every(t => t.status === 'new' && t.unread === 1));
  const after1 = (await get('/api/admin/inbox')).data;
  assert.equal(after1.counts.new - before.inbox.counts.new, 4);
  assert.equal(after1.counts.unread - before.inbox.counts.unread, 4);

  const fans = (await get(`/api/admin/fans?q=${tag}`)).data;
  assert.equal(fans.total, 6, 'six people in the fan database');
  const chart = (await get('/api/admin/contact-sources?range=all')).data;
  assert.equal(chart.total - before.chart.total, 6, 'the sources chart counts them');
  const dash = (await get('/api/admin/dashboard')).data;
  assert.equal(dash.messages.week - before.dash.messages.week, 4);
  assert.equal(dash.messages.waiting - before.dash.messages.waiting, 4);
  const bell = (await get('/api/admin/notifications')).data.items;
  assert.ok(bell.some(i => /unread message/.test(i.title)));
});

test('roles: every admin page opens for exactly the right roles (others get the no-access page)', async () => {
  const wrong = [];
  for (const [path, allowed] of Object.entries(PAGES)) {
    for (const role of ROLES) {
      const r = await as(role, path);
      const ok = r.status === 200;
      if (ok !== allowed.includes(role)) wrong.push(`${role} ${path}: ${r.status} ${r.headers.get('location') || ''}`);
      if (!ok) assert.equal(r.status, 403, `${role} ${path}`);
      await r.body?.cancel();
    }
    assert.equal((await as('owner', path)).status, 200, `owner ${path}`);
  }
  assert.deepEqual(wrong, []);
});

test('roles: every admin API answers for exactly the right roles (403 otherwise), and read-only / view-only roles cannot change anything', async () => {
  const wrong = [];
  for (const [path, allowed] of Object.entries(APIS)) {
    for (const role of ROLES) {
      const r = await as(role, path);
      await r.body?.cancel();
      const ok = r.status !== 403 && r.status !== 401;
      if (ok !== allowed.includes(role)) wrong.push(`${role} ${path}: ${r.status}`);
    }
  }
  assert.deepEqual(wrong, []);
  // Roles that can only look cannot change anything there.
  for (const [role, path] of [['content_editor', '/api/admin/events'], ['media_editor', '/api/admin/events'], ['broadcast_operator', '/api/admin/match-centre/x'],
    ['fan_support', '/api/admin/members'], ['fan_support', '/api/admin/fans/duplicates'], ['fan_support', '/api/admin/rewards/catalogue'],
    ['commercial_manager', '/api/admin/contact-source-defs'], ['kitchen_staff', '/api/admin/kitchen/settings'], ['media_contributor', '/api/admin/league/teams']]) {
    assert.equal((await as(role, path, 'POST')).status, 403, `${role} POST ${path}`);
  }
  // Signed-out visitors get nothing.
  for (const path of Object.keys(APIS)) assert.equal((await fetch(BASE + path)).status, 401, path);
});

test('old admin addresses (before the reorganisation) still open, with or without the slash and with old filters', async () => {
  const OLD = ['analytics', 'awards', 'commentary', 'fans', 'match-centre', 'matches', 'members', 'news', 'partners', 'predictions', 'shirt-orders', 'staff'];
  for (const name of OLD) {
    for (const path of [`/admin/${name}/`, `/admin/${name}`]) {
      const r = await fetch(BASE + path, { headers: { Cookie: cookies.owner } });
      assert.equal(r.status, 200, path);
      assert.match(await r.text(), /class="ash-side"/, `${path} uses the new admin shell`);
    }
  }
  for (const path of ['/admin/fans/?source=contact_form', '/admin/fans/?source=sponsorship', '/admin/fans/?source=newsletter', '/admin/analytics/?range=30d', '/admin/match-centre/?id=x', '/admin/login/']) {
    assert.equal((await fetch(BASE + path, { headers: { Cookie: cookies.owner } })).status, 200, path);
  }
  // The Content CMS still lives at /admin/.
  const cms = await fetch(`${BASE}/admin/`, { headers: { Cookie: cookies.owner } });
  assert.equal(cms.status, 200);
});

test('every link in the admin sidebar opens', async () => {
  const html = await (await fetch(`${BASE}/admin/dashboard/`, { headers: { Cookie: cookies.owner } })).text();
  const nav = html.slice(html.indexOf('class="ash-nav"'), html.indexOf('</nav>', html.indexOf('class="ash-nav"')));
  const hrefs = [...new Set([...nav.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')))];
  assert.ok(hrefs.length >= 40, `found ${hrefs.length} links`);
  const broken = [];
  for (const href of hrefs) {
    const path = href.split('#')[0] || '/admin/';
    const r = await fetch(BASE + path, { headers: { Cookie: cookies.owner } });
    if (r.status !== 200) broken.push(`${href}: ${r.status}`);
  }
  assert.deepEqual(broken, []);
});

test('admin pages are never indexed: noindex on every page, robots.txt blocks /admin, nothing in the sitemap', async () => {
  for (const path of Object.keys(PAGES)) {
    const r = await fetch(BASE + path, { headers: { Cookie: cookies.owner } });
    assert.match(r.headers.get('x-robots-tag') || '', /noindex/, path);
    assert.match(await r.text(), /<meta name="robots" content="noindex/, path);
  }
  const anon = await fetch(`${BASE}/admin/inbox/`, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('x-robots-tag') || '', /noindex/);
  assert.match(await (await fetch(`${BASE}/robots.txt`)).text(), /Disallow: \/admin/);
  const maps = [];
  for (const path of ['/sitemap.xml', '/sitemap-index.xml', '/sitemap-0.xml']) {
    const r = await fetch(BASE + path);
    if (r.ok) maps.push(await r.text());
  }
  assert.ok(maps.length, 'a sitemap exists');
  for (const m of maps) assert.doesNotMatch(m, /\/admin/);
});
