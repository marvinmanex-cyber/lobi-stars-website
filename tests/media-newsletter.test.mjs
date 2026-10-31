// Media Centre, phase 4: Lobi Stars Weekly. Required sections, "No match this
// week", preview, approval -> the site's newsletter system (archive + sending
// in test mode), Wednesday scheduling, no changes after approval, the dates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { nextWeekly, weekStart } from '../functions/api/_lib/mediaDeadlines.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const T = Math.random().toString(36).slice(2, 8).replace(/\d/g, 'n');
const LOGIN = `Weekly${T}${String(Math.floor(Math.random() * 90) + 10)}`;
const admin = (p, body) => fetch(`${BASE}/api/admin/media-centre/${p}`, body ? { method: 'POST', headers: ADMIN, body: JSON.stringify(body) } : { headers: ADMIN }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
let S;
const mc = (p, method = 'GET', body) => fetch(`${BASE}/api/media-centre/${p}`, { method, headers: { Cookie: S.cookie, 'X-CSRF-Token': S.csrf, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const BASIC = { headline: `Test week ${T}`, welcome: 'Welcome to this week\'s newsletter from the Pride of Benue.', noMatch: true, training: 'A week of hard training.',
  table: { position: '3', points: '11', top: 'Kwara United, 14 points' }, squad: { injuries: 'None', returns: 'Musa is back', suspensions: 'None' },
  nextMatch: { opponent: 'Plateau United', date: 'Sunday 9 November', kickoff: '16:00', venue: 'McCarthy Stadium, Makurdi', form: 'W W D L W', expect: 'A big crowd and a tough game.', ticketLink: '/tickets/' } };

before(async () => {
  assert.equal((await admin('users', { action: 'create', loginId: LOGIN, fullName: 'Wendy Weekly', password: 'Temp-pass-123' })).status, 200);
  const r = await fetch(`${BASE}/api/media-centre/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: LOGIN, password: 'Temp-pass-123' }) });
  S = { cookie: r.headers.get('set-cookie').match(/ls_media=[^;]+/)[0], csrf: (await r.json()).csrf };
  await mc('password', 'POST', { current: 'Temp-pass-123', password: 'Own-pass-456' });
});
after(() => {
  sql(`DELETE FROM newsletter_deliveries WHERE issue_id IN (SELECT id FROM newsletter_issues WHERE subject LIKE '%Test week ${T}%'); DELETE FROM newsletter_issues WHERE subject LIKE '%Test week ${T}%';
    DELETE FROM mc_revisions WHERE item_id IN (SELECT id FROM mc_items WHERE created_by_name = 'Wendy Weekly'); DELETE FROM mc_items WHERE created_by_name = 'Wendy Weekly';
    DELETE FROM mc_settings WHERE key IN ('reminded_monday', 'reminded_tuesday'); DELETE FROM mc_sessions WHERE user_id IN (SELECT id FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}'); DELETE FROM mc_users WHERE login_key = '${LOGIN.toLowerCase()}';`);
});

test('deadline and publishing dates (Lagos time)', () => {
  const sat = Date.parse('2026-10-31T10:00:00Z');
  assert.equal(weekStart(sat), '2026-10-25T23:00:00.000Z', 'the week starts Monday 00:00 Lagos');
  assert.equal(nextWeekly('2|18:00', sat), '2026-11-03T17:00:00.000Z', 'next Tuesday 6 PM Lagos');
  assert.equal(nextWeekly('3|08:00', Date.parse(weekStart(sat)) - 1), '2026-10-28T07:00:00.000Z', "that week's Wednesday 8 AM");
});

test('required sections must be complete; "No match this week" skips 3-5', async () => {
  const id = (await mc('items', 'POST', { kind: 'newsletter', data: {} })).data.id;
  let r = await mc(`items/${id}`, 'POST', { action: 'submit' });
  assert.equal(r.status, 400); assert.match(r.data.error, /Welcome/);
  await mc(`items/${id}`, 'PUT', { data: { ...BASIC, noMatch: false } });
  r = await mc(`items/${id}`, 'POST', { action: 'submit' });
  assert.equal(r.status, 400); assert.match(r.data.error, /Last Match Report/, 'a played match needs the report');
  await mc(`items/${id}`, 'PUT', { data: { ...BASIC, table: { position: '3' } } });
  assert.match((await mc(`items/${id}`, 'POST', { action: 'submit' })).data.error, /League Table/);
  await mc(`items/${id}`, 'PUT', { data: BASIC });
  const pv = await mc('newsletter', 'POST', { data: BASIC, id });
  assert.equal(pv.data.missing, null);
  for (const s of ['Lobi Stars Weekly', 'Edition', 'Training &amp; preparation', 'League table', 'Squad update', 'Next match preview', '#WeAreLobi']) assert.ok(pv.data.html.includes(s), `preview shows ${s}`);
  assert.ok(!pv.data.html.includes('Player of the Match'), 'sections 3-5 hidden');
  const web = await mc('newsletter', 'POST', { data: BASIC, id, web: true });
  assert.equal(web.status, 200);
  assert.equal((await mc(`items/${id}`, 'POST', { action: 'submit' })).status, 200);
});

test('approved after Wednesday 8 AM: sent now through the newsletter system and listed in the archive', async () => {
  const it = (await admin('approvals')).data.items.find(i => i.kind === 'newsletter' && i.title.includes(T));
  assert.ok(it, 'in the Approval Queue');
  const r = await admin('approvals', { id: it.id, decision: 'approve' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.published, true);
  const issue = JSON.parse(sql(`SELECT * FROM newsletter_issues WHERE subject LIKE '%Test week ${T}%';`))[0].results[0];
  assert.ok(issue); assert.equal(issue.include_match, 0); assert.match(issue.subject, /^Lobi Stars Weekly #\d+: Test week/);
  assert.ok(['scheduled', 'sending', 'sent'].includes(issue.status));
  for (let i = 0; i < 5; i++) { const s = JSON.parse(sql(`SELECT status FROM newsletter_issues WHERE id = '${issue.id}';`))[0].results[0].status; if (s === 'sent') break; await fetch(`${BASE}/api/internal/newsletter-run`, { method: 'POST', headers: CRON }); }
  const done = JSON.parse(sql(`SELECT status, slug FROM newsletter_issues WHERE id = '${issue.id}';`))[0].results[0];
  assert.equal(done.status, 'sent', 'sent (test mode locally: no real emails)');
  const archive = await fetch(`${BASE}/api/newsletter/issues`).then(x => x.json());
  assert.ok(JSON.stringify(archive).includes(`Test week ${T}`), 'in the archive');
  assert.equal((await fetch(`${BASE}/newsletter/${done.slug}/`)).status, 200);
  assert.equal((await mc(`items/${it.id}`, 'PUT', { data: BASIC })).status, 409, 'no changes after approval');
});

test('approved before its Wednesday: scheduled for Wednesday 8 AM', async () => {
  const id = (await mc('items', 'POST', { kind: 'newsletter', data: { ...BASIC, headline: `Test week ${T} two` } })).data.id;
  sql(`UPDATE mc_items SET created_at = '${new Date(Date.now() + 7 * 86400e3).toISOString()}' WHERE id = '${id}';`);
  assert.equal((await mc(`items/${id}`, 'POST', { action: 'submit' })).status, 200);
  const r = await admin('approvals', { id, decision: 'approve' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.scheduled, true);
  const row = JSON.parse(sql(`SELECT status, scheduled_at FROM mc_items WHERE id = '${id}';`))[0].results[0];
  assert.equal(row.status, 'scheduled');
  const local = new Date(Date.parse(row.scheduled_at) + 3600e3);
  assert.equal(local.getUTCDay(), 3, 'a Wednesday'); assert.equal(local.getUTCHours(), 8, 'at 8 AM Lagos');
});

test('reminders: Monday to the media team when nothing is started; Tuesday evening to the Super Admins when one is waiting; once each', async () => {
  sql(`DELETE FROM mc_settings WHERE key IN ('reminded_monday', 'reminded_tuesday');`);
  // A week with nothing in it: three weeks from now.
  const monday = Date.parse(weekStart(Date.now() + 21 * 86400e3)) + 10 * 3600e3; // Monday 10:00 Lagos
  const run = at => fetch(`${BASE}/api/internal/newsletter-run?now=${new Date(at).toISOString()}`, { method: 'POST', headers: CRON }).then(x => x.json());
  assert.equal((await run(monday - 3 * 3600e3)).media.mondayReminder, undefined, 'not before 9 AM');
  assert.equal((await run(monday)).media.mondayReminder, true, 'Monday reminder');
  assert.equal((await run(monday + 60e3)).media.mondayReminder, false, 'only once a week');
  // Tuesday 18:30 Lagos of that week, with a newsletter waiting for approval.
  const id = (await mc('items', 'POST', { kind: 'newsletter', data: { ...BASIC, headline: `Test week ${T} three` } })).data.id;
  sql(`UPDATE mc_items SET status = 'submitted', created_at = '${new Date(monday + 3600e3).toISOString()}' WHERE id = '${id}';`);
  const tuesday = monday + 86400e3 + 8.5 * 3600e3;
  assert.equal((await run(tuesday - 3600e3)).media.tuesdayReminder, undefined, 'not before the deadline');
  assert.equal((await run(tuesday)).media.tuesdayReminder, true, 'Tuesday reminder to the Super Admins');
  assert.equal((await run(tuesday + 60e3)).media.tuesdayReminder, false, 'only once');
  const logged = (await admin('activity?action=reminder')).data.rows;
  assert.ok(logged.length >= 2, 'reminders are logged');
});
