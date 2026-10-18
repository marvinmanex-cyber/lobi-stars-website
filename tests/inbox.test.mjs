// Admin Phase 4: the Inbox. Every contact / sponsorship / hospitality message is
// a conversation; staff reply by email, fans' replies come back, notes, assign,
// statuses, spam, templates, roles and erasure.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123,
// FANS_DEV_LINKS=1 (replies count as emailed in test mode) and
// INBOX_INBOUND_KEY=test-inbound INBOX_REPLY_DOMAIN=reply.lobistarsfc.com.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const KEY = process.env.INBOX_INBOUND_KEY || 'test-inbound';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const get = (path, headers = ADMIN) => fetch(BASE + path, { headers }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const post = (path, body, headers = ADMIN) => fetch(BASE + path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const pub = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const made = [];
after(async () => { for (const id of made) await fetch(`${BASE}/api/admin/staff/${id}`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ active: false }) }); });
async function staff(role) {
  const email = `ib-${role}-${uid()}@example.com`;
  const r = await post('/api/admin/staff', { name: `Ade ${role}`, email, password: 'Role-Test-2026!', role });
  made.push(r.data.id);
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  return { id: r.data.id, h: { Cookie: login.headers.get('set-cookie').split(';')[0] } };
}
async function newMessage(form = 'contact', extra = {}) {
  const email = `inbox-${uid()}@example.com`;
  const body = form === 'partnership'
    ? { form, name: 'Bola Partner', company: 'Acme Ltd', email, interest: 'Official Supplier', message: 'We would like to supply water.', privacy_consent: true, ...extra }
    : form === 'hospitality'
      ? { form, first_name: 'Chi', last_name: 'Host', email, guests: 6, message: 'A table for six please.', privacy_consent: true, ...extra }
      : { form, first_name: 'Ngozi', last_name: 'Fan', email, subject: `Season tickets ${uid()}`, message: 'When do season tickets go on sale?\n\nThanks!', ...extra };
  const r = await pub('/api/enquiry', body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const list = (await get(`/api/admin/inbox?q=${encodeURIComponent(email)}`)).data;
  return { email, ref: r.data.ref, thread: list.threads[0] };
}

test('every new form message becomes a conversation with a reference, source and status New', async () => {
  const c = await newMessage('contact');
  assert.match(c.ref, /^LS-\d{4}-\d{5}$/);
  assert.equal(c.thread.ref, c.ref);
  assert.equal(c.thread.source, 'contact_form');
  assert.equal(c.thread.status, 'new');
  assert.equal(c.thread.unread, 1);
  const s = await newMessage('partnership');
  assert.equal(s.thread.source, 'sponsorship');
  assert.match(s.thread.subject, /Sponsorship enquiry: Official Supplier/);
  const h = await newMessage('hospitality');
  assert.equal(h.thread.source, 'hospitality');
  const sp = (await get('/api/admin/inbox?source=sponsorship')).data;
  assert.ok(sp.threads.every(t => t.source === 'sponsorship'), 'source filter');
});

test('old form messages are backfilled: every enquiry has a conversation', async () => {
  const { data } = await get('/api/admin/inbox?tab=all');
  assert.ok(data.total >= 3);
  const fans = (await get('/api/admin/fans?source=contact_form')).data;
  assert.ok(fans.total > 0);
  for (const k of ['all', 'unread', 'new', 'open', 'replied', 'closed', 'mine', 'spam']) assert.equal(typeof data.counts[k], 'number', k);
});

test('round trip: open, reply by email (reference in subject, original quoted), fan replies by email, back to Open + unread', async () => {
  const { thread, email, ref } = await newMessage('contact');
  const view = (await get(`/api/admin/inbox/${thread.id}`)).data;
  assert.equal(view.thread.unread, 0, 'opening marks it read');
  assert.equal(view.messages[0].direction, 'in');
  assert.match(view.messages[0].body_html, /season tickets go on sale/);
  assert.equal(view.contact.email, email);
  assert.ok(view.contact.sources.length >= 1);

  const pv = (await post(`/api/admin/inbox/${thread.id}`, { action: 'preview', html: '<p>Hi {first_name},</p><p>Tickets go on sale <b>soon</b>. <a href="https://lobistarsfc.com/tickets">Tickets</a></p><img src=x onerror=alert(1)><script>alert(1)</script>' })).data;
  assert.equal(pv.subject, `Re: ${thread.subject} [${ref}]`);
  assert.equal(pv.replyTo, `reply+${ref}@reply.lobistarsfc.com`);
  assert.match(pv.from, /Lobi Stars FC <info@lobistarsfc\.com>/);
  assert.match(pv.html, /Hi Ngozi,/, '{first_name} filled in');
  assert.match(pv.html, /<b>soon<\/b>/);
  assert.match(pv.html, /wrote:/, 'original message quoted');
  assert.ok(!/<script|onerror|<img/i.test(pv.html), 'unsafe HTML removed');

  const r = await post(`/api/admin/inbox/${thread.id}`, { action: 'reply', html: '<p>Hi {first_name}, soon!</p>' });
  assert.equal(r.status, 200);
  assert.equal(r.data.emailed, true, 'test mode counts as emailed');
  let v = (await get(`/api/admin/inbox/${thread.id}`)).data;
  assert.equal(v.thread.status, 'replied');
  assert.equal(v.messages.at(-1).direction, 'out');
  assert.equal(v.messages.at(-1).delivery, 'dev');

  // The fan replies by email to reply+REF@...
  assert.equal((await post(`/api/inbox/inbound?key=wrong`, { from: email, to: `reply+${ref}@reply.lobistarsfc.com`, subject: 'x', text: 'x' })).status, 403);
  const inb = await fetch(`${BASE}/api/inbox/inbound?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    from: `Ngozi Fan <${email}>`, to: `reply+${ref}@reply.lobistarsfc.com`, subject: `Re: ${thread.subject} [${ref}]`,
    text: 'Great, thank you! Can I pay by transfer?\n\nOn Sat, 10 Oct 2026, Ade from Lobi Stars FC wrote:\n> Hi Ngozi, soon!',
  }) });
  assert.equal(inb.status, 200);
  const listed = (await get(`/api/admin/inbox?q=${encodeURIComponent(email)}`)).data.threads[0];
  assert.equal(listed.status, 'open');
  assert.equal(listed.unread, 1);
  v = (await get(`/api/admin/inbox/${thread.id}`)).data;
  const last = v.messages.at(-1);
  assert.equal(last.direction, 'in');
  assert.match(last.body_html, /pay by transfer/);
  assert.ok(!/wrote:/.test(last.body_html), 'quoted earlier email trimmed');

  // A form-post provider (Mailgun / SendGrid style) with the reference only in the subject.
  const f = new FormData();
  f.set('sender', email); f.set('recipient', 'info@lobistarsfc.com'); f.set('subject', `Re: [${ref}]`); f.set('body-plain', 'One more question');
  assert.equal((await fetch(`${BASE}/api/inbox/inbound?key=${KEY}`, { method: 'POST', body: f })).status, 200);
  v = (await get(`/api/admin/inbox/${thread.id}`)).data;
  assert.match(v.messages.at(-1).body_html, /One more question/);
});

test('attachments: PDF / images up to 5MB are accepted, other files refused', async () => {
  const { thread } = await newMessage('hospitality');
  const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
  const ok = await post(`/api/admin/inbox/${thread.id}`, { action: 'reply', html: '<p>Our packages attached.</p>', attachments: [{ name: 'packages.pdf', type: 'application/pdf', data: pdf }] });
  assert.equal(ok.status, 200);
  const v = (await get(`/api/admin/inbox/${thread.id}`)).data;
  assert.equal(v.messages.at(-1).attachments[0].name, 'packages.pdf');
  assert.equal((await post(`/api/admin/inbox/${thread.id}`, { action: 'reply', html: '<p>x</p>', attachments: [{ name: 'run.exe', type: 'application/x-msdownload', data: pdf }] })).status, 400);
  const big = Buffer.alloc(5 * 1024 * 1024 + 10).toString('base64');
  assert.equal((await post(`/api/admin/inbox/${thread.id}`, { action: 'reply', html: '<p>x</p>', attachments: [{ name: 'big.pdf', type: 'application/pdf', data: big }] })).status, 400);
  assert.equal((await post(`/api/admin/inbox/${thread.id}`, { action: 'reply', html: '<p> </p>' })).status, 400, 'empty reply refused');
});

test('teamwork: assign, private notes (never emailed), statuses, Assigned to me, activity log', async () => {
  const { thread } = await newMessage('partnership');
  const com = await staff('commercial');
  assert.equal((await post(`/api/admin/inbox/${thread.id}`, { action: 'assign', to: com.id })).status, 200);
  const mine = (await get('/api/admin/inbox?tab=mine', com.h)).data;
  assert.ok(mine.threads.some(t => t.id === thread.id), 'shows under Assigned to me');
  assert.equal((await post(`/api/admin/inbox/${thread.id}`, { action: 'note', text: 'Big brand, call them Monday' }, com.h)).status, 200);
  const v = (await get(`/api/admin/inbox/${thread.id}`, com.h)).data;
  const note = v.messages.find(m => m.direction === 'note');
  assert.ok(note && !note.delivery, 'note is not emailed');
  for (const s of ['open', 'closed', 'new']) {
    assert.equal((await post(`/api/admin/inbox/${thread.id}`, { action: 'status', status: s })).status, 200);
    assert.equal((await get(`/api/admin/inbox/${thread.id}?peek=1`)).data.thread.status, s);
  }
  assert.equal((await post(`/api/admin/inbox/${thread.id}`, { action: 'status', status: 'deleted' })).status, 400);
  const log = (await get('/api/admin/activity')).data;
  const actions = log.log.map(r => r.action);
  for (const a of ['inbox_assign', 'inbox_note', 'inbox_status']) assert.ok(actions.includes(a), a);
});

test('spam: moves to the Spam folder and back; honeypot submissions are dropped', async () => {
  const { thread, email } = await newMessage('contact');
  await post(`/api/admin/inbox/${thread.id}`, { action: 'spam' });
  assert.ok(!(await get(`/api/admin/inbox?q=${encodeURIComponent(email)}`)).data.threads.length, 'gone from All');
  assert.ok((await get(`/api/admin/inbox?tab=spam&q=${encodeURIComponent(email)}`)).data.threads.length, 'in Spam');
  await post(`/api/admin/inbox/${thread.id}`, { action: 'notspam' });
  assert.ok((await get(`/api/admin/inbox?q=${encodeURIComponent(email)}`)).data.threads.length, 'back');

  const botEmail = `bot-${uid()}@example.com`;
  const r = await pub('/api/enquiry', { form: 'contact', first_name: 'Bot', last_name: 'Bot', email: botEmail, subject: 'Cheap', message: 'spam', _gotcha: 'http://spam.example' });
  assert.equal(r.status, 200, 'bots are not told');
  assert.equal((await get(`/api/admin/inbox?q=${encodeURIComponent(botEmail)}`)).data.threads.length, 0);
});

test('templates: add, edit, delete; starter templates exist', async () => {
  const before = (await get('/api/admin/inbox/templates')).data.templates;
  assert.ok(before.length >= 1);
  const s = await post('/api/admin/inbox/templates', { action: 'save', name: `Test ${uid()}`, html: '<p>Hi {first_name}</p><script>x</script>' });
  assert.equal(s.status, 200);
  let t = (await get('/api/admin/inbox/templates')).data.templates.find(x => x.id === s.data.id);
  assert.ok(t && !/script/.test(t.body_html));
  await post('/api/admin/inbox/templates', { action: 'save', id: t.id, name: t.name, html: '<p>Changed</p>' });
  t = (await get('/api/admin/inbox/templates')).data.templates.find(x => x.id === s.data.id);
  assert.equal(t.body_html, '<p>Changed</p>');
  assert.equal((await post('/api/admin/inbox/templates', { action: 'delete', id: t.id })).status, 200);
});

test('settings: alerts and daily summary can be switched off and on', async () => {
  let r = await post('/api/admin/inbox/settings', { alertsEmail: false, dailySummary: false, extraEmails: 'boss@example.com' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.settings, { alertsEmail: false, dailySummary: false, extraEmails: 'boss@example.com' });
  assert.equal((await post('/api/admin/inbox/settings', { alertsEmail: true, dailySummary: true, extraEmails: 'not-an-email' })).status, 400);
  r = await post('/api/admin/inbox/settings', { alertsEmail: true, dailySummary: true, extraEmails: '' });
  assert.equal(r.data.settings.alertsEmail, true);
});

test('privacy: only Inbox roles can read messages (Media: only media@ emails); bell shows unread; erasure deletes the conversation', async () => {
  const analyst = await staff('broadcast_operator'); // a role without the Inbox
  const media = await staff('media');
  const fr = await staff('fan_relations');
  assert.equal((await get('/api/admin/inbox', analyst.h)).status, 403);
  assert.equal((await get('/api/admin/inbox', media.h)).status, 200, 'Media opens the Inbox (media@ emails only)');
  assert.equal((await get('/api/admin/inbox', fr.h)).status, 200);
  assert.equal((await fetch(`${BASE}/admin/inbox/`, { headers: analyst.h, redirect: 'manual' })).status, 403, 'the no-access page');
  assert.equal((await fetch(`${BASE}/admin/inbox/`, { redirect: 'manual' })).status, 302, 'login needed');
  assert.equal((await get('/api/admin/inbox')).status, 200);
  assert.equal((await fetch(`${BASE}/api/admin/inbox`)).status, 401);

  const { thread, email } = await newMessage('contact');
  const bell = (await get('/api/admin/notifications', fr.h)).data.items;
  assert.ok(bell.some(i => /unread message/.test(i.title) && i.href.startsWith('/admin/inbox/')));
  // Media's bell only counts the media@ mailbox (other tests may have left media emails unread).
  const mediaBell = (await get('/api/admin/notifications', media.h)).data.items.find(i => /unread message/.test(i.title));
  assert.ok(!mediaBell || mediaBell.sub === 'Emails to media@lobistarsfc.com', 'contact messages are not counted for Media');
  assert.ok(!(await get('/api/admin/inbox', media.h)).data.threads.some(t => t.id === thread.id), 'Media does not see contact messages');
  assert.equal((await get(`/api/admin/inbox/${thread.id}`, media.h)).status, 404);
  assert.equal((await post('/api/admin/inbox/settings', { alertsEmail: true }, media.h)).status, 403, 'Media cannot change the alerts');

  const contactId = (await get(`/api/admin/inbox/${thread.id}`)).data.contact.id;
  const del = await fetch(`${BASE}/api/admin/fans/${contactId}`, { method: 'DELETE', headers: ADMIN });
  assert.equal(del.status, 200);
  assert.equal((await get(`/api/admin/inbox/${thread.id}`)).status, 404, 'conversation deleted with the person');
  assert.equal((await get(`/api/admin/inbox?q=${encodeURIComponent(email)}`)).data.threads.length, 0);
});

test('admin search finds conversations by reference', async () => {
  const { ref } = await newMessage('contact');
  const r = (await get(`/api/admin/search?q=${ref}`)).data.results;
  assert.ok(r.some(x => x.type === 'Message' && x.href.startsWith('/admin/inbox/?t=')));
});

test('media@ mailbox: emails come in as "Media email" conversations the Media role can read and answer from media@', async () => {
  const media = await staff('media');
  const email = `press-${uid()}@example.com`;
  const send = (to, subject, text) => fetch(`${BASE}/api/inbox/inbound?key=${KEY}&box=media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `Ada Press <${email}>`, to, subject, text }) }).then(r => r.json());
  const r = await send('media@lobistarsfc.com', 'Interview request', 'Can we interview the coach on Friday?');
  assert.equal(r.ok, true); assert.equal(r.created, true);
  const list = (await get('/api/admin/inbox', media.h)).data;
  const t = list.threads.find(x => x.email === email);
  assert.ok(t, 'Media sees it'); assert.equal(t.source, 'media_email');
  assert.deepEqual(Object.keys(list.sources), ['media_email'], 'Media only has the media filter');
  assert.ok(list.threads.every(x => x.source === 'media_email'), 'and only media conversations');
  // A second email from the same person joins the same conversation.
  const r2 = await send('media@lobistarsfc.com', 'Re: Interview request', 'Any update?');
  assert.equal(r2.threadId, t.id);
  // The reply comes from media@ (replies come back through the reply address).
  const pv = await post(`/api/admin/inbox/${t.id}`, { action: 'preview', html: '<p>Yes, Friday at 2pm works.</p>' }, media.h);
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  assert.match(pv.data.from, /<media@lobistarsfc\.com>$/);
  assert.match(pv.data.from, /Lobi Stars FC Media/);
  // The same person writing to the contact form starts a separate (non-media) conversation.
  const fr = await staff('fan_relations'); // now Fan Support: contact form messages only
  const crm = await staff('crm_manager');
  const owner = (await get(`/api/admin/inbox?q=${encodeURIComponent(email)}`)).data.threads;
  assert.equal(owner.length, 1, 'owner sees the media conversation too');
  assert.ok((await get('/api/admin/inbox?source=media_email', crm.h)).data.threads.some(x => x.id === t.id), 'CRM can filter Media emails');
  assert.ok(!(await get('/api/admin/inbox', fr.h)).data.threads.some(x => x.id === t.id), 'Fan Support does not see Media emails');
  assert.equal((await get(`/api/admin/inbox/${t.id}`, fr.h)).status, 404);
});

test('media-mail Worker key: accepted only for the media mailbox; other keys refused', async () => {
  const mk = process.env.MEDIA_INBOUND_KEY || 'test-media';
  const email = `worker-${uid()}@example.com`;
  const r = await fetch(`${BASE}/api/inbox/inbound`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-inbox-key': mk }, body: JSON.stringify({ from: `Reporter <${email}>`, to: 'media@lobistarsfc.com', subject: 'Via the Worker', text: 'Hello media team' }) });
  assert.equal(r.status, 200);
  const t = (await get(`/api/admin/inbox?q=${encodeURIComponent(email)}`)).data.threads[0];
  assert.equal(t.source, 'media_email', 'the Worker key always files it as a media email');
  assert.equal((await fetch(`${BASE}/api/inbox/inbound`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-inbox-key': 'nope' }, body: '{}' })).status, 403);
});
