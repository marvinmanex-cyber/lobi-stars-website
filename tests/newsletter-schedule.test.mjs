// Newsletter scheduling: schedule (5 minutes to 60 days ahead), change the
// time, edit while scheduled, cancel; at the time the scheduler sends it to
// every subscriber once (timer Worker endpoint, or site traffic); "Send now"
// on a scheduled newsletter cancels the schedule.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123, FANS_DEV_LINKS=1
// and CRON_SECRET=cron-test-secret. Edits the LOCAL D1 database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const post = (path, body, headers = ADMIN) => fetch(BASE + path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = path => fetch(BASE + path, { headers: ADMIN }).then(r => r.json());
const nl = body => post('/api/admin/newsletter', body);
const send = body => post('/api/admin/newsletter/send', body);
const localSql = sql => execSync(`npx wrangler d1 execute lobi-stars-tickets --local --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
const run = () => post('/api/internal/newsletter-run', {}, { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` });

async function draft(subject) {
  const r = await nl({ action: 'save_issue', issue: { subject, headline: 'Schedule test', intro: 'Hello', include_match: false, stories: [], sponsor_ids: [] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
}
const issue = async id => (await nl({ action: 'get_issue', id })).data.issue;

test('schedule: limits, change the time, edit while scheduled, cancel', async () => {
  const id = await draft(`Scheduled ${uid()}`);
  assert.equal((await send({ id, schedule: new Date(Date.now() + 60000).toISOString() })).status, 400, 'at least 5 minutes ahead');
  assert.equal((await send({ id, schedule: new Date(Date.now() + 61 * 864e5).toISOString() })).status, 400, 'within 60 days');
  const at = new Date(Date.now() + 3600e3).toISOString();
  const r = await send({ id, schedule: at });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let i = await issue(id);
  assert.equal(i.status, 'scheduled'); assert.equal(i.scheduled_at, at); assert.ok(i.scheduled_by);
  const later = new Date(Date.now() + 2 * 3600e3).toISOString();
  await send({ id, schedule: later });
  assert.equal((await issue(id)).scheduled_at, later, 'time changed');
  const ed = await nl({ action: 'save_issue', issue: { ...i, id, headline: 'Edited while scheduled' } });
  assert.equal(ed.status, 200, 'can still edit');
  i = await issue(id);
  assert.equal(i.headline, 'Edited while scheduled'); assert.equal(i.status, 'scheduled');
  const row = (await get('/api/admin/newsletter')).issues.find(x => x.id === id);
  assert.equal(row.status, 'scheduled'); assert.equal(row.scheduled_at, later);
  assert.equal((await send({ id, unschedule: true })).status, 200);
  i = await issue(id);
  assert.equal(i.status, 'draft'); assert.equal(i.scheduled_at, null);
  assert.equal((await run()).data.checked, 0, 'nothing due');
});

test('at the time, the scheduler sends it to every subscriber once', async () => {
  for (let k = 0; k < 2; k++) {
    const email = `sched-${uid()}@example.com`;
    assert.equal((await post('/api/newsletter', { fullName: 'Sched Reader', phone: `0803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, email, confirmEmail: email, consent: true, weekly: true, source: 'test' }, { 'CF-Connecting-IP': randIp() })).status, 200);
  }
  const recipients = (await get('/api/admin/newsletter')).counts.recipients;
  const id = await draft(`Due ${uid()}`);
  assert.equal((await send({ id, schedule: new Date(Date.now() + 3600e3).toISOString() })).status, 200);
  assert.equal((await run()).data.checked, 0, 'not yet');
  localSql(`UPDATE newsletter_issues SET scheduled_at = '${new Date(Date.now() - 60000).toISOString()}' WHERE id = '${id}'`);
  let r;
  for (let n = 0; n < 20; n++) { r = (await run()).data; const st = (await issue(id)).status; if (st === 'sent') break; }
  const i = await issue(id);
  assert.equal(i.status, 'sent', JSON.stringify(r));
  assert.ok(i.slug, 'has its web version');
  const row = (await get('/api/admin/newsletter')).issues.find(x => x.id === id);
  assert.equal(row.sent_count, recipients, 'every subscriber once');
  assert.match(row.sent_by, /scheduled/i);
  await run();
  assert.equal((await get('/api/admin/newsletter')).issues.find(x => x.id === id).sent_count, recipients, 'not sent twice');
  assert.equal((await send({ id, schedule: new Date(Date.now() + 3600e3).toISOString() })).status, 409, 'already sent');
});

test('"Send now" on a scheduled newsletter cancels the schedule and sends it', async () => {
  const id = await draft(`Now ${uid()}`);
  await send({ id, schedule: new Date(Date.now() + 3600e3).toISOString() });
  let r;
  do { r = await send({ id, confirm: true }); assert.equal(r.status, 200, JSON.stringify(r.data)); } while (r.data.remaining > 0);
  const i = await issue(id);
  assert.equal(i.status, 'sent'); assert.equal(i.scheduled_at, null);
  assert.equal((await post('/api/internal/newsletter-run', {}, { Authorization: 'Bearer wrong' })).status, 401);
});

test('"Selected people only": the subscriber list, sending to chosen people only (they still need consent)', async () => {
  const tag = uid();
  const emails = [0, 1, 2].map(k => `pick-${tag}-${k}@example.com`);
  for (const email of emails) {
    assert.equal((await post('/api/newsletter', { fullName: `Pick ${tag}`, phone: `0803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, email, confirmEmail: email, consent: true, weekly: true, source: 'test' }, { 'CF-Connecting-IP': randIp() })).status, 200);
  }
  const list = await get(`/api/admin/newsletter?subscribers=1&q=pick-${tag}`);
  assert.equal(list.total, 3);
  assert.ok(list.people.every(p => p.id && p.email.includes(`pick-${tag}`)), 'owner sees full emails');
  const chosen = list.people.filter(p => !p.email.endsWith('-2@example.com')).map(p => p.id);
  const r = await nl({ action: 'save_issue', issue: { subject: `Selected ${tag}`, headline: 'For some', intro: 'Hi', include_match: false, stories: [], sponsor_ids: [], audience: chosen } });
  const id = r.data.id;
  const i = await issue(id);
  assert.deepEqual(i.audience.sort(), [...chosen].sort());
  assert.equal(i.audience_count, 2); assert.equal(i.audience_people.length, 2);
  let s;
  do { s = await send({ id, confirm: true }); assert.equal(s.status, 200, JSON.stringify(s.data)); } while (s.data.remaining > 0);
  assert.equal(s.data.total, 2, 'only the two selected people');
  // Nobody selected: refused.
  const empty = (await nl({ action: 'save_issue', issue: { subject: `Nobody ${tag}`, headline: 'x', intro: 'x', include_match: false, stories: [], sponsor_ids: [], audience: [] } })).data.id;
  assert.equal((await send({ id: empty, confirm: true })).status, 400);
  assert.equal((await send({ id: empty, schedule: new Date(Date.now() + 3600e3).toISOString() })).status, 400);
  // Back to everyone: audience null.
  await nl({ action: 'save_issue', issue: { id: empty, subject: `Nobody ${tag}`, headline: 'x', intro: 'x', include_match: false, stories: [], sponsor_ids: [], audience: null } });
  assert.equal((await issue(empty)).audience, null);
});
