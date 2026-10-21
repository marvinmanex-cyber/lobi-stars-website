// Match Checklist, the parts that need no server: generation from the
// template, rescheduling, reminder selection, the daily email, task links
// (placeholders, absolute links in emails, no button without a link), the
// PDF, and the safe "back to where you were" after signing in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tasksFromTemplate, rescheduledTimes, tasksToRemind, digestSections, digestSubject, fillPlaceholders, buildTaskLink,
  routeExists, offsetLabel, toOffset, SEED_TASKS, SEED_LINKS, LINK_TARGETS, lagosDay } from '../functions/api/_lib/matchChecklist.js';
import { digestEmail, checklistEmail, checklistPdf, pdfFilename, goLink } from '../functions/api/_lib/checklistOutput.js';
import { brokenLinks } from '../functions/api/_lib/checklistReminders.js';
import { safeNext } from '../src/lib/safeNext.ts';

const KO = '2026-11-08T15:00:00.000Z'; // Sun 8 Nov 2026, 4:00 PM Lagos
const HOUR = 3600e3, DAY = 24 * HOUR;
const BASE = 'https://lobistarsfc.com';
const CTX = { match_id: 42, fixture_id: 7, home_team: 'Lobi Stars', away_team: 'Bichi First', match_slug: 'lobi-stars-vs-bichi-first-2026-11-08', match_date: '2026-11-08', competition_id: 3, season_id: '2026/27', opponent_id: 9, site_url: BASE };
const SETTINGS = { reminderDaysBefore: 3, postMatchReminderDays: 3 };

function checklist(tasks, extra = {}) {
  return { id: 5, status: 'active', kickoffAt: KO, isHome: true, match: { id: 42, home: 'Lobi Stars', away: 'Bichi First', competition: 'NNL', venue: 'Lafia City Stadium', kickoff: KO, matchday: 1 }, tasks,
    progress: { total: tasks.length, finished: tasks.filter(t => t.status === 'done').length, done: tasks.filter(t => t.status === 'done').length, pct: 0, overdue: 0 }, ...extra };
}

test('a checklist is made from the template: home/away filter, due times from kick-off, links copied', () => {
  const tpl = [
    { id: 1, title: 'Both', phase: 'before', due_offset_minutes: -1440, applies_to: 'both', link_type: 'internal', link_route: '/admin/tickets/' },
    { id: 2, title: 'Home only', phase: 'before', due_offset_minutes: -120, remind_from_offset_minutes: -2880, applies_to: 'home' },
    { id: 3, title: 'Away only', phase: 'before', due_offset_minutes: -60, applies_to: 'away' },
    { id: 4, title: 'After', phase: 'after', due_offset_minutes: 1440, applies_to: 'both' },
  ];
  const home = tasksFromTemplate(tpl, KO, true);
  assert.deepEqual(home.map(t => t.title), ['Both', 'Home only', 'After']);
  assert.equal(home[0].due_at, '2026-11-07T15:00:00.000Z');
  assert.equal(home[1].remind_from_at, '2026-11-06T15:00:00.000Z');
  assert.equal(home[0].link_type, 'internal');
  assert.equal(home[0].link_route, '/admin/tickets/');
  assert.equal(home[1].link_type, 'none');
  assert.deepEqual(tasksFromTemplate(tpl, KO, false).map(t => t.title), ['Both', 'Away only', 'After']);
});

test('the 33 seed tasks; every seed link points to a known admin page', () => {
  assert.equal(SEED_TASKS.length, 33);
  const titles = new Set(SEED_TASKS.map(t => t[1]));
  for (const [title, l] of Object.entries(SEED_LINKS)) {
    assert.ok(titles.has(title), `seed link for a real task: ${title}`);
    assert.ok(routeExists(l.route), l.route);
  }
  for (const t of LINK_TARGETS) assert.ok(t.route.startsWith('/admin'), t.id);
});

test('kick-off moves: unfinished tasks move with it, finished ones keep their times', () => {
  const t = { status: 'in_progress', due_offset_minutes: -1440, remind_from_offset_minutes: -4320 };
  assert.deepEqual(rescheduledTimes(t, '2026-11-09T15:00:00.000Z'), { due_at: '2026-11-08T15:00:00.000Z', remind_from_at: '2026-11-06T15:00:00.000Z' });
  assert.equal(rescheduledTimes({ ...t, status: 'done' }, KO), null);
  assert.equal(rescheduledTimes({ ...t, status: 'not_applicable' }, KO), null);
});

test('offsets: labels and the template form values', () => {
  assert.equal(offsetLabel(-7200), '5 days before kick-off');
  assert.equal(offsetLabel(0), 'At kick-off');
  assert.equal(offsetLabel(90), '90 minutes after kick-off');
  assert.equal(toOffset({ amount: 2, unit: 'hours', when: 'before' }), -120);
  assert.equal(toOffset({ amount: 9, unit: 'days', when: 'at' }), 0);
});

test('reminders: from 3 days before, early "remind from" tasks, after-match tasks for 3 days; finished tasks never', () => {
  const tasks = [
    { id: 1, title: 'Due tomorrow', phase: 'before', status: 'not_started', due_at: '2026-11-07T15:00:00.000Z' },
    { id: 2, title: 'Early', phase: 'before', status: 'not_started', due_at: '2026-11-07T15:00:00.000Z', remind_from_at: '2026-10-30T15:00:00.000Z' },
    { id: 3, title: 'Done', phase: 'before', status: 'done', due_at: '2026-11-07T15:00:00.000Z' },
    { id: 4, title: 'Report', phase: 'after', status: 'not_started', due_at: '2026-11-09T15:00:00.000Z' },
  ];
  const c = checklist(tasks);
  const ids = now => tasksToRemind(c, SETTINGS, now).map(t => t.id);
  assert.deepEqual(ids(Date.parse(KO) - 10 * DAY), [], 'too early');
  assert.deepEqual(ids(Date.parse('2026-10-31T08:00:00Z')), [2], 'only the early task');
  assert.deepEqual(ids(Date.parse(KO) - 2 * DAY), [1, 2, 4], 'within 3 days');
  assert.deepEqual(tasksToRemind(c, { reminderDaysBefore: 0, postMatchReminderDays: 3 }, Date.parse(KO) + DAY).map(t => t.id), [1, 2, 4], 'after kick-off, unfinished tasks are overdue and keep coming');
});

test('the daily email: overdue / today / next 3 days, MATCH DAY subject, absolute "Go to task" links, none without a link', () => {
  const now = Date.parse('2026-11-08T07:00:00Z'); // 8:00 AM Lagos on match day
  const tasks = [
    { id: 11, title: 'Late one', phase: 'before', status: 'in_progress', due_at: '2026-11-07T15:00:00.000Z', link: buildTaskLink({ id: 11, link_type: 'internal', link_route: '/admin/match-centre/?id={match_id}#squadSet' }, CTX) },
    { id: 12, title: 'Today one', phase: 'during', status: 'not_started', due_at: KO, link: null },
    { id: 13, title: 'Soon one', phase: 'after', status: 'not_started', due_at: '2026-11-10T15:00:00.000Z', link: buildTaskLink({ id: 13, link_type: 'external', link_url: 'https://example.org/form' }, CTX) },
    { id: 14, title: 'Later one', phase: 'after', status: 'not_started', due_at: '2026-11-20T15:00:00.000Z', link: null },
  ];
  const c = checklist(tasks);
  const s = digestSections(tasks, now);
  assert.deepEqual([s.overdue, s.today, s.soon].map(x => x.map(t => t.id)), [[11], [12], [13]]);
  const subject = digestSubject(c, 3, now);
  assert.match(subject, /^MATCH DAY: \[3 outstanding\] Match checklist: Lobi Stars vs Bichi First — /);
  assert.doesNotMatch(digestSubject(c, 3, now - DAY), /MATCH DAY/);
  const { html } = digestEmail([{ checklist: c, sections: s }], { base: BASE, subject, brokenLinks: ['x (page not found)'] });
  assert.ok(html.includes(`href="${goLink(BASE, 11)}"`), 'internal task: absolute go link');
  assert.ok(html.includes(`href="${goLink(BASE, 13)}"`), 'external task: go link too');
  assert.ok(!html.includes(goLink(BASE, 12)), 'no link for a task without one');
  assert.ok(!/href="\/admin/.test(html), 'no relative links in emails');
  assert.match(html, /Broken task links/);
  assert.doesNotMatch(digestEmail([{ checklist: c, sections: s }], { base: BASE, subject }).html, /Broken task links/, 'only when passed (Super Admins)');
  const e = checklistEmail(c, { from: 'Test', message: 'Hi <b>team</b>', base: BASE });
  assert.ok(e.html.includes(`${BASE}/admin/match-checklist/?id=5`));
  assert.ok(e.html.includes('Hi &lt;b&gt;team'), 'message escaped');
});

test('task links: placeholders filled and encoded, tracking before the #, missing values = broken, external https only', () => {
  assert.equal(fillPlaceholders('/admin/x/?t={home_team}&d={match_date}', CTX).url, '/admin/x/?t=Lobi%20Stars&d=2026-11-08');
  assert.deepEqual(fillPlaceholders('/admin/x/?f={fixture_id}', { ...CTX, fixture_id: '' }).missing, ['fixture_id']);
  assert.deepEqual(fillPlaceholders('/admin/x/?f={nope}', CTX).missing, ['nope']);
  const share = fillPlaceholders('/admin/share/?url={site_url}/matches/{match_slug}/', CTX).url;
  assert.equal(share, '/admin/share/?url=https://lobistarsfc.com/matches/lobi-stars-vs-bichi-first-2026-11-08/');

  const l = buildTaskLink({ id: 9, link_type: 'internal', link_route: '/admin/match-centre/?id={match_id}#mc-stats', link_label: 'Open stats' }, CTX);
  assert.deepEqual(l, { type: 'internal', url: '/admin/match-centre/?id=42&from=checklist&task=9#mc-stats', label: 'Open stats' });
  assert.equal(buildTaskLink({ id: 9, link_type: 'internal', link_route: '/admin/tickets/' }, CTX, { base: BASE }).url, `${BASE}/admin/tickets/?from=checklist&task=9`);
  assert.equal(buildTaskLink({ id: 9, link_type: 'internal', link_route: '/admin/tickets/' }, CTX).label, 'Go to task', 'default label');
  const cms = buildTaskLink({ id: 3, link_type: 'internal', link_route: '/admin/#/collections/players' }, CTX);
  assert.equal(cms.url, '/admin/?from=checklist&task=3#/collections/players');
  assert.equal(buildTaskLink({ id: 1, link_type: 'internal', link_route: '/admin/x/?f={fixture_id}' }, { ...CTX, fixture_id: '' }).broken, true);
  assert.equal(buildTaskLink({ id: 1, link_type: 'none' }, CTX), null, 'no link, no button');
  assert.equal(buildTaskLink({ id: 1, link_type: 'internal', link_route: '' }, CTX), null);
  assert.equal(buildTaskLink({ id: 1, link_type: 'external', link_url: 'http://insecure.example' }, CTX), null);
  assert.equal(buildTaskLink({ id: 1, link_type: 'external', link_url: 'javascript:alert(1)' }, CTX), null);
  assert.equal(buildTaskLink({ id: 1, link_type: 'external', link_url: 'https://forms.example/x' }, CTX).url, 'https://forms.example/x');
});

test('broken-link check: unknown pages, missing match values, bad external links', () => {
  const c = checklist([
    { title: 'Gone', link_type: 'internal', link_route: '/admin/old-page/', link: { broken: false } },
    { title: 'No fixture', link_type: 'internal', link_route: '/admin/tickets/?f={fixture_id}', link: { broken: true, missing: ['fixture_id'] } },
    { title: 'Bad ext', link_type: 'external', link_url: 'http://x.example', link: null },
    { title: 'Fine', link_type: 'internal', link_route: '/admin/tickets/', link: { url: '/admin/tickets/' } },
    { title: 'None', link_type: 'none', link: null },
  ]);
  const b = brokenLinks([c]);
  assert.equal(b.length, 3);
  assert.match(b[0], /Gone \(page not found: \/admin\/old-page\/\)/);
  assert.match(b[1], /no fixture_id/);
  assert.match(b[2], /https:\/\//);
});

test('PDF: a real PDF with clickable task titles, print mode with tick boxes and short links', () => {
  const tasks = [
    { id: 21, title: 'Ticketing and gate arrangements', phase: 'before', status: 'done', priority: 'critical', due_at: '2026-11-06T15:00:00.000Z', completed_by_name: 'Ada', completed_at: '2026-11-05T10:00:00.000Z', link: { type: 'internal', url: '/admin/tickets/?from=checklist&task=21', label: 'Open tickets' } },
    { id: 22, title: 'Kit check', phase: 'during', status: 'not_started', priority: 'normal', due_at: KO, link: null },
  ];
  const c = checklist(tasks);
  const bytes = checklistPdf(c, { mode: 'report', generatedBy: 'Tester', base: BASE });
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(text.startsWith('%PDF-1.'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.ok(text.includes(`/URI (${goLink(BASE, 21)})`), 'title links to the task');
  assert.ok(!text.includes(goLink(BASE, 22)), 'no link for a task without one');
  const print = new TextDecoder('latin1').decode(checklistPdf(c, { mode: 'print', generatedBy: 'Tester', base: BASE }));
  assert.match(print, /Go to task: lobistarsfc\.com\/admin\/match-checklist\/go\/\?task=21/);
  assert.equal(pdfFilename(c), 'checklist-lobi-stars-vs-bichi-first-2026-11-08.pdf');
  assert.equal(lagosDay(Date.parse('2026-11-08T23:30:00Z')), '2026-11-09', 'Lagos day');
});

test('after signing in: only pages of this admin, never another website', () => {
  const O = 'https://lobistarsfc.com';
  assert.equal(safeNext('/admin/match-checklist/go/?task=5', O), '/admin/match-checklist/go/?task=5');
  assert.equal(safeNext('/admin/tickets/?from=checklist&task=5#x', O), '/admin/tickets/?from=checklist&task=5#x');
  assert.equal(safeNext('/admin', O), '/admin');
  for (const bad of ['', 'https://evil.example/admin/', '//evil.example/admin/', '/\\evil.example', '/admin\\@evil.example', 'javascript:alert(1)',
    '/admin/login/?next=/admin/', '/administrator', '/fans/', ' /admin/', '/admin/\u0000x', 'http:/admin/']) {
    assert.equal(safeNext(bad, O), '/admin/dashboard/', JSON.stringify(bad));
  }
  assert.equal(safeNext('/admin/../evil', O), '/admin/dashboard/', 'path escaping /admin');
});
