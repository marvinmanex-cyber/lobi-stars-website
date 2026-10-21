// AI Fix, the parts that need no server: checking Claude's answers (untrusted),
// cost estimates, recommendation categories and the fix whitelist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, validateJson, extractJson, costOf, priceOf, ASSUMED_PRICE, lagosMonth, AI_DEFAULTS, FEATURES } from '../functions/api/_lib/claude.js';
import { REC_TYPES, typeOf, typeInfo, FIX_ACTIONS } from '../functions/api/_lib/aiFix.js';

test("Claude's text is cleaned: no HTML, scripts, javascript: links or control characters", () => {
  assert.equal(cleanText('Buy <b>tickets</b><script>alert(1)</script> now'), 'Buy tickets now');
  assert.equal(cleanText('[x](javascript:alert(1))'), '[x](alert(1))');
  assert.equal(cleanText('a\u0000b\n\nc'), 'a b c', 'single line');
  assert.equal(cleanText('one\n\n\n\ntwo<img src=x onerror=alert(1)>', { multiline: true }), 'one\n\ntwo');
});

test('answers are checked against the schema: types, lengths, only known fields', () => {
  const schema = { title: { type: 'string', min: 20, max: 60 }, description: { type: 'string', min: 70, max: 155 }, flag: { type: 'boolean', optional: true } };
  const good = { title: 'Buy Lobi Stars Tickets Online | Lobi Stars FC', description: 'Official Lobi Stars FC tickets for every home match: pay online and get your QR ticket by email.', extra: 'dropped' };
  const v = validateJson(schema, good);
  assert.deepEqual(Object.keys(v.value), ['title', 'description']);
  assert.match(validateJson(schema, { ...good, title: 'x'.repeat(61) }).error, /too long/);
  assert.match(validateJson(schema, { ...good, description: 'short' }).error, /too short/);
  assert.match(validateJson(schema, { title: good.title }).error, /missing description/);
  assert.match(validateJson(schema, { ...good, title: 42 }).error, /must be text/);
  assert.match(validateJson(schema, { ...good, flag: 'yes' }).error, /true\/false/);
  assert.equal(validateJson(schema, null).error, 'not a JSON object');
  assert.equal(validateJson(schema, [1]).error, 'not a JSON object');
  assert.equal(validateJson({ t: { type: 'string', max: 30 } }, { t: '<b>' + 'x'.repeat(28) + '</b>' }).value.t.length, 28, 'length counted after cleaning');
});

test('the JSON is found inside a reply, even in a code fence; nonsense gives null', () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('{broken'), null);
});

test('cost: the Super Admin prices, or the safe assumption; batches at half price', () => {
  const s = { 'price:claude-haiku-5-5:in': '1', 'price:claude-haiku-5-5:out': '5' };
  assert.deepEqual(priceOf(s, 'claude-haiku-5-5'), { in: 1, out: 5, assumed: false });
  assert.equal(priceOf({}, 'claude-haiku-5-5').assumed, true);
  assert.equal(priceOf({}, 'x').in, ASSUMED_PRICE.in);
  assert.equal(costOf(s, 'claude-haiku-5-5', 1_000_000, 100_000), 1.5);
  assert.equal(costOf(s, 'claude-haiku-5-5', 1_000_000, 100_000, true), 0.75);
  assert.match(lagosMonth(Date.parse('2026-10-31T23:30:00Z')), /^2026-11$/, 'Lagos month (UTC+1)');
});

test('lowest cost by default: every feature uses the cheap model; only the sync re-run is auto-applied', () => {
  for (const f of FEATURES) assert.equal(AI_DEFAULTS[`model_${f}`], 'default', f);
  assert.equal(AI_DEFAULTS.auto_apply_types, 'rerun_sync');
  assert.equal(AI_DEFAULTS.monthly_budget, '10');
});

test('every recommendation type has a category; payments, phones and layout are never automatic', () => {
  const ids = ['setup:gsc', 'setup:stale', 'ctr:/tickets/', 'rank:lobi stars', 'index:/kitchen/', 'trend:gsc-down', 'ux:mobile', 'eng:/news/', 'funnel:ticket_purchase_start', 'funnel:kitchen_order_start', 'grow:newsletter', 'grow:social', 'grow:diaspora'];
  for (const id of ids) assert.ok(REC_TYPES[typeOf(id)], id);
  for (const id of ['funnel:ticket_purchase_start', 'funnel:kitchen_order_start', 'ux:mobile', 'eng:/news/']) {
    assert.equal(typeInfo(id).category, 'manual_only'); assert.equal(typeInfo(id).risk, 'high'); assert.equal(typeInfo(id).fix, null);
  }
  assert.equal(typeInfo('ctr:/tickets/').fix, 'seo_title_description');
  assert.equal(typeInfo('rank:lobi stars').category, 'input_needed');
  assert.equal(typeInfo('unknown:thing').category, 'manual_only', 'unknown types are never automatic');
  for (const t of Object.values(REC_TYPES)) if (t.fix) assert.ok(FIX_ACTIONS[t.fix], t.fix);
});

test('the fix whitelist: small output limits, schemas for every Claude fix, inputs where facts are needed', () => {
  for (const [id, f] of Object.entries(FIX_ACTIONS)) {
    if (!f.claude) continue;
    assert.ok(f.schema && f.prompt && f.system && f.facts, id);
    assert.ok(f.maxTokens <= 1200, `${id}: max_tokens ${f.maxTokens}`);
  }
  assert.ok(FIX_ACTIONS.draft_news.input && !FIX_ACTIONS.draft_news.input.optional, 'news needs real facts from staff');
  assert.ok(FIX_ACTIONS.seo_title_description.undo && FIX_ACTIONS.draft_news.undo, 'changes to the website can be undone');
  const prompt = FIX_ACTIONS.seo_title_description.prompt({ path: '/tickets/', currentTitle: 'Tickets' });
  assert.ok(prompt.length < 1200, 'short prompt');
});
