// Media Centre, phase 3: media accreditation. The public form (home matches
// only, one match, closes 6 hours before kick-off (media officers can reopen), spam trap), the media
// team's decisions (approve with zone / reject / more info), the per-match
// limit, the card PDF ("Signed: <approver>"), the verification page
// (VALID / REVOKED / EXPIRED, no phone or email), revoke, contacts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from './media-helpers.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const T = uid().replace(/\d/g, 'y');
const LOGIN = `Accred${T}${String(Math.floor(Math.random() * 90) + 10)}`;
const HOME = `acc-home-${T}`, AWAY = `acc-away-${T}`, SOON = `acc-soon-${T}`;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const admin = (p, body) => fetch(`${BASE}/api/admin/media-centre/${p}`, body ? { method: 'POST', headers: ADMIN, body: JSON.stringify(body) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
let S, FT = '';
const mc = (p, method = 'GET', body) => fetch(`${BASE}/api/media-centre/${p}`, { method, headers: { Cookie: S.cookie, 'X-CSRF-Token': S.csrf, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})), r }));
const jpg = readFileSync(new URL('../public/images/lobi-stars-badge-print.jpg', import.meta.url));
const pdf = Buffer.from('%PDF-1.4\n% test press letter\n' + 'x'.repeat(300));
function form(over = {}, files = { photo: true, doc: true }) {
  const f = new FormData();
  const v = { eventId: HOME, fullName: 'Ada Reporter', phone: '0803 123 4567', email: `ada.${T}@example.com`, organisation: 'Benue Daily', employment: 'staff', role: 'Photographer', equipment: '2 cameras', agree: '1', website: '', ...over };
  for (const [k, x] of Object.entries(v)) f.append(k, x);
  if (!('formToken' in over)) f.append('formToken', FT);
  if (files.photo) f.append('photo', new Blob([jpg], { type: 'image/jpeg' }), 'passport.jpg');
  if (files.doc) f.append('pressDoc', new Blob([pdf], { type: 'application/pdf' }), 'letter.pdf');
  return f;
}
const applyNow = (f, from = ip()) => fetch(`${BASE}/api/media/accreditation`, { method: 'POST', body: f, headers: { 'CF-Connecting-IP': from } }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));

before(async () => {
  const d = days => new Date(Date.now() + days * 86400e3).toISOString();
  sql(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES
    ('${HOME}', 'Lobi Stars FC', 'Test United ${T}', 'NNL', '${d(10)}', 'McCarthy Stadium, Makurdi', 50000, 20000, 10000, 1),
    ('${AWAY}', 'Away City ${T}', 'Lobi Stars FC', 'NNL', '${d(12)}', 'Away Ground', 0, 0, 0, 1),
    ('${SOON}', 'Lobi Stars FC', 'Soon Rovers ${T}', 'NNL', '${new Date(Date.now() + 3 * 3600e3).toISOString()}', 'McCarthy Stadium, Makurdi', 50000, 20000, 10000, 1);`);
  assert.equal((await admin('users', { action: 'create', loginId: LOGIN, fullName: 'Grace Approver', password: 'Temp-pass-123' })).status, 200);
  FT = (await fetch(`${BASE}/api/media/accreditation`).then(x => x.json())).formToken;
  await new Promise(r => setTimeout(r, 3200)); // forms sent within 3 seconds of loading are refused
  const r = await fetch(`${BASE}/api/media-centre/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: LOGIN, password: 'Temp-pass-123' }) });
  S = { cookie: r.headers.get('set-cookie').match(/ls_media=[^;]+/)[0], csrf: (await r.json()).csrf };
  await mc('password', 'POST', { current: 'Temp-pass-123', password: 'Own-pass-456' });
});
after(() => {
  sql(`DELETE FROM mc_accreditations WHERE event_id IN ('${HOME}', '${AWAY}', '${SOON}'); DELETE FROM mc_contacts WHERE email LIKE '%.${T}@example.com'; DELETE FROM mc_invites WHERE event_id = '${HOME}'; DELETE FROM mc_prefill_codes WHERE email LIKE '%.${T}@example.com'; DELETE FROM events WHERE id IN ('${HOME}', '${AWAY}', '${SOON}');
    DELETE FROM mc_files WHERE owner = 'accreditation' AND uploaded_by_name IN ('Ada Reporter', 'Ben Writer', 'Ada R.'); DELETE FROM mc_sessions WHERE user_id IN (SELECT id FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}'); DELETE FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}';
    DELETE FROM mc_settings WHERE key = 'accreditation_max' OR key = 'accr_open:${SOON}';`);
});

test('the form lists upcoming HOME matches only, closes 6 hours before kick-off, and a media officer can reopen a match', async () => {
  const d = await fetch(`${BASE}/api/media/accreditation?match=${HOME}`).then(r => r.json());
  assert.ok(d.matches.some(m => m.id === HOME && m.open));
  assert.ok(!d.matches.some(m => m.id === AWAY), 'away matches are not offered');
  assert.equal(d.matches.find(m => m.id === SOON).open, false, 'closed within 6 hours');
  assert.equal(d.closeHours, 6);
  assert.equal(d.selected, HOME, 'the invitation / match link preselects the match');
  assert.deepEqual(d.roles, ['Writer', 'Photographer', 'TV Camera', 'Radio Commentator', 'Digital/Social Media']);
  assert.equal((await applyNow(form({ eventId: AWAY }))).status, 400);
  assert.equal((await applyNow(form({ eventId: SOON }))).status, 400);
  // Reopened from the Media Centre: open again until kick-off; closed again.
  assert.equal((await mc('accreditations', 'POST', { action: 'reopen', eventId: SOON, open: true })).status, 200);
  let m = (await mc('accreditations')).data.matches.find(x => x.id === SOON);
  assert.equal(m.open, true); assert.equal(m.reopened, true);
  assert.equal((await fetch(`${BASE}/api/media/accreditation`).then(r => r.json())).matches.find(x => x.id === SOON).open, true, 'open on the public form');
  assert.equal((await mc('accreditations', 'POST', { action: 'reopen', eventId: SOON, open: false })).status, 200);
  m = (await mc('accreditations')).data.matches.find(x => x.id === SOON);
  assert.equal(m.open, false);
});

test('checks, spam trap and one request per match', async () => {
  assert.equal((await applyNow(form({ formToken: 'forged.token.value' }))).status, 400, 'a valid form token is needed');
  const quick = (await fetch(`${BASE}/api/media/accreditation`).then(x => x.json())).formToken;
  assert.match((await applyNow(form({ formToken: quick }))).data.error, /very quick/, 'sent too fast after loading');
  assert.equal((await applyNow(form({ agree: '' }))).status, 400, 'must agree to the media rules');
  assert.equal((await applyNow(form({}, { photo: false, doc: true }))).status, 400, 'passport photo needed');
  assert.equal((await applyNow(form({}, { photo: true, doc: false }))).status, 400, 'press ID needed');
  const trap = await applyNow(form({ website: 'http://spam' }));
  assert.equal(trap.status, 200, 'looks accepted');
  assert.equal(JSON.parse(sql(`SELECT COUNT(*) AS n FROM mc_accreditations WHERE event_id = '${HOME}';`))[0].results[0].n, 0, 'but nothing saved');
  const ok = await applyNow(form());
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await applyNow(form())).status, 400, 'one request per match');
});

let accId;
test('more information, then approve with the zone; the card is signed by the approving user', async () => {
  const list = (await mc(`accreditations?event=${HOME}`)).data;
  const r = list.requests.find(x => x.email === `ada.${T}@example.com`);
  assert.ok(r && r.photo && r.pressDoc); accId = r.id;
  const info = await mc(`accreditations/${accId}`, 'POST', { decision: 'info', message: 'Please send a clearer photo.' });
  assert.equal(info.status, 200);
  const token = JSON.parse(sql(`SELECT update_token FROM mc_accreditations WHERE id = '${accId}';`))[0].results[0].update_token;
  const pre = await fetch(`${BASE}/api/media/accreditation?update=${token}`).then(x => x.json());
  assert.equal(pre.update.infoRequest, 'Please send a clearer photo.');
  const up = form({ fullName: 'Ada R.', update: token });
  assert.equal((await applyNow(up)).status, 200);
  assert.equal((await mc(`accreditations/${accId}`, 'POST', { decision: 'approve' })).status, 400, 'zone required');
  const ap = await mc(`accreditations/${accId}`, 'POST', { decision: 'approve', zone: 'Pitchside' });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  assert.match(ap.data.number, /^LSA-\d{4}-\d{4}$/);
  const card = await fetch(`${BASE}/api/media-centre/accreditations/${accId}/card`, { headers: { Cookie: S.cookie } });
  assert.equal(card.status, 200); assert.equal(card.headers.get('content-type'), 'application/pdf');
  const text = Buffer.from(await card.arrayBuffer()).toString('latin1');
  for (const s of ['MEDIA ACCREDITATION', 'LOBI STARS FC', 'Signed: Grace Approver', 'Valid for this match only', 'McCarthy Stadium', 'PITCHSIDE', ap.data.number, 'Photographer', 'Benue Daily', 'Test United']) assert.ok(text.includes(s), `card shows ${s}`);
  // The approval letter (emailed; printed and brought to the media desk for the laminated card).
  const letter = await fetch(`${BASE}/api/media-centre/accreditations/${accId}/letter`, { headers: { Cookie: S.cookie } });
  assert.equal(letter.status, 200); assert.equal(letter.headers.get('content-type'), 'application/pdf');
  const lt = Buffer.from(await letter.arrayBuffer()).toString('latin1');
  for (const s of ['APPROVAL LETTER', 'Media Desk', 'laminated accreditation card', ap.data.number, 'Pitchside']) assert.ok(lt.includes(s), `letter shows ${s}`);
  assert.ok((text.match(/\/Subtype \/Image/g) || []).length >= 2, 'badge and photo');
});

test('verification page: VALID, then REVOKED by a Super Admin, and EXPIRED after the match; never the phone or email', async () => {
  const token = JSON.parse(sql(`SELECT verify_token FROM mc_accreditations WHERE id = '${accId}';`))[0].results[0].verify_token;
  let html = await fetch(`${BASE}/media/accreditation/verify/${token}/`).then(r => r.text());
  assert.match(html, />VALID</); assert.match(html, /Ada R\./); assert.match(html, /Benue Daily/);
  assert.doesNotMatch(html, /0803|example\.com/, 'no phone or email');
  assert.equal((await fetch(`${BASE}/api/media/accreditation/photo/${token}`)).status, 200);
  assert.equal((await fetch(`${BASE}/media/accreditation/verify/nonsense-token/`)).status, 404);
  const list = (await admin('accreditations')).data.accreditations;
  assert.ok(list.some(a => a.id === accId && a.phone === undefined), 'the admin list leaves out phone numbers');
  assert.equal((await admin('accreditations', { id: accId, reason: 'Broke the media rules' })).status, 200);
  html = await fetch(`${BASE}/media/accreditation/verify/${token}/`).then(r => r.text());
  assert.match(html, />REVOKED</); assert.match(html, /Broke the media rules/);
  sql(`UPDATE mc_accreditations SET status = 'approved' WHERE id = '${accId}'; UPDATE events SET event_date = '${new Date(Date.now() - 2 * 86400e3).toISOString()}' WHERE id = '${HOME}';`);
  html = await fetch(`${BASE}/media/accreditation/verify/${token}/`).then(r => r.text());
  assert.match(html, />EXPIRED</);
  sql(`UPDATE events SET event_date = '${new Date(Date.now() + 10 * 86400e3).toISOString()}' WHERE id = '${HOME}';`);
});

test('the per-match limit; invitation links; contacts recognise returning journalists', async () => {
  sql(`INSERT INTO mc_settings (key, value) VALUES ('accreditation_max', '1') ON CONFLICT(key) DO UPDATE SET value = '1';`);
  assert.equal((await applyNow(form({ email: `ben.${T}@example.com`, fullName: 'Ben Writer', role: 'Writer' }))).status, 200);
  const ben = (await mc(`accreditations?event=${HOME}`)).data.requests.find(x => x.email === `ben.${T}@example.com`);
  const full = await mc(`accreditations/${ben.id}`, 'POST', { decision: 'approve', zone: 'Press Box' });
  assert.equal(full.status, 400); assert.match(full.data.error, /limit is 1/);
  assert.equal((await mc(`accreditations/${ben.id}`, 'POST', { decision: 'reject', reason: '' })).status, 400, 'a reason is needed');
  assert.equal((await mc(`accreditations/${ben.id}`, 'POST', { decision: 'reject', reason: 'The press box is full.' })).status, 200);
  const inv = await mc('accreditations', 'POST', { action: 'invite', eventId: HOME });
  assert.equal(inv.status, 200); assert.match(inv.data.link, /\/media\/accreditation\/\?match=.+&invite=/);
  const pp = b => fetch(`${BASE}/api/media/accreditation/prefill`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.7.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}` }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, data: await r.json() }));
  const known = await pp({ email: `ada.${T}@example.com` }), unknown = await pp({ email: `nobody.${T}@example.com` });
  assert.equal(known.data.message, unknown.data.message, 'asking for a code never reveals whether the email is known');
  assert.equal(known.data.fullName, undefined, 'no details without the code');
  assert.equal((await pp({ email: `ada.${T}@example.com`, code: '000000' })).status, 400, 'wrong code');
  const { createHash } = await import('node:crypto');
  sql(`UPDATE mc_prefill_codes SET code_hash = '${createHash('sha256').update(`ada.${T}@example.com|123456`).digest('hex')}', tries = 0 WHERE email = 'ada.${T}@example.com';`);
  const pre = (await pp({ email: `ada.${T}@example.com`, code: '123456' })).data;
  assert.equal(pre.known, true); assert.equal(pre.organisation, 'Benue Daily'); assert.equal(pre.hasPhoto, true);
  assert.equal(pre.phone, undefined, 'never the phone');
  assert.equal((await pp({ email: `ada.${T}@example.com`, code: '123456' })).status, 400, 'a code works once');
  const c = (await mc('accreditations?view=contacts')).data.contacts.find(x => x.email === `ada.${T}@example.com`);
  assert.ok(c && c.accreditations >= 1);
  const acts = new Set((await admin('activity?section=accreditation')).data.rows.map(r => r.action));
  for (const a of ['accreditation_request', 'request_info', 'accreditation_update', 'approve', 'reject', 'revoke', 'invite', 'download_card']) assert.ok(acts.has(a), `logged: ${a}`);
});
