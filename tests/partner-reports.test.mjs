// Monthly partner reports: month ranges in Nigerian time, the numbers per
// partner, report emails per partner (validated), the printable report, send
// needs email (Resend), automatic send needs the cron secret, roles.
// Needs the local Pages dev server with ADMIN_CODE=test-code-123 and CRON_SECRET=cron-test-secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthRange, previousMonth, cleanEmails, renderPartnerReport } from '../functions/api/_lib/partnerReport.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const CRON = process.env.CRON_SECRET || 'cron-test-secret';
const uid = () => Math.random().toString(36).slice(2, 8);
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const api = (path, method = 'GET', body, headers = ADMIN) => fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.clone().json().catch(() => ({})), text: () => r.text() }));

test('helpers: Nigerian-time months, previous month, email list, report text', () => {
  assert.deepEqual(monthRange('2026-09'), { month: '2026-09', label: 'September 2026', start: '2026-08-31 23:00:00', end: '2026-09-30 23:00:00', startIso: '2026-08-31T23:00:00.000Z', endIso: '2026-09-30T23:00:00.000Z' });
  assert.equal(monthRange('2026-13'), null);
  assert.equal(previousMonth(Date.UTC(2026, 9, 12)), '2026-09');
  assert.equal(previousMonth(Date.UTC(2026, 0, 5)), '2025-12');
  assert.equal(previousMonth(Date.UTC(2026, 8, 30, 23, 30)), '2026-09', 'already 1 October in Nigeria');
  assert.deepEqual(cleanEmails('A@x.com, bad, b@y.org; a@x.com'), ['a@x.com', 'b@y.org']);
  const rep = { label: 'September 2026', site: { views: 1200, visitors: 400 }, programme: { readers: 50, opens: 80, downloads: 30 } };
  const p = { slug: 'novus-mfb', name: 'Novus <MFB>', tier: 'Official Club Partners', logo: null, impressions: 1200, clicks: 12, clickRate: 0.01, pageViews: 7, newsletter: { issues: 2, recipients: 900, clicks: 15 } };
  const m = renderPartnerReport(rep, p);
  assert.equal(m.subject, 'Lobi Stars FC partner report: September 2026 (Novus <MFB>)');
  assert.ok(m.html.includes('Novus &lt;MFB&gt;') && !m.html.includes('Novus <MFB>'), 'escaped');
  for (const t of ['1,200', '1.00%', '900 sent', '110 reads']) assert.ok(m.html.includes(t), t);
  assert.match(m.text, /no personal details/);
});

test('report data, emails per partner, printable report, sending needs email', async () => {
  const d = (await api('/api/admin/partner-reports?month=2026-10')).data;
  assert.equal(d.report.month, '2026-10');
  assert.ok(d.report.partners.length >= 5);
  const p = d.report.partners[0];
  for (const k of ['impressions', 'clicks', 'pageViews', 'newsletter']) assert.ok(k in p, k);
  assert.equal(d.emailReady, false, 'no Resend key locally');
  assert.ok(!JSON.stringify(d.report).includes('@'), 'no email addresses or personal data in the numbers');
  assert.equal((await api('/api/admin/partner-reports', 'POST', { contacts: { slug: p.slug, emails: 'marketing@partner.com, oops' } })).status, 400);
  const ok = await api('/api/admin/partner-reports', 'POST', { contacts: { slug: p.slug, emails: `Marketing@Partner.com ceo-${uid()}@partner.com` } });
  assert.equal(ok.status, 200); assert.equal(ok.data.emails[0], 'marketing@partner.com');
  const view = await fetch(`${BASE}/api/admin/partner-reports/view?slug=${p.slug}&month=2026-10`, { headers: ADMIN });
  assert.equal(view.status, 200);
  const html = await view.text();
  assert.ok(html.includes('Print or save as PDF') && html.includes('October 2026'));
  assert.equal((await api('/api/admin/partner-reports', 'POST', { send: { month: '2026-10', slugs: [p.slug] } })).status, 409, 'email not set up');
  assert.equal((await api('/api/admin/partner-reports', 'POST', { settings: { autoSend: true } })).data.autoSend, true);
  assert.equal((await api('/api/admin/partner-reports', 'POST', { settings: { autoSend: false } })).data.autoSend, false);
});

test('automatic send: cron secret; does nothing without email', async () => {
  assert.equal((await fetch(`${BASE}/api/internal/partner-reports`, { method: 'POST' })).status, 403);
  const r = await fetch(`${BASE}/api/internal/partner-reports`, { method: 'POST', headers: { Authorization: `Bearer ${CRON}` } }).then(x => x.json());
  assert.deepEqual(r, { ok: true, ran: false });
});

test('roles: Commercial staff use partner reports; Analysts cannot', async () => {
  const login = async role => {
    const email = `pr-${role}-${uid()}@example.com`;
    await api('/api/admin/staff', 'POST', { name: `PR ${role}`, email, password: 'Role-Test-2026!', role });
    const l = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randIp() }, body: JSON.stringify({ email, password: 'Role-Test-2026!' }) });
    return { Cookie: l.headers.get('set-cookie').split(';')[0] };
  };
  assert.equal((await api('/api/admin/partner-reports', 'GET', null, await login('commercial'))).status, 200);
  assert.equal((await api('/api/admin/partner-reports', 'GET', null, await login('analyst'))).status, 403);
});
