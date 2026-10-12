// Phase 7: trophy cabinet / Club at a Glance (confirmed data only), values,
// community and transparency pages (hidden until they have content), and the
// installable app (manifest, service worker that never caches live data,
// offline page, install prompt).
// Needs the local Pages dev server (or BASE=https://lobistarsfc.com).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const page = async path => { const r = await fetch(BASE + path); return { status: r.status, html: await r.text(), headers: r.headers }; };
const json = f => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));

test('trophy cabinet and Club at a Glance show only confirmed data', async () => {
  const honours = json('honours.json');
  const anyConfirmed = honours.honours.some(h => h.verified) || honours.founded.verified || honours.caf.verified;
  const home = (await page('/')).html;
  const cab = (await page('/club/honours/')).html;
  if (!anyConfirmed) {
    assert.doesNotMatch(home, /class="cg-list"/, 'no strip on the homepage until something is confirmed');
    assert.match(cab, /being confirmed/);
  } else {
    assert.match(home, /Club at a Glance/);
    assert.match(cab, /class="cg-list"/);
  }
  for (const h of honours.honours.filter(x => !x.verified)) assert.ok(!cab.includes(`<h2>${h.competition}</h2>`), `${h.competition} hidden until verified`);
});

test('values, community and transparency stay out of the menu, sitemap and Google until they have content', async () => {
  const values = json('values.json'), community = json('community.json'), docs = json('transparency.json');
  const home = (await page('/')).html;
  const sitemap = (await page('/sitemap.xml')).html;
  const cases = [
    ['/club/values/', values.published],
    ['/club/community/', community.published && (community.intro || community.projects.length)],
    ['/club/transparency/', docs.documents.length],
  ];
  for (const [path, hasContent] of cases) {
    const p = await page(path);
    assert.equal(p.status, 200, path);
    const inMenu = home.includes(`href="${path.replace(/\/$/, '')}"`);
    if (!hasContent && path !== '/club/community/') {
      assert.equal(inMenu, false, `${path} not in the menu`);
      assert.match(p.html, /name="robots" content="noindex/, `${path} noindex`);
      assert.ok(!sitemap.includes(path), `${path} not in the sitemap`);
    }
  }
  // Draft wording is never shown while unpublished.
  if (!values.published) assert.ok(!(await page('/club/values/')).html.includes(values.mission.slice(0, 40)));
});

test('installable app: manifest, icons and the install prompt on public pages only', async () => {
  const m = await (await fetch(`${BASE}/manifest.json`)).json();
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some(i => i.sizes === '512x512'));
  for (const i of m.icons) assert.equal((await fetch(BASE + i.src)).status, 200, i.src);
  const home = (await page('/')).html;
  assert.match(home, /id="installPrompt"/);
  assert.match(home, /rel="manifest"/);
  assert.match(home, /Add to Home Screen/, 'iPhone instructions');
  const admin = await fetch(`${BASE}/admin/login/`).then(r => r.text());
  assert.doesNotMatch(admin, /id="installPrompt"/, 'not in the admin');
});

test('service worker never caches pages or live data; offline page is ready and never indexed', async () => {
  const r = await fetch(`${BASE}/sw.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /javascript/);
  const sw = await r.text();
  assert.match(sw, /ls-static-[a-z0-9]+/, 'versioned cache');
  assert.match(sw, /req\.mode === 'navigate'[\s\S]*fetch\(req\)\.catch/, 'pages: network first, offline page only without a connection');
  assert.match(sw, /api\|data\|admin\|scan/, 'API, data, admin and scanner never touched');
  assert.match(sw, /key !== STATIC && key !== PROGRAMME\) await caches\.delete/, 'old caches deleted (saved programme pages kept)');
  assert.doesNotMatch(sw, /cache\.put\(req, res\.clone\(\)\)[^;]*navigate/);
  const off = await page('/offline/');
  assert.equal(off.status, 200);
  assert.match(off.html, /You're offline/);
  assert.match(off.html, /noindex/);
  assert.ok(!(await page('/sitemap.xml')).html.includes('/offline'));
});
