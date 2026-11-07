// Saved sales reports: the figures, combining, Word and PDF files, who can see them, and the one-year rule.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { sql } from './media-helpers.mjs';
import { hashPassword } from '../functions/api/_lib/password.js';
import { salesFigures, combineFigures, deletableFrom, canDeleteReport, pieSlices } from '../functions/api/_lib/kitchenSalesReports.js';
import { piePng, salesReportDocx, salesReportPdf, reportFileName } from '../functions/api/_lib/kitchenSalesFiles.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const T = Date.now().toString(36).toUpperCase();
const rows = q => JSON.parse(sql(q))[0].results;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const EMAIL = `sr-${T.toLowerCase()}@example.com`, PW = 'Kitchen-Super-2026!';
const order = (status, channel, items, total, pay = 'paid') => ({ order_status: status, channel, payment_status: pay, total_kobo: total, paid_iso: '2026-11-08T15:00:00Z', items_json: JSON.stringify(items) });
const suya = q => ({ name: 'Suya', qty: q, priceKobo: 100000 }), water = q => ({ name: 'Water', qty: q, priceKobo: 40000 }), pie = q => ({ name: 'Meat Pie', qty: q, priceKobo: 100000 });

test('the figures: online and WhatsApp apart, most sold first, what does not count', () => {
  const f = salesFigures([
    order('DELIVERED', 'paystack', [suya(2), water(1)], 240000),
    order('ACCEPTED', 'whatsapp', [water(3), pie(1)], 220000),
    order('DELIVERED', 'whatsapp', [suya(1)], 50000), // a voucher took ₦500 off
    order('REJECTED', 'paystack', [suya(9)], 900000),
    order('REFUNDED', 'whatsapp', [suya(9)], 900000),
    order('EXPIRED', 'paystack', [suya(9)], 900000, 'pending'),
  ]);
  assert.deepEqual(f.online, { orders: 1, kobo: 240000 }); assert.deepEqual(f.whatsapp, { orders: 2, kobo: 270000 });
  assert.equal(f.totalOrders, 3); assert.equal(f.totalKobo, 510000); assert.equal(f.totalItems, 8);
  assert.deepEqual(f.items.map(i => [i.name, i.qty]), [['Water', 4], ['Suya', 3], ['Meat Pie', 1]]);
  assert.deepEqual([f.items[0].onlineQty, f.items[0].whatsappQty], [1, 3]);
  assert.equal(f.discountsKobo, 50000);
  assert.deepEqual(f.excluded, { orders: 2, kobo: 1800000 });
  assert.deepEqual(salesFigures([]).items, []);
});

test('combining adds everything up and ranks again', () => {
  const a = salesFigures([order('DELIVERED', 'paystack', [suya(1), water(2)], 180000)]), b = salesFigures([order('DELIVERED', 'whatsapp', [suya(4)], 400000)]);
  const c = combineFigures([a, b]);
  assert.equal(c.totalKobo, 580000); assert.equal(c.totalOrders, 2); assert.equal(c.online.orders, 1); assert.equal(c.whatsapp.kobo, 400000);
  assert.deepEqual(c.items.map(i => [i.name, i.qty, i.onlineQty, i.whatsappQty]), [['Suya', 5, 1, 4], ['Water', 2, 2, 0]]);
});

test('the one-year rule', () => {
  assert.equal(deletableFrom('2026-11-08'), '2027-11-08');
  assert.equal(canDeleteReport('2026-11-08', '2027-11-07'), false, 'the day before');
  assert.equal(canDeleteReport('2026-11-08', '2027-11-08'), true, 'a year on');
  assert.equal(deletableFrom('2028-02-29'), '2029-03-01', 'a leap day');
});

test('the pie: up to 8 slices, the rest as Other', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `Dish ${i}`, qty: 12 - i }));
  const s = pieSlices(many);
  assert.equal(s.length, 8); assert.match(s[7].name, /^Other \(5 items\)/); assert.equal(s[7].qty, 5 + 4 + 3 + 2 + 1);
  assert.equal(pieSlices(many.slice(0, 8)).length, 8, 'exactly 8 needs no Other');
  assert.deepEqual(pieSlices([]), []);
  const png = piePng(s, 120);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

const sample = () => {
  const f = salesFigures([order('DELIVERED', 'paystack', [suya(2)], 200000), order('DELIVERED', 'whatsapp', [{ name: 'Fish & <Chips>', qty: 3, priceKobo: 100000 }], 300000)]);
  const money = k => `₦${(k / 100).toLocaleString('en-NG')}`;
  return { nos: [1, 4, 7], combined: true, heading: 'Combined report: reports 1, 4, 7', parts: [{ no: 1, day: '2026-11-08', title: 'A vs B', venue: 'Ground', orders: 2, total: '₦5,000' }, { no: 4, day: '2026-11-15', title: 'A vs C', venue: 'Ground', orders: 0, total: '₦0' }],
    figures: { ...f, total: money(f.totalKobo), onlineTotal: money(f.online.kobo), whatsappTotal: money(f.whatsapp.kobo), discounts: money(0), excludedTotal: money(0), items: f.items.map((i, n) => ({ ...i, rank: n + 1, sales: money(i.kobo), share: 50 })) } };
};

test('the Word file is a real Word document, with the figures and the chart', () => {
  const r = sample();
  const zip = unzipSync(salesReportDocx(r));
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'word/media/pie.png']) assert.ok(zip[f], f);
  const doc = strFromU8(zip['word/document.xml']);
  assert.match(doc, /Combined report: reports 1, 4, 7/); assert.match(doc, /Paid on WhatsApp/); assert.match(doc, /₦5,000/);
  assert.match(doc, /Fish &amp; &lt;Chips&gt;/, 'names are escaped'); assert.match(doc, /r:embed="rIdPie"/);
  assert.ok(doc.indexOf('Fish') < doc.lastIndexOf('Suya'), 'most sold first');
  assert.equal(reportFileName(r, 'docx'), 'MatchDay-Kitchen-Combined-Report-1-4-7.docx');
  assert.equal(reportFileName({ combined: false, nos: [4] }, 'pdf'), 'MatchDay-Kitchen-Report-4.pdf');
  const empty = unzipSync(salesReportDocx({ ...r, figures: { ...r.figures, items: [] } }));
  assert.ok(!empty['word/media/pie.png'], 'no sales: no picture');
});

test('the PDF file is a real PDF, and a long list runs over pages', async () => {
  const r = sample();
  const head = b => String.fromCharCode(...b.slice(0, 5));
  assert.equal(head(await salesReportPdf(r)), '%PDF-');
  const long = { ...r, figures: { ...r.figures, items: Array.from({ length: 70 }, (_, i) => ({ name: `Dish ${i}`, qty: 70 - i, kobo: 1000, onlineQty: 1, whatsappQty: 1, rank: i + 1, sales: '₦10', share: 1 })) } };
  const text = new TextDecoder('latin1').decode(await salesReportPdf(long));
  assert.ok((text.match(/\/Type \/Page\b/g) || []).length >= 2, 'more than one page');
});

const made = [], days = ['2021-03-01', '2021-03-08'];
async function as(body) {
  const r = await fetch(`${BASE}/api/matchday-kitchen/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip() }, body: JSON.stringify(body) });
  const cookie = (r.headers.get('set-cookie') || '').match(/ls_mdk=([^;]+)/)?.[1];
  const s = await fetch(`${BASE}/api/matchday-kitchen/session`, { headers: { Cookie: `ls_mdk=${cookie}` } }).then(x => x.json());
  const call = (path, b) => fetch(`${BASE}/api/matchday-kitchen/${path}`, b ? { method: 'POST', headers: { Cookie: `ls_mdk=${cookie}`, 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(b) } : { headers: { Cookie: `ls_mdk=${cookie}` } });
  return { s, call, json: async (p, b) => { const x = await call(p, b); return { status: x.status, data: await x.json().catch(() => ({})) }; } };
}
const seed = (day, i, channel, items, total) => { const id = `SR${i}${T}`; made.push(id); return `INSERT INTO food_orders (id, ref, seat, stand, phone, email, items_json, total_kobo, paystack_reference, payment_status, order_status, paid_iso, created_iso, channel, customer_name, venue_id) VALUES ('${id}', '${id}', 'A1', 'Popular Stand', '+2348031234567', 'fan@example.com', '${JSON.stringify(items)}', ${total}, 'r-${id}', 'paid', 'DELIVERED', '${day}T15:00:00.000Z', '${day}T15:00:00.000Z', '${channel}', 'Fan', 'venue-main');`; };

test('saving, opening, combining, downloading, and who can do what', async () => {
  await fetch(`${BASE}/api/food/menu`);
  await fetch(`${BASE}/api/matchday-kitchen/session`);
  sql(`INSERT INTO admin_users (id, name, email, password_hash, role, active, test_account) VALUES ('sr_${T}', 'SR Admin', '${EMAIL}', '${await hashPassword(PW)}', 'super_admin', 1, 1);` + seed(days[0], 1, 'paystack', [suya(2)], 200000) + seed(days[0], 2, 'whatsapp', [water(5)], 200000) + seed(days[1], 3, 'whatsapp', [suya(1)], 100000));
  const A = await as({ login: EMAIL, password: PW });
  const add = async (name, role) => { const x = await A.json('staff', { action: 'add', name: `SR ${name} ${T}`, role }); return as({ loginCode: x.data.loginCode }); };
  const S = await add('Sup', 'supervisor'), C = await add('Cook', 'cook'), P = await add('Pass', 'pass');
  for (const who of [C, P]) { assert.equal((await who.json('sales-reports')).status, 403); assert.equal((await who.json('sales-reports', { action: 'save', day: days[0] })).status, 403); }
  assert.equal((await fetch(`${BASE}/api/matchday-kitchen/sales-reports`)).status, 401);
  assert.equal((await S.json('sales-reports', { action: 'save', day: '2999-01-01' })).status, 400);
  assert.equal((await S.json('sales-reports', { action: 'save', day: '2019-01-01' })).status, 400, 'nothing sold that day');
  const r1 = (await S.json('sales-reports', { action: 'save', day: days[0] })).data, r2 = (await S.json('sales-reports', { action: 'save', day: days[1] })).data;
  assert.equal(r1.created, true); assert.ok(r2.reportNo > r1.reportNo);
  const one = (await S.json(`sales-report?nos=${r1.reportNo}`)).data;
  assert.equal(one.figures.total, '₦4,000'); assert.equal(one.figures.online.orders, 1); assert.equal(one.figures.whatsapp.orders, 1);
  assert.equal(one.figures.items[0].name, 'Water'); assert.equal(one.figures.items[0].qty, 5); assert.equal(one.pie.length, 2);
  assert.doesNotMatch(JSON.stringify(one), /8031234567|fan@example/, 'no customer details');
  // A report keeps its figures until someone updates it.
  sql(`UPDATE food_orders SET order_status = 'REFUNDED' WHERE id = 'SR2${T}';`);
  assert.equal((await S.json(`sales-report?nos=${r1.reportNo}`)).data.figures.total, '₦4,000');
  const again = (await S.json('sales-reports', { action: 'save', day: days[0] })).data;
  assert.equal(again.created, false); assert.equal(again.reportNo, r1.reportNo, 'same report number');
  const fresh = (await S.json(`sales-report?nos=${r1.reportNo}`)).data.figures;
  assert.equal(fresh.total, '₦2,000'); assert.equal(fresh.excluded.orders, 1);
  // Combined.
  const both = (await S.json(`sales-report?nos=${r2.reportNo},${r1.reportNo}`)).data;
  assert.equal(both.combined, true); assert.deepEqual(both.nos, [r1.reportNo, r2.reportNo]); assert.equal(both.figures.total, '₦3,000'); assert.equal(both.figures.items[0].qty, 3); assert.equal(both.parts.length, 2);
  assert.equal((await S.json('sales-report?nos=99999999')).status, 404);
  assert.equal((await S.json(`sales-report?nos=${r1.reportNo},99999999`)).status, 404, 'all or nothing');
  // Files.
  const pdf = await S.call(`sales-report-file?nos=${r1.reportNo},${r2.reportNo}&format=pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.match(pdf.headers.get('content-disposition'), /attachment; filename="MatchDay-Kitchen-Combined-Report/);
  assert.equal(String.fromCharCode(...new Uint8Array(await pdf.arrayBuffer()).slice(0, 5)), '%PDF-');
  const doc = await S.call(`sales-report-file?nos=${r1.reportNo}&format=docx`);
  assert.match(doc.headers.get('content-type'), /wordprocessingml/);
  assert.ok(unzipSync(new Uint8Array(await doc.arrayBuffer()))['word/document.xml']);
  assert.equal((await C.call(`sales-report-file?nos=${r1.reportNo}&format=pdf`)).status, 403);
  assert.ok(rows(`SELECT 1 FROM mk_activity WHERE action LIKE 'Downloaded Report ${r1.reportNo}:%'`).length);

  // A year: these two are old enough for a Super Admin; a new one isn't, whoever asks.
  const list = (await A.json('sales-reports')).data;
  assert.equal(list.canDelete, true); assert.equal(list.reports.find(x => x.no === r1.reportNo).canDelete, true);
  assert.equal((await S.json('sales-reports')).data.canDelete, false);
  assert.equal((await S.json('sales-reports', { action: 'delete', no: r1.reportNo })).status, 403, 'a supervisor cannot');
  sql(`INSERT INTO food_sales_reports (venue_id, day, title, data_json, created_at) VALUES ('venue-main', '${new Date(Date.now() - 86400e3).toISOString().slice(0, 10)}', 'Recent ${T}', '{"totalOrders":1,"totalKobo":100,"items":[]}', '${new Date().toISOString()}');`);
  const recent = (await A.json('sales-reports')).data.reports.find(x => x.title === `Recent ${T}`);
  assert.equal(recent.canDelete, false);
  const refused = await A.json('sales-reports', { action: 'delete', no: recent.no });
  assert.equal(refused.status, 403); assert.match(refused.data.error, /a year after/);
  assert.equal(rows(`SELECT COUNT(*) AS n FROM food_sales_reports WHERE report_no = ${recent.no}`)[0].n, 1, 'still there');
  assert.equal((await A.json('sales-reports', { action: 'delete', no: r2.reportNo })).status, 200);
  assert.equal(rows(`SELECT COUNT(*) AS n FROM food_sales_reports WHERE report_no = ${r2.reportNo}`)[0].n, 0);
  assert.ok(rows(`SELECT before_json FROM mk_activity WHERE action LIKE 'Deleted sales report ${r2.reportNo} %'`)[0].before_json, 'the figures stay in the log');
  assert.equal((await A.json('sales-reports', { action: 'delete', no: r2.reportNo })).status, 404);
  // A venue's supervisor doesn't see another venue's reports.
  sql(`INSERT INTO food_sales_reports (venue_id, day, title, data_json, created_at) VALUES ('other-${T}', '2021-04-01', 'Elsewhere ${T}', '{"totalOrders":1,"totalKobo":100,"items":[]}', '${new Date().toISOString()}');`);
  assert.ok(!(await S.json('sales-reports')).data.reports.some(x => x.title === `Elsewhere ${T}`));
  assert.ok((await A.json('sales-reports')).data.reports.some(x => x.title === `Elsewhere ${T}`));
  const far = rows(`SELECT report_no FROM food_sales_reports WHERE title = 'Elsewhere ${T}'`)[0].report_no;
  assert.equal((await S.json(`sales-report?nos=${far}`)).status, 404);
});

test('a report saves by itself after a home match, once', async t => {
  const kick = new Date(Date.now() - 5 * 3600e3).toISOString();
  const lagos = iso => new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 10);
  const today = lagos(new Date().toISOString());
  if (lagos(kick) !== today) return t.skip('too early in the day for a match 5 hours ago');
  const ev = `SRE${T}`;
  sql(`DELETE FROM food_sales_reports WHERE day = '${today}'; INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active, created_at, is_home) VALUES ('${ev}', 'Home ${T}', 'Away', 'League', '${kick}', 'Ground', 0, 0, 0, 1, '${kick}', 1);` + seed(today, 9, 'whatsapp', [suya(2)], 200000).replace(/'\d{4}-\d{2}-\d{2}T15:00:00.000Z'/g, `'${new Date(Date.now() - 3600e3).toISOString()}'`));
  try {
    const run = () => fetch(`${BASE}/api/internal/checklist-run`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` } });
    assert.equal((await run()).status, 200);
    const saved = rows(`SELECT report_no, title, data_json, created_by FROM food_sales_reports WHERE day = '${today}' AND venue_id = 'venue-main'`);
    assert.equal(saved.length, 1); assert.equal(saved[0].title, `Home ${T} vs Away`); assert.equal(saved[0].created_by, 'Automatic');
    assert.ok(JSON.parse(saved[0].data_json).whatsapp.orders >= 1);
    // Staff fix the figures by hand after this: the timer must not overwrite or repeat it.
    sql(`UPDATE food_sales_reports SET data_json = '{"totalOrders":99}' WHERE report_no = ${saved[0].report_no};`);
    await run();
    const again = rows(`SELECT data_json FROM food_sales_reports WHERE day = '${today}' AND venue_id = 'venue-main'`);
    assert.equal(again.length, 1); assert.equal(JSON.parse(again[0].data_json).totalOrders, 99);
  } finally {
    sql(`DELETE FROM events WHERE id = '${ev}'; DELETE FROM food_sales_reports WHERE day = '${today}'; DELETE FROM mk_settings WHERE key LIKE '%${ev}';`);
  }
});

after(() => {
  sql(`DELETE FROM food_sales_reports WHERE day IN ('${days.join("','")}') OR title LIKE '%${T}'; DELETE FROM food_orders WHERE id IN (${made.map(i => `'${i}'`).join(',') || "''"}); DELETE FROM mk_staff WHERE full_name LIKE 'SR %'; DELETE FROM admin_users WHERE email = '${EMAIL}';`);
});
