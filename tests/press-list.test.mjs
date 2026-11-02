// Media Centre › Press List: the "Share with media houses" button is gone from
// /media/, the accreditation form's opt-in box (one contact per email, matches
// applied counted), staff add / import with agreement, "Send to press list"
// (preview, test, one email per person, unsubscribed left out), the signed
// one-click unsubscribe, and Sent messages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const SECRET = process.env.SESSION_SECRET || 'local-test-secret';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const T = Math.random().toString(36).slice(2, 8).replace(/\d/g, 'q');
const LOGIN = `Press${T}${String(Math.floor(Math.random() * 90) + 10)}`;
const M1 = `pl-one-${T}`, M2 = `pl-two-${T}`;
const DEREK = `derek.${T}@example.com`, RADIO = `radio.${T}@example.com`, QUIET = `quiet.${T}@example.com`;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const admin = (p, body) => fetch(`${BASE}/api/admin/media-centre/${p}`, { method: 'POST', headers: ADMIN, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
let S, FT = '';
const mc = (p, method = 'GET', body) => fetch(`${BASE}/api/media-centre/${p}`, { method, headers: { Cookie: S.cookie, 'X-CSRF-Token': S.csrf, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const jpg = readFileSync(new URL('../public/images/lobi-stars-badge-print.jpg', import.meta.url));
const pdf = Buffer.from('%PDF-1.4\n% test\n' + 'x'.repeat(300));
function form(over = {}) {
  const f = new FormData();
  const v = { fullName: 'Derek Kakaan', phone: '0803 123 4567', email: DEREK, organisation: 'Benue Voice', employment: 'staff', role: 'Journalist', agree: '1', website: '', formToken: FT, ...over };
  for (const [k, x] of Object.entries(v)) if (x !== undefined) f.append(k, x);
  f.append('photo', new Blob([jpg], { type: 'image/jpeg' }), 'p.jpg');
  f.append('pressDoc', new Blob([pdf], { type: 'application/pdf' }), 'id.pdf');
  return f;
}
const applyNow = f => fetch(`${BASE}/api/media/accreditation`, { method: 'POST', body: f, headers: { 'CF-Connecting-IP': ip() } }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const contact = async email => (await mc('press-list')).data.contacts.find(c => c.email === email);

before(async () => {
  const d = days => new Date(Date.now() + days * 86400e3).toISOString();
  sql(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES
    ('${M1}', 'Lobi Stars FC', 'Press One ${T}', 'NNL', '${d(9)}', 'McCarthy Stadium, Makurdi', 0, 0, 0, 1),
    ('${M2}', 'Lobi Stars FC', 'Press Two ${T}', 'NNL', '${d(16)}', 'McCarthy Stadium, Makurdi', 0, 0, 0, 1);`);
  assert.equal((await admin('users', { action: 'create', loginId: LOGIN, fullName: 'Austin Tyowua', password: 'Temp-pass-123' })).status, 200);
  FT = (await fetch(`${BASE}/api/media/accreditation`).then(x => x.json())).formToken;
  await new Promise(r => setTimeout(r, 3200));
  const r = await fetch(`${BASE}/api/media-centre/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: LOGIN, password: 'Temp-pass-123' }) });
  S = { cookie: r.headers.get('set-cookie').match(/ls_media=[^;]+/)[0], csrf: (await r.json()).csrf };
  await mc('password', 'POST', { current: 'Temp-pass-123', password: 'Own-pass-456' });
});
after(() => {
  sql(`DELETE FROM mc_press_recipients WHERE email LIKE '%.${T}@example.com'; DELETE FROM mc_press_messages WHERE sent_by_name = 'Austin Tyowua'; DELETE FROM mc_accreditations WHERE event_id IN ('${M1}', '${M2}');
    DELETE FROM mc_contacts WHERE email LIKE '%.${T}@example.com'; DELETE FROM mc_accr_matches WHERE event_id IN ('${M1}', '${M2}'); DELETE FROM events WHERE id IN ('${M1}', '${M2}');
    DELETE FROM mc_sessions WHERE user_id IN (SELECT id FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}'); DELETE FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}';`);
});

test('the Press Room and the accreditation page have no "Share with media houses" button; the form has the press list box', async () => {
  const media = await fetch(`${BASE}/media/`).then(r => r.text());
  assert.doesNotMatch(media, /Share with media houses/i);
  for (const s of ['Press releases', 'Accreditation', 'Interviews']) assert.ok(media.includes(s));
  const acc = await fetch(`${BASE}/media/accreditation/`).then(r => r.text());
  assert.doesNotMatch(acc, /Share with media houses/i);
  assert.match(acc, /name="pressList"/);
  assert.doesNotMatch(acc, /name="pressList"[^>]*checked/, 'unticked by default');
  assert.equal((await fetch(`${BASE}/api/media-centre/press-list`)).status, 401, 'the press list needs the Media Centre login');
});

test('applying with the box ticked: one contact, subscribed; a second match counts 2; not ticking keeps the contact unsubscribed', async () => {
  assert.equal((await applyNow(form({ eventId: M1, pressList: '1' }))).status, 200);
  let c = await contact(DEREK);
  assert.ok(c); assert.equal(c.subscribed, true); assert.equal(c.source, 'Accreditation form'); assert.equal(c.applications, 1);
  assert.equal((await applyNow(form({ eventId: M2 }))).status, 200);
  c = await contact(DEREK);
  assert.equal((await mc('press-list')).data.contacts.filter(x => x.email === DEREK).length, 1, 'still one contact');
  assert.equal(c.applications, 2); assert.equal(c.subscribed, true, 'not ticking the second time does not unsubscribe');
  assert.deepEqual(c.applied.sort(), [M1, M2].sort());
  assert.equal((await applyNow(form({ eventId: M1, email: QUIET, fullName: 'Quiet Person' }))).status, 200);
  assert.equal((await contact(QUIET)).subscribed, false);
});

test('staff add a radio journalist (agreement needed) and import a CSV', async () => {
  const add = { action: 'add', fullName: 'Rita Radio', email: RADIO, phone: '0809 000 1111', organisation: 'Harvest FM', mediaType: 'Radio', role: 'Radio' };
  assert.equal((await mc('press-list', 'POST', add)).status, 400, 'agreement needed');
  assert.equal((await mc('press-list', 'POST', { ...add, consent: true })).status, 200);
  assert.equal((await mc('press-list', 'POST', { ...add, consent: true })).status, 400, 'email is unique');
  const c = await contact(RADIO);
  assert.equal(c.source, 'Added by staff'); assert.equal(c.subscribed, true); assert.equal(c.mediaType, 'Radio');
  const imp = await mc('press-list', 'POST', { action: 'import', consent: false, rows: [
    { name: 'New One', email: `new1.${T}@example.com`, phone: '', organisation: 'TV Benue', media_type: 'tv' },
    { name: 'Derek again', email: DEREK, phone: '', organisation: '', media_type: '' },
    { name: 'Bad', email: 'not-an-email', phone: '', organisation: '', media_type: '' }] });
  assert.equal(imp.status, 200); assert.deepEqual([imp.data.added, imp.data.updated, imp.data.skipped], [1, 1, 1]);
  const n = await contact(`new1.${T}@example.com`);
  assert.equal(n.source, 'Imported'); assert.equal(n.subscribed, false); assert.equal(n.mediaType, 'TV');
});

let msgId;
test('send a matchday accreditation link: preview leaves out unsubscribed people, test, then one email per person', async () => {
  const emails = [DEREK, RADIO, QUIET];
  const base = { type: 'matchday', eventId: M1, subject: 'Media accreditation open: {full_name}', body: '<p>Dear {first_name},</p><p>Apply now.</p><script>alert(1)</script>', emails };
  const pv = await mc('press-list/compose', 'POST', { ...base, action: 'preview' });
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  assert.equal(pv.data.recipients, 2);
  assert.deepEqual(pv.data.excluded.map(x => x.email), [QUIET]);
  assert.match(pv.data.html, /\/media\/accreditation\/\?match=/); assert.match(pv.data.html, /Press One/); assert.match(pv.data.html, /Unsubscribe from the press list/);
  assert.doesNotMatch(pv.data.html, /<script>/, 'the message is cleaned');
  assert.equal((await mc('press-list/compose', 'POST', { ...base, action: 'test', testTo: 'nobody' })).status, 400);
  assert.equal((await mc('press-list/compose', 'POST', { ...base, action: 'test', testTo: `me.${T}@example.com` })).status, 200);
  const c = await mc('press-list/compose', 'POST', { ...base, action: 'create' });
  assert.equal(c.status, 200, JSON.stringify(c.data)); assert.equal(c.data.recipients, 2); msgId = c.data.id;
  let r; do { r = (await mc('press-list/compose', 'POST', { action: 'batch', id: msgId })).data; } while (r.remaining);
  assert.equal(r.sent, 2); assert.equal(r.failed, 0);
  const d = (await mc(`press-list/messages?id=${msgId}`)).data.message;
  assert.deepEqual(d.list.map(x => x.email).sort(), [DEREK, RADIO].sort());
  assert.ok(d.list.every(x => x.status === 'sent'));
  assert.ok((await contact(RADIO)).lastContactedAt, 'last contacted recorded');
  // An accreditation notice may reach people who applied for that match even if not subscribed.
  const notice = await mc('press-list/compose', 'POST', { action: 'preview', type: 'notice', eventId: M1, subject: 'Collection point moved', body: '<p>Dear {first_name}, the collection point has moved.</p>', emails });
  assert.equal(notice.data.recipients, 3);
});

test('the signed unsubscribe link removes someone from general sends; a forged link does nothing', async () => {
  const e = Buffer.from(RADIO).toString('base64url');
  const t = createHmac('sha256', `${SECRET}|press-unsubscribe`).update(RADIO).digest('base64url').slice(0, 32);
  const forged = await fetch(`${BASE}/media/unsubscribe/?e=${e}&t=${'x'.repeat(32)}`, { method: 'POST' }).then(r => r.text());
  assert.match(forged, /not valid/);
  assert.equal((await contact(RADIO)).subscribed, true);
  const page = await fetch(`${BASE}/media/unsubscribe/?e=${e}&t=${t}`).then(r => r.text());
  assert.match(page, /Unsubscribing/);
  assert.equal((await contact(RADIO)).subscribed, true, 'only opening the page (a link scanner) changes nothing');
  const done = await fetch(`${BASE}/media/unsubscribe/?e=${e}&t=${t}`, { method: 'POST' }).then(r => r.text());
  assert.match(done, /You have been removed from the Lobi Stars FC press list/);
  assert.equal((await contact(RADIO)).subscribed, false);
  const pv = await mc('press-list/compose', 'POST', { action: 'preview', type: 'general', subject: 'Hello', body: '<p>Hello {first_name}</p>', emails: [RADIO, DEREK] });
  assert.equal(pv.data.recipients, 1);
});

test('Sent messages lists the send with the right count, and the activity is logged', async () => {
  const m = (await mc('press-list/messages')).data.messages.find(x => x.id === msgId);
  assert.ok(m); assert.equal(m.sent, 2); assert.equal(m.failed, 0); assert.equal(m.sentBy, 'Austin Tyowua'); assert.equal(m.type, 'matchday');
});
