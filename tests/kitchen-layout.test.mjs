// MatchDay Kitchen (/kitchen/) layout guard: runs the real page in headless Edge
// at phone, tablet and desktop sizes and checks what keeps breaking:
//   - the seat bar sits exactly under the visible site header (no gap the menu
//     scrolls through), both when the header slides away on scroll down and when
//     it comes back on scroll up; the category tabs sit exactly under the seat bar
//   - nothing is wider than the screen (no sideways page scroll)
//   - the seat fields and the category tabs stay on screen
//   - the order drawer fits the screen
// Skipped when Microsoft Edge is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SIZES = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'small phone', width: 360, height: 740, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true },
  { name: 'desktop', width: 1366, height: 820, mobile: false },
];

async function browser() {
  const prof = mkdtempSync(path.join(tmpdir(), 'kxedge-')), port = 9700 + Math.floor(Math.random() * 200);
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let list; for (let i = 0; i < 60; i++) { try { list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()); break; } catch { await sleep(250); } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Page.enable');
  return { send, ev, close: () => { try { ws.close(); } catch { /* */ } proc.kill(); } };
}

// Where things are: header visible bottom, seat bar top/bottom, tabs top.
const MEASURE = `(() => {
  const h = document.getElementById('siteHeader').getBoundingClientRect();
  const s = document.getElementById('kxSeatBar').getBoundingClientRect();
  const t = document.querySelector('.kx-tabs').getBoundingClientRect();
  return { headerBottom: Math.max(0, Math.round(h.bottom)), seatTop: Math.round(s.top), seatBottom: Math.round(s.bottom), tabsTop: Math.round(t.top), y: Math.round(scrollY) };
})()`;

test('MatchDay Kitchen layout on phone, tablet and desktop', { skip: !EDGE && 'Microsoft Edge not installed' }, async () => {
  const b = await browser();
  try {
    for (const sz of SIZES) {
      await b.send('Emulation.setDeviceMetricsOverride', { width: sz.width, height: sz.height, deviceScaleFactor: 1, mobile: sz.mobile });
      await b.send('Emulation.setTouchEmulationEnabled', { enabled: sz.mobile });
      await b.send('Page.navigate', { url: `${BASE}/kitchen/` });
      for (let i = 0; i < 40 && !(await b.ev(`!!document.querySelector('.kx-card')`)); i++) await sleep(250);
      assert.ok(await b.ev(`!!document.querySelector('.kx-card')`), `${sz.name}: the menu loads`);
      await b.ev(`document.querySelector('.cookie-banner, #cookieBanner, [data-cookie-banner]')?.remove(); true`);
      // No sideways scrolling, and every seat field and the first tab are on screen.
      const wide = await b.ev(`(() => { const W = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('.kx *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > W + 1 || r.left < -1) && !el.closest('.kx-tabs .kx-wrap'); }).slice(0, 5).map(el => el.className || el.tagName); return { scroll: document.documentElement.scrollWidth - W, bad }; })()`);
      assert.ok(wide.scroll <= 1, `${sz.name}: the page is ${wide.scroll}px wider than the screen`);
      assert.deepEqual(wide.bad, [], `${sz.name}: elements off screen`);
      // Scroll down in steps (the header slides away on phones and tablets), then check.
      for (let y = 200; y <= 1600; y += 200) { await b.ev(`scrollTo(0, ${y}); dispatchEvent(new Event('scroll')); true`); await sleep(60); }
      await sleep(700);
      let m = await b.ev(MEASURE);
      assert.ok(m.y > 400, `${sz.name}: the page scrolled`);
      assert.ok(Math.abs(m.seatTop - m.headerBottom) <= 2, `${sz.name} (scrolled down): seat bar at ${m.seatTop}px but the header ends at ${m.headerBottom}px`);
      assert.ok(Math.abs(m.tabsTop - m.seatBottom) <= 2, `${sz.name} (scrolled down): tabs at ${m.tabsTop}px, seat bar ends at ${m.seatBottom}px`);
      // Scroll up a little: the header comes back; the bars move under it.
      for (let y = m.y - 40; y >= m.y - 200; y -= 40) { await b.ev(`scrollTo(0, ${y}); dispatchEvent(new Event('scroll')); true`); await sleep(60); }
      await sleep(700);
      m = await b.ev(MEASURE);
      assert.ok(m.headerBottom > 0, `${sz.name}: the header shows again on scroll up`);
      assert.ok(Math.abs(m.seatTop - m.headerBottom) <= 2, `${sz.name} (scrolled up): seat bar at ${m.seatTop}px but the header ends at ${m.headerBottom}px`);
      assert.ok(Math.abs(m.tabsTop - m.seatBottom) <= 2, `${sz.name} (scrolled up): tabs at ${m.tabsTop}px, seat bar ends at ${m.seatBottom}px`);
      // The order drawer fits the screen.
      await b.ev(`document.getElementById('kxCartBtn').click(); true`); await sleep(400);
      const d = await b.ev(`(() => { const r = document.getElementById('kxDrawer').getBoundingClientRect(); return { open: document.getElementById('kxDrawer').open, top: r.top, bottom: r.bottom, left: r.left, right: r.right, W: innerWidth, H: innerHeight }; })()`);
      assert.ok(d.open, `${sz.name}: the order drawer opens`);
      assert.ok(d.top >= -1 && d.bottom <= d.H + 1 && d.left >= -1 && d.right <= d.W + 1, `${sz.name}: the order drawer fits the screen ${JSON.stringify(d)}`);
      await b.ev(`document.getElementById('kxClose').click(); true`);
      // Typing on a phone or tablet: the bottom menu and cart bar step aside (iPhones float them over the form otherwise).
      if (sz.mobile) {
        // A tap on the field (a real tap gives the page focus first, which a background test window lacks).
        await b.send('Page.bringToFront'); await b.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        await b.ev(`document.getElementById('kxRow').focus(); true`); await sleep(250);
        const kb = await b.ev(`({ open: document.documentElement.classList.contains('kb-open'), tb: getComputedStyle(document.querySelector('.tb') || document.body).display, bar: getComputedStyle(document.getElementById('kxBar')).display })`);
        assert.ok(kb.open, `${sz.name}: typing is noticed`);
        assert.equal(kb.bar, 'none', `${sz.name}: the cart bar hides while typing`);
        if (sz.width < 768) assert.equal(kb.tb, 'none', `${sz.name}: the bottom menu hides while typing`);
        await b.ev(`document.activeElement.blur(); true`); await sleep(300);
        assert.equal(await b.ev(`document.documentElement.classList.contains('kb-open')`), false, `${sz.name}: the bars come back after typing`);
      }
    }
  } finally { b.close(); }
});
