import { aiGuard, json } from '../../_lib/aiApi.js';
import { getAiSettings, saveAiSetting, monthSpend, models, priceOf, testConnection, aiReady, lagosMonth, FEATURES, FEATURE_LABEL, ASSUMED_PRICE } from '../../_lib/claude.js';
import { githubReady } from '../../_lib/github.js';
import { FIX_ACTIONS, LONG_FORM_TYPES } from '../../_lib/aiFix.js';
import { logAdminAction } from '../../_lib/adminSession.js';

// Settings › AI Settings (Super Admins).
// GET                      -- settings, this month's spend vs budget, use by feature, recent calls
// PUT { ...settings }      -- save
// POST { action: 'test' }  -- Test connection (the smallest possible call)
const DAYS = ['0', '1', '2', '3', '4', '5', '6'];
// The advanced (dearer) model is only allowed for long writing and code; everything else is always the cheap one.
const ADVANCED_FEATURES = ['checklist_draft', 'squad_bio', 'code_proposal'];

export async function onRequestGet({ request, env }) {
  const { denied } = await aiGuard(request, env, { superOnly: true });
  if (denied) return denied;
  const db = env.DB, s = await getAiSettings(db), month = lagosMonth(), m = await monthSpend(db, month);
  const { results: byFeature } = await db.prepare(`SELECT feature, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(estimated_cost) AS cost,
    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed FROM ai_usage_log WHERE month = ? GROUP BY feature ORDER BY cost DESC`).bind(month).all();
  const { results: recent } = await db.prepare(`SELECT feature, model, input_tokens, output_tokens, estimated_cost, success, error_message, created_at FROM ai_usage_log ORDER BY id DESC LIMIT 15`).all();
  const md = models(env);
  return json({
    settings: s, month, spent: m.spent, calls: m.calls, budget: Number(s.monthly_budget) || 0,
    models: md, prices: Object.fromEntries(Object.values(md).map(x => [x, priceOf(s, x)])), assumedPrice: ASSUMED_PRICE,
    features: FEATURES.map(f => ({ id: f, label: FEATURE_LABEL[f], advancedAllowed: ADVANCED_FEATURES.includes(f) })),
    taskTypes: LONG_FORM_TYPES.map(id => ({ id, label: FIX_ACTIONS[id].label, model: s[`model_task_${id}`] || 'default' })), fixTypes: Object.entries(FIX_ACTIONS).map(([id, f]) => ({ id, label: f.label, autoAllowed: !f.needsGithub && !f.factual && f.risk === 'low' })),
    byFeature, recent, keyReady: aiReady(env), githubReady: githubReady(env),
  });
}

export async function onRequestPut({ request, env }) {
  const { admin, denied } = await aiGuard(request, env, { write: true, superOnly: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  const budget = num(b.monthly_budget, 0, 1000), warn = num(b.warn_at_percent, 10, 100), batch = num(b.max_items_per_batch, 1, 100);
  if (budget === null) return json({ error: 'Monthly budget: a number from 0 to 1000 (US dollars).' }, 400);
  if (warn === null) return json({ error: 'Warn at: a percentage from 10 to 100.' }, 400);
  if (batch === null || !Number.isInteger(batch)) return json({ error: 'Items per batch: a whole number from 1 to 100.' }, 400);
  if (!DAYS.includes(String(b.weekly_scan_day))) return json({ error: 'Choose the weekly scan day.' }, 400);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.weekly_scan_time || ''))) return json({ error: 'Weekly scan time: HH:MM (Lagos time).' }, 400);
  const types = (Array.isArray(b.auto_apply_types) ? b.auto_apply_types : []).filter(t => FIX_ACTIONS[t] && !FIX_ACTIONS[t].needsGithub && !FIX_ACTIONS[t].factual && FIX_ACTIONS[t].risk === 'low');
  const vals = {
    monthly_budget: budget, warn_at_percent: warn, max_items_per_batch: batch, weekly_scan_day: String(b.weekly_scan_day), weekly_scan_time: b.weekly_scan_time,
    auto_apply_enabled: b.auto_apply_enabled ? '1' : '0', auto_apply_types: types.join(','), ask_claude_enabled: b.ask_claude_enabled ? '1' : '0',
  };
  for (const f of FEATURES) vals[`model_${f}`] = b.models?.[f] === 'advanced' && ADVANCED_FEATURES.includes(f) ? 'advanced' : 'default';
  for (const t of LONG_FORM_TYPES) vals[`model_task_${t}`] = b.taskModels?.[t] === 'advanced' ? 'advanced' : 'default';
  for (const [model, p] of Object.entries(b.prices || {})) {
    if (!Object.values(models(env)).includes(model)) continue;
    for (const k of ['in', 'out']) {
      const v = p?.[k] === '' || p?.[k] === null || p?.[k] === undefined ? '' : num(p[k], 0, 1000);
      if (v === null) return json({ error: 'Prices: US dollars per million tokens, from 0 to 1000.' }, 400);
      vals[`price:${model}:${k}`] = v;
    }
  }
  for (const [k, v] of Object.entries(vals)) await saveAiSetting(env.DB, k, v, admin.name);
  if (Number(budget) > 0) await saveAiSetting(env.DB, 'blocked_month', '', admin.name);
  await logAdminAction(env.DB, admin, 'ai_settings', `AI settings: budget $${budget}, warn ${warn}%, auto-apply ${vals.auto_apply_enabled === '1' ? `on (${vals.auto_apply_types || 'none'})` : 'off'}`);
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await aiGuard(request, env, { write: true, superOnly: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  if (b.action !== 'test') return json({ error: 'Unknown action' }, 400);
  const r = await testConnection(env, admin);
  return r.ok ? json(r) : json({ error: r.error }, 400);
}
