// Media accreditation. The public form (home matches only, one match, closes
// 6 hours before kick-off (media officers can reopen), spam trap), the media
// team's decisions (approve with access zones 1-5 / reject / more info), the
// per-match limit, LSFC/MED numbers, match card settings, the printable card,
// "Send approval emails" (once per person), the verification page
// (APPROVED / NOT VALID / EXPIRED / NOT FOUND, no phone or email), revoke and
// restore, contacts.
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
  sql(`DELETE FROM mc_accreditations WHERE event_id IN ('${HOME}', '${AWAY}', '${SOON}'); DELETE FROM mc_contacts WHERE email LIKE '%.${T}@example.com'; DELETE FROM mc_invites WHERE event_id = '${HOME}'; DELETE FROM mc_prefill_codes WHERE email LIKE '%.${T}@example.com'; DELETE FROM mc_accr_matches WHERE event_id IN ('${HOME}', '${SOON}'); DELETE FROM events WHERE id IN ('${HOME}', '${AWAY}', '${SOON}');
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
  assert.deepEqual(d.roles, ['Journalist', 'Photographer', 'Camera / Broadcast', 'Radio', 'Digital / Social Media']);
  assert.equal(d.matches.find(m => m.id === HOME).competition, 'Nigeria National League (NNL)');
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

let accId, accNumber;
test('match settings, then approve with zones: an LSFC/MED number, the printable card and approval emails sent once', async () => {
  const st = (await mc(`accreditations/matches?event=${HOME}`)).data;
  assert.equal(st.settings.competition, 'Nigeria National League (NNL)');
  assert.equal(st.settings.venue, 'McCarthy Stadium, Makurdi');
  assert.equal(st.settings.collectionTime, '12:00');
  assert.ok((await mc('accreditations/matches')).data.matches.some(m => m.id === HOME && m.colours.main), 'home matches list with card colours');
  const list = (await mc(`accreditations?event=${HOME}`)).data;
  const r = list.requests.find(x => x.email === `ada.${T}@example.com`);
  assert.ok(r && r.photo && r.pressDoc); accId = r.id;
  assert.equal(r.category, 'P');
  assert.deepEqual(list.roleInfo.find(x => x.name === 'Photographer').zones, [1, 2, 3, 5]);
  const info = await mc(`accreditations/${accId}`, 'POST', { decision: 'info', message: 'Please send a clearer photo.' });
  assert.equal(info.status, 200);
  const token = JSON.parse(sql(`SELECT update_token FROM mc_accreditations WHERE id = '${accId}';`))[0].results[0].update_token;
  const pre = await fetch(`${BASE}/api/media/accreditation?update=${token}`).then(x => x.json());
  assert.equal(pre.update.infoRequest, 'Please send a clearer photo.');
  assert.equal((await applyNow(form({ fullName: 'Ada R.', update: token }))).status, 200);
  assert.equal((await mc(`accreditations/${accId}`, 'POST', { decision: 'approve', zones: [] })).status, 400, 'a zone is needed');
  const ap = await mc(`accreditations/${accId}`, 'POST', { decision: 'approve', zones: [1, 2, 3, 5] });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  assert.match(ap.data.number, /^LSFC\/MED\/\d{4}$/); accNumber = ap.data.number;
  assert.ok(Number(accNumber.slice(-4)) >= 20, 'numbers start at 0020');
  // The card exists straight away (HTML, 4 x 6 in) and on the print-all page.
  const card = await fetch(`${BASE}/api/media-centre/accreditations/${accId}/card`, { headers: { Cookie: S.cookie } });
  assert.equal(card.status, 200); assert.match(card.headers.get('content-type'), /text\/html/);
  const html = await card.text();
  const vt = JSON.parse(sql(`SELECT verify_token FROM mc_accreditations WHERE id = '${accId}';`))[0].results[0].verify_token;
  assert.ok(vt.length >= 40, 'a long verification token');
  for (const x of [accNumber, 'Ada R.', 'Benue Daily', 'TEST UNITED', '<svg', '4in 6in']) assert.ok(html.includes(x), `card shows ${x}`);
  const all = await fetch(`${BASE}/api/media-centre/accreditations/print?event=${HOME}`, { headers: { Cookie: S.cookie } }).then(x => x.text());
  assert.ok(all.includes(accNumber), 'print all approved cards');
  // The approving officer, then the approval emails (each person once).
  const up = new FormData(); up.append('kind', 'image'); up.append('section', 'accreditation'); up.append('file', new Blob([jpg], { type: 'image/jpeg' }), 'signature.jpg');
  const sig = await fetch(`${BASE}/api/media-centre/upload`, { method: 'POST', headers: { Cookie: S.cookie, 'X-CSRF-Token': S.csrf }, body: up }).then(x => x.json());
  assert.ok(sig.file?.id, JSON.stringify(sig));
  const save = await mc('accreditations/matches', 'POST', { action: 'settings', eventId: HOME, opponent: 'Test United', competition: 'Nigeria National League (NNL)', matchday: '3', venue: 'McCarthy Stadium, Makurdi', collectionTime: '12:00', theme: 'crest', accept: true, approverName: 'Austin Tyowua', approverTitle: 'Media Officer', approverSignatureId: sig.file.id });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  assert.equal(save.data.settings.colours.main, '#2B5A97', 'Crest Blue');
  const send = await mc('accreditations/matches', 'POST', { action: 'send_emails', eventId: HOME });
  assert.equal(send.status, 200, JSON.stringify(send.data)); assert.equal(send.data.sent, 1);
  assert.equal((await mc('accreditations/matches', 'POST', { action: 'send_emails', eventId: HOME })).data.sent, 0, 'never emailed twice');
  assert.ok((await mc(`accreditations?event=${HOME}`)).data.requests.find(x => x.id === accId).emailSentAt, 'emailed date recorded');
  assert.equal((await mc(`accreditations/${accId}`, 'POST', { action: 'resend' })).status, 200, 'resend one');
});

test('verification page: APPROVED, NOT VALID when revoked, restored with the same number, EXPIRED after the match, NOT FOUND; never the phone or email', async () => {
  const token = JSON.parse(sql(`SELECT verify_token FROM mc_accreditations WHERE id = '${accId}';`))[0].results[0].verify_token;
  const page = async (path = `/media/verify/${token}`) => { const r = await fetch(`${BASE}${path}`); assert.equal(r.headers.get('cache-control'), 'no-store'); return { status: r.status, html: await r.text(), r }; };
  let v = await page();
  assert.match(v.html, />APPROVED</); assert.match(v.html, /Ada R\./); assert.match(v.html, /Benue Daily/); assert.match(v.html, /Pitchside/);
  assert.match(v.r.headers.get('x-robots-tag'), /noindex/);
  assert.doesNotMatch(v.html, /0803|example\.com/, 'no phone or email');
  assert.equal((await fetch(`${BASE}/api/media/accreditation/photo/${token}`)).status, 200);
  assert.match((await page(`/media/accreditation/verify/${token}/`)).html, />APPROVED</, 'the earlier address still works');
  v = await page('/media/verify/nonsense-token');
  assert.equal(v.status, 404); assert.match(v.html, />NOT FOUND</);
  assert.equal((await mc(`accreditations/${accId}`, 'POST', { action: 'revoke', reason: 'Broke the media rules' })).status, 200);
  v = await page(); assert.match(v.html, />NOT VALID</); assert.doesNotMatch(v.html, /Pitchside/, 'no zones unless approved');
  assert.match(await fetch(`${BASE}/api/media-centre/accreditations/${accId}/card`, { headers: { Cookie: S.cookie } }).then(x => x.text()), /REVOKED/);
  assert.equal((await mc(`accreditations/${accId}`, 'POST', { action: 'restore' })).status, 200);
  assert.equal((await mc(`accreditations?event=${HOME}`)).data.requests.find(x => x.id === accId).number, accNumber, 'same number after restore');
  assert.match((await page()).html, />APPROVED</);
  const list = (await admin('accreditations')).data.accreditations;
  assert.ok(list.some(a => a.id === accId && a.phone === undefined), 'the admin list leaves out phone numbers');
  assert.equal((await admin('accreditations', { id: accId, reason: 'Broke the media rules' })).status, 200, 'a Super Admin can revoke');
  assert.match((await page()).html, />NOT VALID</);
  sql(`UPDATE mc_accreditations SET status = 'approved' WHERE id = '${accId}'; UPDATE events SET event_date = '${new Date(Date.now() - 2 * 86400e3).toISOString()}' WHERE id = '${HOME}';`);
  assert.match((await page()).html, />EXPIRED</);
  sql(`UPDATE events SET event_date = '${new Date(Date.now() + 10 * 86400e3).toISOString()}' WHERE id = '${HOME}';`);
});

test('the per-match limit; invitation links; contacts recognise returning journalists', async () => {
  sql(`INSERT INTO mc_settings (key, value) VALUES ('accreditation_max', '1') ON CONFLICT(key) DO UPDATE SET value = '1';`);
  assert.equal((await applyNow(form({ email: `ben.${T}@example.com`, fullName: 'Ben Writer', role: 'Journalist' }))).status, 200);
  const ben = (await mc(`accreditations?event=${HOME}`)).data.requests.find(x => x.email === `ben.${T}@example.com`);
  const full = await mc(`accreditations/${ben.id}`, 'POST', { decision: 'approve', zones: [1, 2, 4, 5] });
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
  for (const a of ['accreditation_request', 'request_info', 'accreditation_update', 'approve', 'reject', 'revoke', 'restore', 'invite', 'download_card', 'print_cards', 'card_settings', 'approval_emails']) assert.ok(acts.has(a), `logged: ${a}`);
});
