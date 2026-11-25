// No-branding-leak test (runs in every build: npm run build, and with npm test).
// Fails if the name of the outside ticketing system ("the ticketing engine") appears anywhere
// fans could see it or anywhere in this repository: every page, script, style, source map,
// response-header file and the built server code in dist/, and every text file of the project
// (ticket and email templates, PDF and QR code makers, SMS text, docs, tests).
//
// The name itself is NOT written here (that would leak it): only SHA-256 fingerprints of it.
// The text is cut into words (case-insensitive; "-", "_" and spaces join two words, so
// "Word1Word2", "word1 word2", "word1-word2" and "word1word2.com" are all caught). More names
// can be added at build time: BRAND_LEAK_TERMS="name one,othername" (a Cloudflare build variable).
// The one allowed mention of the payment company, the "Payments processed by …" receipt line,
// comes from a Super Admin setting at runtime, so it is never in these files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// SHA-256 of the forbidden word (the joined name). Length kept so only words of that length are hashed.
const FINGERPRINTS = [{ len: 11, sha: 'e76b167470750ccb6d70403ffcf44a413ed426cd1525a13dc467ec71a616c1f0' }];
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const extra = String(process.env.BRAND_LEAK_TERMS || '').split(',').map(norm).filter(t => t.length >= 4).map(t => ({ len: t.length, sha: sha(t) }));
const TARGETS = [...FINGERPRINTS, ...extra];
const LENGTHS = new Set(TARGETS.map(t => t.len));
const SHAS = new Set(TARGETS.map(t => t.sha));

const TEXT = /\.(html?|js|mjs|cjs|ts|tsx|astro|css|map|json|md|txt|xml|yml|yaml|toml|svg|webmanifest|sql|sh|ics|csv)$|(^|[\\/])_(headers|redirects)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', '.astro', '.cache', 'test-results']);

/** Every word, and every two words joined by space / "-" / "_" (not across other punctuation). */
export function findLeaks(text) {
  const hits = [];
  const lower = String(text).toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9]+(?:[\s_-]+[a-z0-9]+)*/g)) {
    const words = m[0].split(/[\s_-]+/);
    for (let i = 0; i < words.length; i++) {
      const one = words[i];
      if (LENGTHS.has(one.length) && SHAS.has(sha(one))) hits.push(m.index);
      const two = one + (words[i + 1] || '');
      if (words[i + 1] && LENGTHS.has(two.length) && SHAS.has(sha(two))) hits.push(m.index);
    }
  }
  return hits;
}

function* walk(dir) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of list) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name)); }
    else if (TEXT.test(e.name)) yield path.join(dir, e.name);
  }
}
function scan(dir) {
  const bad = [];
  for (const f of walk(dir)) {
    if (fs.statSync(f).size > 30 * 1024 * 1024) continue;
    const text = fs.readFileSync(f, 'utf8');
    const hits = findLeaks(text);
    if (hits.length) bad.push(`${path.relative(root, f)} (line ${text.slice(0, hits[0]).split('\n').length})`);
  }
  return bad;
}

test('the checker itself works (a made-up name is caught in all its spellings)', () => {
  const name = 'Zorblex Quantar';
  const save = [...LENGTHS], saveS = [...SHAS];
  const t = norm(name); LENGTHS.add(t.length); SHAS.add(sha(t));
  for (const s of ['zorblexquantar', 'ZorblexQuantar', 'Zorblex Quantar', 'zorblex-quantar', 'https://zorblexquantar.com/x', 'a "Zorblex_Quantar" b'])
    assert.ok(findLeaks(s).length, s);
  for (const s of ['Zorblex. Quantar', 'zorblex, quantar', 'quantar zorblex']) assert.equal(findLeaks(s).length, 0, s);
  LENGTHS.clear(); save.forEach(x => LENGTHS.add(x)); SHAS.clear(); saveS.forEach(x => SHAS.add(x));
});

test('no mention of the outside ticketing system in the project files', () => {
  const bad = [];
  for (const dir of ['src', 'functions', 'public', 'scripts', 'docs', 'tests', 'integrations', 'migrations']) bad.push(...scan(path.join(root, dir)));
  for (const f of fs.readdirSync(root)) if (TEXT.test(f) && fs.statSync(path.join(root, f)).isFile()) { const t = fs.readFileSync(path.join(root, f), 'utf8'); if (findLeaks(t).length) bad.push(f); }
  assert.deepEqual(bad, [], `The outside ticketing system is named in: ${bad.join(', ')}`);
});

test('no mention in anything built for fans (pages, scripts, source maps, headers, server code)', { skip: !fs.existsSync(path.join(root, 'dist')) && 'no dist/ yet (run npm run build)' }, () => {
  const bad = scan(path.join(root, 'dist'));
  assert.deepEqual(bad, [], `The outside ticketing system is named in the built site: ${bad.join(', ')}`);
});
