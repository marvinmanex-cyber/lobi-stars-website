// The SEO Scanner's free (no-AI) fallback and the page title helpers (Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { freeMeta, freeAlt, checkMeta } from '../functions/api/_lib/seoFix.js';
import { isSocialLink } from '../functions/api/_lib/seoAnalyse.js';

test('free title and description fit Google limits and pass the checks', () => {
  const m = freeMeta({ title: 'x', h1: ['MATCH REPORT FOGA FIRES LOBI STARS TO WINNING START IN NNL'], firstPara: 'Lobi Stars beat Bichi First 1-0 at the McCarthy Stadium, Makurdi, to start the NNL season with a win in front of a big crowd.' });
  assert.ok(m.title.length >= 30 && m.title.length <= 60, m.title);
  assert.ok(m.description.length >= 70 && m.description.length <= 160, m.description);
  assert.match(m.title, /^Match Report Foga Fires/);
  assert.match(m.title, /NNL/);
  assert.deepEqual(checkMeta(m).problems, []);
});
test('short pages get a true, complete description', () => {
  const m = freeMeta({ title: 'Lobi Stars News | Lobi Stars FC', h1: ['Lobi Stars News'], firstPara: 'The latest news.' });
  assert.equal(m.title, 'Lobi Stars News | Lobi Stars FC');
  assert.ok(m.description.length >= 70);
});
test('free alt text names the page and the photo number', () => {
  assert.equal(freeAlt('Kada Warriors vs Lobi Stars', 2, 6), 'Photo 2 of 6: Kada Warriors vs Lobi Stars');
  assert.equal(freeAlt('', 1, 1), 'Photo: Lobi Stars FC');
});
test('social network links are never reported as broken', () => {
  for (const u of ['https://www.instagram.com/lobistarsfc', 'https://x.com/lobistars', 'https://web.facebook.com/x', 'https://wa.me/234']) assert.equal(isSocialLink(u), true, u);
  for (const u of ['https://nnl.ng/', 'https://box.com/', 'https://notx.com/']) assert.equal(isSocialLink(u), false, u);
});

test('a speed test that did not finish (no main-content time) is not reported as 0/100', async () => {
  const { computeIssues } = await import('../functions/api/_lib/seoAnalyse.js');
  const speed = {
    '/news/a/': { mobile: { score: 0, lcp: 0, cls: 0, fcp: 0.97 } },
    '/news/b/': { mobile: { score: 30, lcp: 6.2, cls: 0.02, fcp: 2 } },
  };
  const out = computeIssues({ pages: [], ran: { speed: true }, speed });
  const found = out.filter(i => i.type.startsWith('speed') || i.type === 'cwv_poor').map(i => `${i.type} ${i.path}`);
  assert.ok(!found.some(x => x.includes('/news/a/')), found.join(', '));
  assert.ok(found.includes('speed_poor /news/b/'), found.join(', '));
});

test('AI Fix is greyed out for 24 hours after a fix is recorded, unless the issue is still there', async () => {
  const { fixProgress } = await import('../functions/api/_lib/seoFix.js');
  const now = Date.parse('2026-11-18T12:00:00Z'), ago = h => new Date(now - h * 3600e3).toISOString();
  const issue = { type: 'title_length' };
  // Applied 2 hours ago, not checked again yet: locked, and says when it opens again.
  let p = fixProgress(issue, { status: 'applied', applied_at: ago(2) }, null, now);
  assert.equal(p.lock, true); assert.match(p.button, /opens again/);
  // Checked again after the fix and still open: unlocked at once.
  p = fixProgress(issue, { status: 'applied', applied_at: ago(2) }, ago(1), now);
  assert.equal(p.state, 'still_open'); assert.equal(p.lock, false);
  // After 24 hours: open again.
  assert.equal(fixProgress(issue, { status: 'applied', applied_at: ago(25) }, null, now).lock, false);
  // A VS Code instruction or a suggestion counts as a recorded fix too.
  assert.equal(fixProgress({ type: 'h1_missing' }, { status: 'instruction', created_at: ago(3) }, null, now).lock, true);
  assert.equal(fixProgress({ type: 'thin_page' }, { status: 'draft', created_at: ago(30) }, null, now).lock, false);
  // Google-figure issues keep the longer wait.
  p = fixProgress({ type: 'almost_top' }, { status: 'applied', applied_at: ago(48) }, null, now);
  assert.equal(p.state, 'waiting_google'); assert.equal(p.lock, true);
  // A fix waiting for approval is never locked (pressing AI Fix shows it again).
  assert.equal(fixProgress(issue, { status: 'proposed', created_at: ago(1) }, null, now).lock, false);
});

test('near-duplicates are judged on the main content, not the menu and other shared parts', async () => {
  const { analysePage } = await import('../functions/api/_lib/seoCrawl.js');
  const shared = Array.from({ length: 300 }, (_, i) => `menu${i % 50} promo${i % 37}`).join(' ');
  const page = main => `<html><head><title>x</title></head><body><div class="drawer">${shared}</div><main id="main"><h1>Match</h1><p>${main}</p></main><div class="cookie">${shared}</div></body></html>`;
  const a = analysePage(page(Array.from({ length: 160 }, (_, i) => `alpha${i}`).join(' ')), { origin: 'https://example.com', path: '/a/' });
  const b = analysePage(page(Array.from({ length: 160 }, (_, i) => `beta${i}`).join(' ')), { origin: 'https://example.com', path: '/b/' });
  assert.ok(a.mainWords >= 160 && a.mainWords < 200, String(a.mainWords));
  const common = a.fp.filter(h => b.fp.includes(h)).length;
  assert.equal(common, 0);
});
