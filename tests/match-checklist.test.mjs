// Match Checklist on the server: made by itself for an upcoming match,
// permissions (admins can't tick done: 403; Super Admins can), CSRF, uploads,
// the "Checklist task" banner info, templates (Super Admins only, task links),
// reminders never sent twice a day, the login redirect back to a task, and
// "Back to checklist" on the no-access page.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 and CRON_SECRET=cron-test-secret.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const DAY = 864e5;
const madeStaff = [], madeEvents = [];

async function staff(role) {
  const email = `cl-${role}-${uid()}@example.com`;
  const r = await fetch(`${BASE}/api/admin/staff`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: `Checklist ${role}`, email, password: 'Role-Test-2026!', role }) });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  madeStaff.push(d.id);
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
  assert.equal(login.status, 200);
  return login.headers.get('set-cookie').split(';')[0];
}
const as = (cookie, path, method = 'GET', body, extra = {}) => fetch(BASE + path, { method, redirect: 'manual', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined });
const owner = (path, method = 'GET', body) => fetch(BASE + path, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined });

async function newMatch(daysAhead = 5) {
  const away = `Checklist FC ${uid()}`;
  const r = await owner('/api/admin/events', 'POST', { home_team: 'Lobi Stars FC', away_team: away, competition: 'NNL', venue: 'Lafia City Stadium',
    event_date: new Date(Date.now() + daysAhead * DAY).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 100000, active: true, is_home: true });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  madeEvents.push(d.id);
  return { id: d.id, away };
}
async function checklistFor(eventId) {
  const d = await (await owner('/api/admin/match-checklist')).json();
  return d.checklists.find(c => c.match.id === eventId);
}

after(async () => {
  for (const id of madeEvents) await owner(`/api/admin/events/${id}`, 'DELETE').catch(() => {});
  for (const id of madeStaff) await owner(`/api/admin/staff/${id}`, 'PUT', { active: false, reason: 'test finished' }).catch(() => {});
});

test('a new upcoming match gets its checklist straight away, from the template, with "Go to task" links', async () => {
  const m = await newMatch(5);
  const c = await checklistFor(m.id);
  assert.ok(c, 'checklist made when the match was saved');
  assert.equal(c.status, 'active');
  assert.ok(c.tasks.length >= 30, `seed tasks copied (${c.tasks.length})`);
  const tickets = c.tasks.find(t => t.title === 'Ticketing and gate arrangements');
  assert.match(tickets.link.url, /^\/admin\/tickets\/\?from=checklist&task=\d+$/);
  const stats = c.tasks.find(t => t.title === 'Match stats captured');
  assert.equal(stats.link.url, `/admin/match-centre/?id=${encodeURIComponent(m.id)}&from=checklist&task=${stats.id}#mc-stats`);
  const none = c.tasks.find(t => t.title === 'Kit check (home and away kits, goalkeeper kits)') || c.tasks.find(t => t.link === null);
  assert.equal(none.link, null, 'no link, no button');
  // Generating again doesn't make a second one.
  const again = await (await fetch(`${BASE}/api/internal/checklist-run?action=generate`, { method: 'POST', headers: CRON })).json();
  assert.equal(again.ok, true);
  const all = (await (await owner('/api/admin/match-checklist')).json()).checklists.filter(x => x.match.id === m.id);
  assert.equal(all.length, 1);
});

test('kick-off moved: due times move with it', async () => {
  const m = await newMatch(6);
  const before = await checklistFor(m.id);
  const ev = (await (await owner('/api/admin/events')).json()).events.find(e => e.id === m.id);
  const later = new Date(Date.parse(ev.event_date) + DAY).toISOString();
  const r = await owner(`/api/admin/events/${m.id}`, 'PUT', { ...ev, event_date: later });
  assert.equal(r.status, 200, await r.clone().text());
  const after = await checklistFor(m.id);
  const t0 = before.tasks[0], t1 = after.tasks.find(t => t.id === t0.id);
  assert.equal(Date.parse(t1.due_at) - Date.parse(t0.due_at), DAY);
  assert.equal(after.kickoffAt, later);
});

test('permissions: admins update status but cannot tick done (403); Super Admins can, and untick needs a reason', async () => {
  const m = await newMatch(5);
  const c = await checklistFor(m.id);
  const task = c.tasks[0];
  const mdAdmin = await staff('matchday_admin');
  assert.equal((await as(mdAdmin, '/api/admin/match-checklist')).status, 200, 'all admins can view');
  assert.equal((await as(mdAdmin, `/api/admin/match-checklist/tasks/${task.id}`, 'PATCH', { status: 'done' })).status, 403);
  assert.equal((await as(mdAdmin, `/api/admin/match-checklist/tasks/${task.id}`, 'PATCH', { status: 'not_applicable' })).status, 403);
  assert.equal((await as(mdAdmin, `/api/admin/match-checklist/tasks/${task.id}`, 'PATCH', { status: 'submitted_for_review', notes: 'Ready' })).status, 200);
  assert.equal((await as(mdAdmin, `/api/admin/match-checklist/tasks/${task.id}`, 'PATCH', { owner_unit: 'Media' })).status, 403, 'owners: Super Admins only');
  assert.equal((await as(mdAdmin, '/api/admin/match-checklist', 'POST', { action: 'close', id: c.id })).status, 403);
  assert.equal((await as(mdAdmin, '/api/admin/match-checklist/templates')).status, 403);
  assert.equal((await as(mdAdmin, '/api/admin/match-checklist/settings')).status, 403);
  // CSRF: a change from another website is refused.
  assert.equal((await as(mdAdmin, `/api/admin/match-checklist/tasks/${task.id}`, 'PATCH', { status: 'in_progress' }, { Origin: 'https://evil.example' })).status, 403);

  const done = await owner(`/api/admin/match-checklist/tasks/${task.id}`, 'PATCH', { status: 'done' });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).task.status, 'done');
  const t = (await checklistFor(m.id)).tasks.find(x => x.id === task.id);
  assert.ok(t.completed_by_name && t.completed_at, 'who and when');
  assert.equal((await as(mdAdmin, `/api/admin/match-checklist/tasks/${task.id}`, 'PATCH', { status: 'in_progress', reason: 'x' })).status, 403, 'admins cannot untick');
  assert.equal((await owner(`/api/admin/match-checklist/tasks/${task.id}`, 'PATCH', { status: 'in_progress' })).status, 400, 'reason required');
  assert.equal((await owner(`/api/admin/match-checklist/tasks/${task.id}`, 'PATCH', { status: 'in_progress', reason: 'Wrong task' })).status, 200);
  const hist = (await (await owner(`/api/admin/match-checklist/tasks/${task.id}/history`)).json()).history;
  assert.ok(hist.some(h => h.action === 'unticked' && h.reason === 'Wrong task'));
  assert.ok(hist.some(h => h.action === 'status_changed' && h.new_value === 'submitted_for_review'));

  // Gate and kitchen helpers don't see the checklist at all.
  const gate = await staff('gate_staff');
  assert.ok([302, 403].includes((await as(gate, '/api/admin/match-checklist')).status));
});

test('uploads: only real PDF/JPG/PNG/DOCX/XLSX files, kept private', async () => {
  const m = await newMatch(5);
  const task = (await checklistFor(m.id)).tasks[1];
  const send = (name, bytes, type) => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type }), name); return fetch(`${BASE}/api/admin/match-checklist/tasks/${task.id}/file`, { method: 'POST', headers: { 'x-admin-code': ADMIN['x-admin-code'] }, body: fd }); };
  assert.equal((await send('evil.pdf', new TextEncoder().encode('<script>alert(1)</script>'), 'application/pdf')).status, 400, 'not really a PDF');
  assert.equal((await send('run.exe', new Uint8Array([0x4d, 0x5a, 0, 0]), 'application/octet-stream')).status, 400);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const ok = await send('team sheet.png', png, 'image/png');
  assert.equal(ok.status, 200, await ok.clone().text());
  const dl = await owner(`/api/admin/match-checklist/tasks/${task.id}/file`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.match(dl.headers.get('content-disposition') || '', /attachment/);
  assert.equal((await fetch(`${BASE}/api/admin/match-checklist/tasks/${task.id}/file`)).status, 401, 'signed in only');
});

test('banner info for a task; PDF download; email checks the addresses', async () => {
  const m = await newMatch(5);
  const c = await checklistFor(m.id);
  const task = c.tasks.find(t => t.title === 'Match stats captured');
  const d = await (await owner(`/api/admin/match-checklist/tasks/${task.id}`)).json();
  assert.equal(d.task.title, 'Match stats captured');
  assert.equal(d.headline, `Lobi Stars FC vs ${m.away}`);
  assert.match(d.link.url, /from=checklist&task=\d+#mc-stats$/);
  assert.equal(d.me.isSuper, true);
  const pdf = await owner(`/api/admin/match-checklist/pdf?id=${c.id}&mode=report`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /checklist-lobi-stars-fc-vs-checklist-fc-.*\.pdf/);
  assert.ok(new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).slice(0, 5)).startsWith('%PDF'));
  assert.equal((await owner('/api/admin/match-checklist/email', 'POST', { id: c.id, to: 'not-an-email' })).status, 400);
});

test('templates: Super Admins only; links must be listed admin pages or https://; Test link uses the next match', async () => {
  const d = await (await owner('/api/admin/match-checklist/templates')).json();
  assert.ok(d.tasks.length >= 30 && d.targets.length > 10);
  const base = { title: `Test task ${uid()}`, phase: 'before', due_offset_minutes: -120 };
  assert.equal((await owner('/api/admin/match-checklist/templates', 'POST', { action: 'save', task: { ...base, link_type: 'external', link_url: 'http://insecure.example/x' } })).status, 400);
  assert.equal((await owner('/api/admin/match-checklist/templates', 'POST', { action: 'save', task: { ...base, link_type: 'internal', link_route: '/admin/not-a-page/' } })).status, 400);
  assert.equal((await owner('/api/admin/match-checklist/templates', 'POST', { action: 'save', task: { ...base, link_type: 'internal', link_route: 'https://evil.example/admin/' } })).status, 400);
  await newMatch(2);
  const t = await (await owner('/api/admin/match-checklist/templates', 'POST', { action: 'test_link', task: { link_type: 'internal', link_route: '/admin/match-centre/?id={match_id}#mc-stats' } })).json();
  assert.match(t.url, /^\/admin\/match-centre\/\?id=[^&]+&from=checklist#mc-stats$/);
  const save = await owner('/api/admin/match-checklist/templates', 'POST', { action: 'save', task: { ...base, link_type: 'external', link_url: 'https://forms.example.org/accreditation' } });
  assert.equal(save.status, 200);
  const mine = (await (await owner('/api/admin/match-checklist/templates')).json()).tasks.find(x => x.title === base.title);
  assert.equal(mine.link_url, 'https://forms.example.org/accreditation');
  assert.equal((await owner('/api/admin/match-checklist/templates', 'POST', { action: 'delete', id: mine.id })).status, 200);
});

test('reminders: a preview, and nobody gets the email twice on the same day', async () => {
  await newMatch(2);
  assert.equal((await fetch(`${BASE}/api/internal/checklist-run?action=remind&dryRun=1`, { method: 'POST' })).status, 403, 'needs CRON_SECRET');
  const dry = await (await fetch(`${BASE}/api/internal/checklist-run?action=remind&dryRun=1&force=1`, { method: 'POST', headers: CRON })).json();
  assert.equal(dry.ok, true);
  assert.equal(dry.remind.dryRun, true);
  assert.ok(dry.remind.count > 0 && dry.remind.recipients.length > 0, JSON.stringify(dry.remind).slice(0, 300));
  assert.match(dry.remind.subject, /outstanding\] Match checklist: /);
  await fetch(`${BASE}/api/internal/checklist-run?action=remind&force=1`, { method: 'POST', headers: CRON });
  const second = await (await fetch(`${BASE}/api/internal/checklist-run?action=remind&force=1`, { method: 'POST', headers: CRON })).json();
  assert.deepEqual(second.remind.sent, []);
  assert.match(second.remind.skipped, /already had today/);
  const s = await (await owner('/api/admin/match-checklist/settings', 'PUT', { reminderSendTime: '25:00', reminderDaysBefore: 3, postMatchReminderDays: 3 })).json();
  assert.match(s.error, /HH:MM/);
});

test('signing in from an emailed task link comes back to the task; no-access page offers "Back to checklist"', async () => {
  const r = await fetch(`${BASE}/admin/match-checklist/go/?task=5`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'), BASE);
  assert.equal(loc.pathname, '/admin/login/');
  assert.equal(loc.searchParams.get('next'), '/admin/match-checklist/go/?task=5');
  const bo = await staff('broadcast_operator');
  const denied = await as(bo, '/admin/tickets/?from=checklist&task=77');
  assert.equal(denied.status, 403);
  const html = await denied.text();
  assert.match(html, /href="\/admin\/match-checklist\/\?task=77#task-77">Back to checklist/);
  const plain = await (await as(bo, '/admin/tickets/')).text();
  assert.doesNotMatch(plain, /Back to checklist/);
  assert.doesNotMatch(await (await as(bo, '/admin/tickets/?from=checklist&task=1%22%3E%3Cscript%3E')).text(), /<script>/, 'task id must be a number');
});

test('separate home template: home matches use it, others the shared one; removing it goes back', async () => {
  const tpl = p => fetch(`${BASE}/api/admin/match-checklist/templates${p || ''}`, { headers: ADMIN }).then(r => r.json());
  const post = b => fetch(`${BASE}/api/admin/match-checklist/templates`, { method: 'POST', headers: ADMIN, body: JSON.stringify(b) }).then(async r => ({ status: r.status, data: await r.json() }));
  const before = await tpl();
  for (const t of before.templates.filter(x => x.venue_type === 'home')) await post({ action: 'delete_template', templateId: t.id });
  const made = await post({ action: 'create_variant', venue: 'home' });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.ok(made.data.copied > 20);
  assert.equal((await post({ action: 'create_variant', venue: 'home' })).status, 409, 'only one home template');
  const home = await tpl(`?template=${made.data.id}`);
  assert.equal(home.template.venue_type, 'home');
  assert.ok(!home.tasks.some(t => t.applies_to === 'away'), 'away-only tasks are not copied');
  const kit = home.tasks.find(t => /^Kit check/.test(t.title));
  assert.equal((await post({ action: 'save', templateId: made.data.id, task: { ...kit, title: 'HOME TEMPLATE kit check' } })).status, 200);
  const m = await newMatch(4);
  const c = await checklistFor(m.id);
  assert.ok(c.tasks.some(t => t.title === 'HOME TEMPLATE kit check'), 'the new home match used the home template');
  assert.equal((await post({ action: 'delete_template', templateId: made.data.id })).status, 200);
  assert.ok(!(await tpl()).templates.some(t => t.venue_type === 'home'));
  assert.equal((await post({ action: 'delete_template', templateId: (await tpl()).template.id })).status, 400, 'the shared template stays');
});

test('the "Checklist task" bar is on every admin page, hidden unless arriving from the checklist', async () => {
  for (const p of ['/admin/tickets/', '/admin/match-centre/', '/admin/league/fixtures/']) {
    const html = await (await fetch(`${BASE}${p}`, { headers: { 'x-admin-code': ADMIN['x-admin-code'] }, redirect: 'manual' })).text().catch(() => '');
    if (!html.includes('id="mcBanner"')) continue; // pages behind the login cookie are checked in the browser
    assert.match(html, /id="mcBanner"[^>]*hidden/, `${p}: hidden by default`);
  }
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/admin/ChecklistBanner.astro', import.meta.url), 'utf8');
  assert.match(src, /q\.get\('from'\) === 'checklist'/, 'only shown with ?from=checklist');
  assert.ok(src.includes(String.raw`/^\d{1,9}$/.test(id)`), 'the task must be a number');
  assert.match(readFileSync(new URL('../src/components/admin/AdminNav.astro', import.meta.url), 'utf8'), /<ChecklistBanner \/>/, 'part of the shared admin layout');
});
