// Staff account management (Phase 2 of the staff access plan): invites (the
// person chooses their own password), "Forgot password?", the leaver process,
// role changes, the monthly access review, the role email directory, the
// content CMS showing each role only its sections, the emergency (break-glass)
// admin code, the emailed sign-in code, and the per-part checks on Live Match
// Control, match settings, the newsletter and Predict & Win.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, FANS_DEV_LINKS=1,
// STAFF_TEST_PASSWORDS=1, PASSWORD_BREACH_CHECK=off, CRON_SECRET=cron-test-secret. Edits the LOCAL D1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { totpCode } from '../functions/api/_lib/totp.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const CODE = process.env.ADMIN_CODE || 'test-code-123';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': CODE };
const PW = 'Role-Test-2026!';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const localSql = sql => execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) }));
const sessionOf = r => ((r.headers.getSetCookie?.() || []).find(c => c.startsWith('ls_admin=')) || '').split(';')[0];
async function login(body) {
  const r = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: sessionOf(r) };
}
const as = cookie => ({ Cookie: cookie });
const made = [];
// These tests check the direct path; approvals (tests/approvals.test.mjs) are switched off here.
before(async () => { await api('/api/admin/approvals', 'POST', { switch: 'approvals_staff', on: false }); });
after(async () => { for (const id of made) await api(`/api/admin/staff/${id}`, 'PUT', { active: false, reason: 'test finished' }); });
async function invite(role, extra = {}) {
  const email = `inv-${role}-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: `Ada ${uid()} Okafor`, email, role, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  made.push(r.data.id);
  return { id: r.data.id, email, url: r.data.inviteUrl, t: new URL(r.data.inviteUrl).searchParams.get('t') };
}
async function ready(role) {
  const email = `ready-${role}-${uid()}@example.com`;
  const r = await api('/api/admin/staff', 'POST', { name: `Ready ${role}`, email, role, password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  made.push(r.data.id);
  const l = await login({ email, password: PW });
  assert.equal(l.status, 200);
  return { id: r.data.id, email, cookie: l.cookie };
}
const row = async id => (await api('/api/admin/staff')).data.staff.find(s => s.id === id);

test('invite: the person gets a one-time link, chooses their own password, is signed in and sets up two-step login', async () => {
  const i = await invite('fan_support', { roleEmail: 'fans@lobistarsfc.com' });
  assert.match(i.url, /\/admin\/invite\/\?t=[a-f0-9]{64}$/);
  let s = await row(i.id);
  assert.equal(s.status, 'pending'); assert.equal(s.role_email, 'fans@lobistarsfc.com'); assert.equal(s.invite_kind, 'invite');
  assert.equal((await login({ email: i.email, password: PW })).status, 401, 'cannot sign in before accepting');
  const info = await api(`/api/admin/invite?t=${i.t}`, 'GET', null, {});
  assert.equal(info.status, 200); assert.equal(info.data.kind, 'invite'); assert.equal(info.data.role, 'Fan Support');
  assert.equal((await fetch(`${BASE}/admin/invite/?t=${i.t}`, { redirect: 'manual' })).status, 200, 'the page opens without signing in');
  assert.equal((await api('/api/admin/invite', 'POST', { t: i.t, password: 'short' }, {})).status, 400);
  const ok = await api('/api/admin/invite', 'POST', { t: i.t, password: 'Brand-New-Password-26' }, {});
  assert.equal(ok.status, 200); assert.equal(ok.data.signedIn, true);
  const cookie = sessionOf(ok);
  assert.ok(cookie, 'signed in');
  const start = await api('/api/admin/account', 'POST', { action: 'start_2fa' }, as(cookie));
  assert.equal(start.status, 200);
  const on = await api('/api/admin/account', 'POST', { action: 'confirm_2fa', otp: await totpCode(start.data.secret.replace(/\s/g, ''), Math.floor(Date.now() / 30000)) }, as(cookie));
  assert.equal(on.status, 200); assert.equal(on.data.backupCodes.length, 10);
  s = await row(i.id);
  assert.equal(s.status, 'active'); assert.equal(s.totp_enabled, 1);
  assert.equal((await api('/api/admin/invite', 'POST', { t: i.t, password: 'Another-Password-26' }, {})).status, 410, 'the link works once');
  assert.equal((await api(`/api/admin/invite?t=${i.t}`, 'GET', null, {})).status, 410);
  // The admin API no longer takes a password from the Super Admin (outside the test server it is ignored).
  assert.ok((await api('/api/admin/activity')).data.log.some(l => l.action === 'staff_invited' && l.detail.includes(i.email)));
});

test('expired invites stop working; "Resend invite" makes a new link and the old one stops', async () => {
  const i = await invite('media_editor');
  localSql(`UPDATE admin_users SET invite_expires = ${Date.now() - 1000} WHERE id = '${i.id}'`);
  assert.equal((await api(`/api/admin/invite?t=${i.t}`, 'GET', null, {})).status, 410);
  assert.equal((await row(i.id)).inviteExpired, true);
  const again = await api(`/api/admin/staff/${i.id}`, 'PUT', { resendInvite: true });
  assert.equal(again.status, 200);
  const t2 = new URL(again.data.inviteUrl).searchParams.get('t');
  assert.notEqual(t2, i.t);
  assert.equal((await api(`/api/admin/invite?t=${i.t}`, 'GET', null, {})).status, 410);
  assert.equal((await api(`/api/admin/invite?t=${t2}`, 'GET', null, {})).status, 200);
});

test('forgot password: the same answer for any address; the reset link signs out every device', async () => {
  const s = await ready('fan_support');
  const none = await api('/api/admin/invite', 'POST', { action: 'forgot', email: `nobody-${uid()}@example.com` }, { 'CF-Connecting-IP': randIp() });
  const yes = await api('/api/admin/invite', 'POST', { action: 'forgot', email: s.email }, { 'CF-Connecting-IP': randIp() });
  assert.equal(none.status, 200); assert.equal(yes.status, 200);
  assert.equal(none.data.message, yes.data.message, 'no hint whether the address has an account');
  assert.equal(none.data.resetUrl, undefined);
  const t = new URL(yes.data.resetUrl).searchParams.get('t');
  assert.equal((await api(`/api/admin/invite?t=${t}`, 'GET', null, {})).data.kind, 'reset');
  const r = await api('/api/admin/invite', 'POST', { t, password: 'Reset-Password-2026' }, {});
  assert.equal(r.status, 200); assert.equal(r.data.signedIn, false, 'they sign in as usual (with two-step login)');
  assert.equal((await api('/api/admin/me', 'GET', null, as(s.cookie))).status, 401, 'old sessions ended');
  assert.equal((await login({ email: s.email, password: PW })).status, 401);
  assert.equal((await login({ email: s.email, password: 'Reset-Password-2026' })).status, 200);
});

test('leaver: disabled with a reason, signed out everywhere, kept (never deleted) with who and why; re-enable sends a link', async () => {
  const s = await ready('crm_manager');
  assert.equal((await api(`/api/admin/staff/${s.id}`, 'PUT', { active: false })).status, 400, 'a reason is needed');
  const d = await api(`/api/admin/staff/${s.id}`, 'PUT', { active: false, reason: 'Left the club' });
  assert.equal(d.status, 200); assert.equal(d.data.signedOut, 1);
  assert.equal((await api('/api/admin/me', 'GET', null, as(s.cookie))).status, 401, 'signed out at once');
  assert.equal((await login({ email: s.email, password: PW })).status, 401);
  const r = await row(s.id);
  assert.equal(r.status, 'disabled'); assert.equal(r.disabled_reason, 'Left the club'); assert.ok(r.disabled_by && r.disabled_at);
  assert.ok((await api('/api/admin/activity')).data.log.some(l => l.action === 'staff_disabled' && l.detail.includes('Left the club')));
  const back = await api(`/api/admin/staff/${s.id}`, 'PUT', { active: true });
  assert.equal(back.status, 200); assert.match(back.data.link, /\/admin\/invite\/\?t=/);
  assert.equal((await row(s.id)).status, 'active');
  // A Super Admin can't disable themselves or change their own role.
  const sa = await ready('super_admin');
  assert.equal((await api(`/api/admin/staff/${sa.id}`, 'PUT', { active: false, reason: 'x' }, as(sa.cookie))).status, 400);
  assert.equal((await api(`/api/admin/staff/${sa.id}`, 'PUT', { role: 'fan_support' }, as(sa.cookie))).status, 400);
});

test('role change: Super Admin only, recorded; the monthly access review flags unused accounts and records Keep', async () => {
  const s = await ready('fan_support');
  assert.equal((await api(`/api/admin/staff/${s.id}`, 'PUT', { role: 'crm_manager' }, as(s.cookie))).status, 403, 'not their own decision');
  assert.equal((await api(`/api/admin/staff/${s.id}`, 'PUT', { role: 'crm_manager' })).status, 200);
  assert.ok((await api('/api/admin/activity')).data.log.some(l => l.action === 'role_assigned' && /Fan Support -> CRM Manager/.test(l.detail)));
  localSql(`UPDATE admin_users SET last_login_at = '2026-01-01 10:00:00' WHERE id = '${s.id}'`);
  localSql(`UPDATE admin_sessions SET last_seen = ${Date.now() - 40 * 864e5} WHERE user_id = '${s.id}'`);
  let p = (await api('/api/admin/staff')).data.review.people.find(x => x.id === s.id);
  assert.equal(p.unused, true); assert.ok(p.idleDays >= 30);
  assert.equal((await api(`/api/admin/staff/${s.id}`, 'PUT', { keep: true })).status, 200);
  p = (await api('/api/admin/staff')).data.review.people.find(x => x.id === s.id);
  assert.ok(p.reviewedAt);
  const sent = await api('/api/admin/staff', 'POST', { action: 'send_review' });
  assert.equal(sent.status, 200); assert.ok(sent.data.accounts >= 1);
  assert.ok((await api('/api/admin/activity')).data.log.some(l => l.action === 'access_review_sent'));
  // The timer Worker's call: needs the secret; only sends on the 1st of the month.
  assert.equal((await api('/api/internal/access-review', 'POST', {}, {})).status, 403);
  const auto = await api('/api/internal/access-review', 'POST', {}, { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` });
  assert.equal(auto.status, 200);
  if (new Date(Date.now() + 3600e3).getUTCDate() !== 1) assert.equal(auto.data.sent, false);
});

test('role email directory: listed for Super Admins; pages show a team address only once its mailbox is ready', async () => {
  const d = (await api('/api/admin/staff')).data;
  const keys = d.roleEmails.map(r => r.key);
  for (const k of ['media', 'news', 'social', 'design', 'web', 'broadcast', 'fans', 'info', 'partnerships', 'tickets']) assert.ok(keys.includes(k), k);
  const contact = await (await fetch(`${BASE}/contact/`)).text();
  assert.match(contact, /media@lobistarsfc\.com/, 'media@ is ready');
  assert.doesNotMatch(contact, /tickets@lobistarsfc\.com/, 'not shown until ready');
  const partners = await (await fetch(`${BASE}/partners/`)).text();
  assert.match(partners, /Or email <a href="mailto:info@lobistarsfc\.com"/, 'partnerships@ not ready: info@ shown');
});

test('content CMS: each role sees only its sections; helpers and broadcast get no CMS', async () => {
  const mc = await ready('media_contributor');
  const yml = await (await fetch(`${BASE}/admin/config.yml`, { headers: as(mc.cookie) })).text();
  const tops = [...yml.matchAll(/^ {2}- name: "?(\w+)/gm)].map(m => m[1]);
  assert.deepEqual(tops, ['gallery', 'heroSlides', 'partners']);
  assert.match(yml, /^backend:/m, 'still a full config');
  const cm = await ready('commercial_manager');
  const files = [...(await (await fetch(`${BASE}/admin/config.yml`, { headers: as(cm.cookie) })).text()).matchAll(/^ {6}- name: "?(\w+)/gm)].map(m => m[1]);
  assert.deepEqual(files.sort(), ['hospitality', 'partnership', 'shop']);
  const bo = await ready('broadcast_operator');
  assert.equal((await fetch(`${BASE}/admin/config.yml`, { headers: as(bo.cookie), redirect: 'manual' })).status, 403);
  const o = await login({ code: CODE });
  const full = await (await fetch(`${BASE}/admin/config.yml`, { headers: as(o.cookie) })).text();
  assert.ok([...full.matchAll(/^ {2}- name:/gm)].length >= 7, 'Super Admin sees everything');
});

test('emergency (break-glass) admin code: every use is marked in the Activity Log', async () => {
  assert.equal((await login({ code: CODE })).status, 200);
  const log = (await api('/api/admin/activity')).data.log.filter(l => l.action === 'owner_code_login');
  assert.ok(log.length && log.every(l => l.emergency), 'highlighted');
});

test('two-step login fallback: a 6-digit code by email works once', async () => {
  const s = await ready('fan_support');
  const start = await api('/api/admin/account', 'POST', { action: 'start_2fa' }, as(s.cookie));
  await api('/api/admin/account', 'POST', { action: 'confirm_2fa', otp: await totpCode(start.data.secret.replace(/\s/g, ''), Math.floor(Date.now() / 30000)) }, as(s.cookie));
  const ask = await login({ email: s.email, password: PW, emailCode: true });
  assert.equal(ask.status, 401); assert.equal(ask.data.emailed, true); assert.match(ask.data.devCode, /^\d{6}$/);
  assert.equal((await login({ email: s.email, password: 'Wrong-Password-99', emailCode: true })).status, 401, 'needs the right password first');
  const ok = await login({ email: s.email, password: PW, otp: ask.data.devCode });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await login({ email: s.email, password: PW, otp: ask.data.devCode })).status, 401, 'works once');
  // Generic messages: an unknown address gets the same answer as a wrong password.
  const a = await login({ email: `nobody-${uid()}@example.com`, password: PW });
  const b = await login({ email: s.email, password: 'Wrong-Password-99' });
  assert.equal(a.data.error, 'Email or password is incorrect.'); assert.equal(a.data.error, b.data.error);
});

test('per-part checks: Live Match Control, match settings, newsletter sending and Predict & Win', async () => {
  const ev = await api('/api/admin/events', 'POST', { home_team: 'Lobi Stars FC', away_team: `Part Test ${uid()}`, venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 86400e3 * 12).toISOString(), vip_price_kobo: 30000, premium_price_kobo: 20000, regular_price_kobo: 10000, active: false });
  assert.equal(ev.status, 200, JSON.stringify(ev.data));
  const id = ev.data.id;
  // The Broadcast Operator saves the stream link; the score can't be changed by them.
  const bo = await ready('broadcast_operator');
  const put = await api(`/api/admin/match-centre/${id}`, 'PUT', { status: 'live', home_score: 5, away_score: 0, youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, as(bo.cookie));
  assert.equal(put.status, 200, JSON.stringify(put.data));
  let m = (await api(`/api/admin/match-centre/${id}`)).data.match;
  assert.equal(m.status, 'scheduled'); assert.notEqual(m.home_score, 5);
  assert.match(m.youtube_url, /dQw4w9WgXcQ/);
  assert.equal((await api(`/api/admin/match-centre/${id}`, 'POST', { action: 'kickoff' }, as(bo.cookie))).status, 403, 'only Live Match Control starts the match');
  // Match settings: the Ops Manager changes ticket prices but not the teams; the Broadcast Operator only commentary.
  const ops = await ready('matchday_ops_manager');
  const cur = (await api('/api/admin/events')).data.events?.find?.(e => e.id === id) || {};
  const base = { home_team: 'Lobi Stars FC', away_team: cur.away_team || 'X', venue: 'McCarthy Stadium, Makurdi', event_date: new Date(Date.now() + 86400e3 * 12).toISOString(), vip_price_kobo: 30000, premium_price_kobo: 20000, regular_price_kobo: 10000, active: false };
  assert.equal((await api(`/api/admin/events/${id}`, 'PUT', { ...base, away_team: 'Renamed FC', regular_price_kobo: 15000 }, as(ops.cookie))).status, 200);
  const after1 = (await api('/api/admin/events')).data;
  const e1 = (after1.events || after1).find(e => e.id === id);
  assert.equal(e1.regular_price_kobo, 15000, 'price changed'); assert.notEqual(e1.away_team, 'Renamed FC', 'teams kept');
  assert.equal((await api(`/api/admin/events/${id}`, 'DELETE', null, as(ops.cookie))).status, 403);
  // Newsletter: writers can't send to subscribers.
  const ce = await ready('content_editor');
  const nl = await api('/api/admin/newsletter', 'POST', { action: 'save_issue', issue: { subject: `Writers ${uid()}`, headline: 'x', intro: 'x', include_match: false, stories: [], sponsor_ids: [] } }, as(ce.cookie));
  assert.equal(nl.status, 200, JSON.stringify(nl.data));
  assert.equal((await api('/api/admin/newsletter/send', 'POST', { id: nl.data.id, confirm: true }, as(ce.cookie))).status, 403);
  // Predict & Win: Fan Support marks prizes paid, but doesn't manage entries.
  const fs = await ready('fan_support');
  assert.equal((await api(`/api/admin/predictions/${id}`, 'POST', { action: 'disqualify', predictionId: 1 }, as(fs.cookie))).status, 403);
  assert.notEqual((await api(`/api/admin/predictions/${id}`, 'POST', { action: 'paid' }, as(fs.cookie))).status, 403);
  await api(`/api/admin/events/${id}`, 'DELETE');
});
