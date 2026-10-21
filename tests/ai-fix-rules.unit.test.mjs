// AI Fix rules tested directly (in-memory database, no server, no AI, no cost):
// mock mode, the budget warning (logged email) and stop, the auto-apply rule,
// verify, weekly duplicate protection, personal data removal, the model choice,
// edits checked like Claude's answers, and code proposal edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1shim.mjs';
import { callClaude, budgetCheck, scrubPersonal, modelFor, ensureAiSchema, saveAiSetting, lagosMonth, estimateCost, mockFromSchema, AI_DEFAULTS } from '../functions/api/_lib/claude.js';
import { canAutoApply, FIX_ACTIONS, LONG_FORM_TYPES, verifyApplied, weeklyScan, editFix, cleanInput, lagosWeek } from '../functions/api/_lib/aiFix.js';
import { applyEdits, pageFileCandidates } from '../functions/api/_lib/codeProposal.js';
import { metricFor, verdict } from '../functions/api/_lib/aiMetrics.js';

// Each test gets its own empty database with the AI tables (from the migrations).
const AI_SQL = ['migrations/0007_ai_fix.sql', 'migrations/0008_ai_fix_history.sql'].map(f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
const fresh = async (extra = {}) => { const DB = d1(); DB.exec(AI_SQL); await ensureAiSchema(DB); return { DB, CLAUDE_MOCK: 'true', ...extra }; };
const spend = (env, usd) => env.DB.prepare(`INSERT INTO ai_usage_log (feature, model, estimated_cost, success, month, created_at) VALUES ('fix', 'x', ?, 1, ?, ?)`).bind(usd, lagosMonth(), new Date().toISOString()).run();
const log = async (env, action) => (await env.DB.prepare(`SELECT * FROM ai_fix_log WHERE action = ? ORDER BY id`).bind(action).all()).results;

test('mock mode: answers that pass the schema, no API call, nothing spent, still logged', async () => {
  const env = await fresh();
  const schema = FIX_ACTIONS.seo_title_description.schema;
  const r = await callClaude(env, { feature: 'fix', system: 's', prompt: 'p', schema });
  assert.equal(r.ok, true);
  assert.equal(r.model, 'mock');
  assert.equal(r.cost, 0);
  assert.ok(r.data.title.length >= 20 && r.data.title.length <= 60);
  const used = await env.DB.prepare(`SELECT model, estimated_cost FROM ai_usage_log`).first();
  assert.deepEqual(used, { model: 'mock', estimated_cost: 0 });
  const needs = await callClaude(env, { feature: 'fix', system: 's', prompt: 'needs-test', schema, allowNeeds: true });
  assert.match(needs.needs, /what was the final score/i, 'Claude asks instead of inventing');
  for (const [k, f] of Object.entries(FIX_ACTIONS)) if (f.schema) assert.ok(mockFromSchema(f.schema), k);
});

test('budget: one warning email (logged) at 80%, stop at 100% except Test connection', async () => {
  const env = await fresh();
  await spend(env, 8.5);
  assert.equal((await budgetCheck(env)).ok, true, 'still allowed at 85%');
  await budgetCheck(env);
  const mails = await log(env, 'email');
  assert.equal(mails.length, 1, 'warned once a month');
  assert.match(mails[0].detail, /budget_warning: AI budget: 85% of this month's \$10 used/);
  await spend(env, 2);
  const blocked = await budgetCheck(env);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Monthly AI budget reached/);
  assert.equal((await callClaude(env, { feature: 'fix', system: 's', prompt: 'p' })).ok, false);
  assert.equal((await callClaude(env, { feature: 'test', system: 's', prompt: 'p', urgent: true })).ok, true, 'Test connection still works');
  await saveAiSetting(env.DB, 'monthly_budget', 20);
  assert.equal((await budgetCheck(env)).ok, true, 'raising the limit unblocks');
});

test('auto-apply ONLY when on, low risk, allowed, nothing to overwrite, valid and no facts to check', () => {
  const ok = { enabled: true, risk: 'low', fixType: 'rerun_sync', allowed: ['rerun_sync'], targetEmpty: true, valid: true, factual: false };
  assert.equal(canAutoApply(ok), true);
  assert.equal(canAutoApply({ ...ok, targetEmpty: false }), false, 'low risk but the field already has content: goes to approval');
  assert.equal(canAutoApply({ ...ok, enabled: false }), false);
  assert.equal(canAutoApply({ ...ok, risk: 'normal' }), false);
  assert.equal(canAutoApply({ ...ok, allowed: [] }), false);
  assert.equal(canAutoApply({ ...ok, valid: false }), false);
  assert.equal(canAutoApply({ ...ok, factual: true }), false, 'facts are never applied automatically');
  for (const [k, f] of Object.entries(FIX_ACTIONS)) {
    if (f.needsGithub || f.factual) assert.equal(canAutoApply({ ...ok, fixType: k, risk: f.risk || 'normal', allowed: [k], factual: !!f.factual }) && !f.factual && (f.risk === 'low'), false, `${k} needs approval`);
  }
  assert.equal(AI_DEFAULTS.auto_apply_types, 'rerun_sync');
});

test('model choice: cheap everywhere by default; advanced only where chosen (long writing, code)', async () => {
  const env = { CLAUDE_MODEL_DEFAULT: 'cheap-model', CLAUDE_MODEL_ADVANCED: 'big-model' };
  assert.equal(modelFor(env, AI_DEFAULTS, 'fix', 'draft_news'), 'cheap-model');
  assert.equal(modelFor(env, { ...AI_DEFAULTS, model_task_draft_news: 'advanced' }, 'fix', 'draft_news'), 'big-model');
  assert.equal(modelFor(env, { ...AI_DEFAULTS, model_task_draft_news: 'advanced' }, 'fix', 'seo_title_description'), 'cheap-model', 'other fix types stay cheap');
  assert.equal(modelFor(env, { ...AI_DEFAULTS, model_code_proposal: 'advanced' }, 'code_proposal'), 'big-model');
  assert.deepEqual(LONG_FORM_TYPES, ['draft_news']);
  assert.ok(estimateCost({}, 'cheap-model', 3500, 1000) > 0 && estimateCost({}, 'cheap-model', 3500, 1000, true) < estimateCost({}, 'cheap-model', 3500, 1000), 'batch is cheaper');
});

test('personal data is removed from what staff type (emails, phone and card numbers); dates and scores stay', () => {
  const s = scrubPersonal('Ring Ada on 0803 123 4567 or +234 803 123 4567, mail ada.obi@gmail.com. Kick-off 2026-11-08 16:00, 08/11/2026, won 2-1 before 4,500 fans. Card 4111 1111 1111 1111.');
  assert.doesNotMatch(s, /0803|803 123|ada\.obi|4111/);
  assert.match(s, /2026-11-08 16:00/); assert.match(s, /08\/11\/2026/); assert.match(s, /2-1/); assert.match(s, /4,500/);
  const c = cleanInput(FIX_ACTIONS.draft_news, { text: 'The coach said we will win. Call 08031234567 for tickets please, thanks.' });
  assert.equal(c.value.scrubbed, true);
  assert.doesNotMatch(c.value.text, /08031234567/);
});

test('edits are checked like Claude\'s answers before they can be applied', async () => {
  const env = await fresh();
  await env.DB.prepare(`INSERT INTO ai_recommendation_meta (rec_id, rec_type, title, category, risk, fix_type, status, proposal_json) VALUES ('ctr:/x/', 'ctr', 'X', 'auto_fix', 'normal', 'seo_title_description', 'awaiting_approval', ?)`)
    .bind(JSON.stringify({ title: 'Buy Lobi Stars Tickets Online | Lobi Stars FC', description: 'Official tickets for every Lobi Stars home match: pay online in a minute and get your QR ticket by email.' })).run();
  assert.match((await editFix(env, 'ctr:/x/', { name: 'Ada' }, { title: 'Too short' })).error, /too short/);
  assert.equal((await editFix(env, 'ctr:/x/', { name: 'Ada' }, { title: 'Lobi Stars Home Tickets <b>Online</b> | Lobi Stars FC' })).ok, true);
  const p = JSON.parse((await env.DB.prepare(`SELECT proposal_json FROM ai_recommendation_meta`).first()).proposal_json);
  assert.equal(p.title, 'Lobi Stars Home Tickets Online | Lobi Stars FC', 'HTML removed');
  assert.equal(p.edited, true);
  assert.equal((await log(env, 'edited')).length, 1);
});

test('verify: "failed" when the change never shows on the live page after 2 days; checked once per fix', async () => {
  const env = await fresh({ SITE_URL: 'http://127.0.0.1:9' }); // nothing listens: the live title can't be seen
  const old = new Date(Date.now() - 3 * 864e5).toISOString();
  await env.DB.prepare(`INSERT INTO ai_recommendation_meta (rec_id, rec_type, title, category, risk, fix_type, status, proposal_json, applied_json) VALUES ('ctr:/y/', 'ctr', 'Y', 'auto_fix', 'normal', 'seo_title_description', 'applied', ?, ?)`)
    .bind(JSON.stringify({ title: 'New title for the page here', description: 'x'.repeat(80) }), JSON.stringify({ path: '/y/', at: old })).run();
  // currentInsights needs the analytics tables: an empty site has no recommendations.
  const r = await verifyApplied(env);
  assert.deepEqual(r, { verified: 0, failed: 1 });
  const m = await env.DB.prepare(`SELECT status, error FROM ai_recommendation_meta`).first();
  assert.equal(m.status, 'failed');
  assert.match(m.error, /not showing on the live website/);
});

test('weekly check-up runs once a week only, at the chosen day and time (Lagos)', async () => {
  const env = await fresh();
  const monday = Date.parse('2026-10-26T06:30:00Z'); // Monday 07:30 in Lagos
  await saveAiSetting(env.DB, 'weekly_scan_day', '1'); await saveAiSetting(env.DB, 'weekly_scan_time', '07:00');
  await saveAiSetting(env.DB, 'auto_apply_enabled', '0'); // (preparing fixes needs Analytics data; covered by the server test)
  assert.equal(await weeklyScan(env, { now: monday - 3600e3 }), null, 'before 07:00: not yet');
  const first = await weeklyScan(env, { now: monday });
  assert.ok(first && first.week === lagosWeek(monday), JSON.stringify(first));
  assert.equal(await weeklyScan(env, { now: monday + 60e3 }), null, 'second run the same week: nothing');
  assert.equal((await log(env, 'email')).filter(m => /weekly_summary/.test(m.detail)).length, 1, 'one summary email (logged)');
  assert.equal(await weeklyScan(env, { now: monday + 864e5 }), null, 'Tuesday: not the chosen day');
});

test('code proposals: each change must match the file exactly once; page paths map to page files', () => {
  const file = '<h1>Tickets</h1>\n<p>Buy now</p>\n<p>Buy now</p>';
  assert.deepEqual(applyEdits(file, [{ find: '<h1>Tickets</h1>', replace: '<h1>Match tickets</h1>' }]), { text: '<h1>Match tickets</h1>\n<p>Buy now</p>\n<p>Buy now</p>' });
  assert.match(applyEdits(file, [{ find: '<p>Buy now</p>', replace: 'x' }]).error, /appears 2 times/);
  assert.match(applyEdits(file, [{ find: 'missing', replace: 'x' }]).error, /appears 0 times/);
  assert.match(applyEdits(file, [{ find: '<h1>Tickets</h1>', replace: '<script src="https://evil.example/x.js"></script>' }]).error, /outside script/);
  assert.match(applyEdits(file, []).error, /no edits/);
  assert.deepEqual(pageFileCandidates('/tickets/'), ['src/pages/tickets/index.astro', 'src/pages/tickets.astro']);
  assert.deepEqual(pageFileCandidates('/../../wrangler'), [], 'nothing outside the pages');
});

test('fix results: the right figure per recommendation and better/worse judged the right way', () => {
  const f = { gsc: { pages: [{ path: '/tickets/', clicks: 10, impressions: 500, position: 6 }], queries: [{ value: 'lobi stars', position: 7.4, clicks: 3, impressions: 90 }], now: { clicks: 50 }, prev: { clicks: 80 }, countries: [] },
    ga4: { pages: [], devices: [], events: {}, now: { sessions: 0 } }, own: { now: 1000, sources: { WhatsApp: 20 }, events: { newsletter_signup: 2 } }, latest: { gsc: '2026-10-20' } };
  assert.equal(metricFor('ctr:/tickets/', f).value, 2);
  assert.equal(metricFor('rank:lobi stars', f).better, 'down');
  assert.equal(metricFor('grow:social', f).value, 2);
  assert.equal(verdict({ value: 7.4, better: 'down' }, { value: 4 }), 'better', 'a lower Google position is better');
  assert.equal(verdict({ value: 2, better: 'up' }, { value: 1.5 }), 'worse');
  assert.equal(verdict({ value: 2, better: 'up' }, { value: 2 }), 'no change');
});
