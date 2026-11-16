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
