// Gate: a match ticket gets in only on the day of its own match. A ticket for
// another fixture is refused with the match it is for, and stays valid.
// Needs the local Pages dev server (ADMIN_CODE=test-code-123,
// STAFF_SCAN_CODE=scan-test). Test tickets are written straight into the
// local database with wrangler, because match-ticket checkout needs a real
// Paystack test key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-code': process.env.ADMIN_CODE || 'test-code-123' };
const SCAN = process.env.STAFF_SCAN_CODE || 'scan-test';
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const H = 3600e3;

const sql = command => {
  const file = path.join(tmpdir(), `gate-test-${uid()}.sql`);
  writeFileSync(file, command);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};
const event = async (away, when) => {
  const r = await fetch(`${BASE}/api/admin/events`, { method: 'POST', headers: ADMIN, body: JSON.stringify({
    home_team: 'Lobi Stars FC', away_team: away, competition: 'NNL', venue: 'McCarthy Stadium, Makurdi',
    event_date: new Date(when).toISOString(), vip_price_kobo: 0, premium_price_kobo: 0, regular_price_kobo: 100000, active: true }) });
  return (await r.json()).id;
};
const gate = id => fetch(`${BASE}/api/validate-ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticketId: id, staffCode: SCAN, station: 'test' }) })
  .then(async r => ({ status: r.status, data: await r.json() }));

// Today's match: two hours from now, unless that is already tomorrow in Nigeria.
const lagosDay = t => new Date(t + H).toISOString().slice(0, 10);
const todayAt = lagosDay(Date.now() + 2 * H) === lagosDay(Date.now()) ? Date.now() + 2 * H : Date.now() - H;

test('match tickets only get in on the day of their own match', async () => {
  const today = await event(`Gate Today ${uid()}`, todayAt);
  const later = await event(`Gate Later ${uid()}`, Date.now() + 7 * 24 * H);
  assert.ok(today && later);
  const order = `LS-ORD-${uid()}`, t1 = `LS-TIX-${uid()}TD`, t2 = `LS-TIX-${uid()}LT`;
  sql(`INSERT INTO orders (id, event_id, buyer_name, buyer_email, buyer_phone, tier, quantity, unit_price_kobo, total_kobo, paystack_reference, payment_status)
       VALUES ('${order}', '${today}', 'Gate Test', 'gate@example.com', '+2348031234567', 'Regular', 2, 100000, 200000, 'LSPAY-${uid()}', 'paid');
       INSERT INTO tickets (id, order_id, event_id, tier) VALUES ('${t1}', '${order}', '${today}', 'Regular'), ('${t2}', '${order}', '${later}', 'Regular');`);

  const wrong = await gate(t2);
  assert.equal(wrong.status, 409);
  assert.match(wrong.data.reason, /^Wrong match: this ticket is for Lobi Stars FC v Gate Later/);
  assert.equal((await gate(t2)).status, 409, 'still refused, still not used');

  const ok = await gate(t1);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.valid, true);
  const again = await gate(t1);
  assert.equal(again.status, 409);
  assert.match(again.data.reason, /Already used/);
});
