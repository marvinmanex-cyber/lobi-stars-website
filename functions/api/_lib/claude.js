// The ONE place the website talks to Claude (Anthropic API). Every feature
// (AI Fix, Ask Claude, the weekly summary) goes through callClaude() or
// submitBatch(), which:
//   - read the key and model names from the environment (never sent to a browser);
//   - check this month's estimated spend first (monthly budget, warning email);
//   - ask for JSON, check it against the fix type's schema, retry once, then fail cleanly;
//   - record every call in ai_usage_log (tokens and estimated cost).
// Claude never touches the database, files or code: it only returns text/JSON,
// which our own code checks and applies through a fixed list of fix actions (aiFix.js).
import { sendEmail } from './email.js';
import { superAdminEmails } from './superAdmins.js';

// ANTHROPIC_BASE_URL only for the local tests (a stand-in server); never set on the live site.
const API = env => String(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
const HEADERS = env => ({ 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
export const FEATURES = ['fix', 'batch_fix', 'weekly_scan', 'ask_claude', 'checklist_draft', 'code_proposal', 'weekly_summary', 'test'];
export const FEATURE_LABEL = { fix: 'Prepare a fix (button)', batch_fix: 'Prepare all (batch)', weekly_scan: 'Weekly scan (batch)', ask_claude: 'Ask Claude', checklist_draft: 'Checklist drafts',
  code_proposal: 'Code proposals', weekly_summary: 'Weekly Analytics summary', test: 'Test connection' };
// Lowest cost by default: every feature uses the cheap model unless a Super Admin switches it.
export const AI_DEFAULTS = {
  monthly_budget: '10', warn_at_percent: '80', auto_apply_enabled: '1', auto_apply_types: 'rerun_sync',
  weekly_scan_day: '1', weekly_scan_time: '07:00', max_items_per_batch: '50', ask_claude_enabled: '1',
  ...Object.fromEntries(FEATURES.map(f => [`model_${f}`, 'default'])),
};
// Used for the budget until a Super Admin enters the real prices (AI Settings): deliberately
// high, so the budget guard errs on the safe side. US$ per million tokens.
export const ASSUMED_PRICE = { in: 3, out: 15 };
export const BATCH_DISCOUNT = 0.5;

export const models = env => ({ default: env.CLAUDE_MODEL_DEFAULT || 'claude-haiku-5-5', advanced: env.CLAUDE_MODEL_ADVANCED || 'claude-sonnet-5-5' });
export const lagosMonth = (ms = Date.now()) => new Date(ms + 3600e3).toISOString().slice(0, 7);
// CLAUDE_MOCK=true: answers are made up locally (no API call, no cost), for testing and training.
export const mockMode = env => ['1', 'true', 'yes', 'on'].includes(String(env.CLAUDE_MOCK || '').toLowerCase());
export const aiReady = env => mockMode(env) || !!env.ANTHROPIC_API_KEY;

// ── Tables ──
let ready = false;
export async function ensureAiSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_usage_log (id INTEGER PRIMARY KEY AUTOINCREMENT, feature TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0, estimated_cost REAL NOT NULL DEFAULT 0, admin_id TEXT, related_id TEXT, success INTEGER NOT NULL DEFAULT 1, error_message TEXT, month TEXT NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_usage_month ON ai_usage_log (month)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_recommendation_meta (rec_id TEXT PRIMARY KEY, rec_type TEXT NOT NULL, title TEXT, category TEXT NOT NULL, risk TEXT NOT NULL, fix_type TEXT,
      priority_score INTEGER NOT NULL DEFAULT 0, estimated_minutes INTEGER, status TEXT NOT NULL DEFAULT 'open', data_hash TEXT, input_json TEXT, proposal_json TEXT, applied_json TEXT, error TEXT,
      present INTEGER NOT NULL DEFAULT 1, last_checked_at TEXT, updated_at TEXT, updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, anthropic_id TEXT NOT NULL UNIQUE, feature TEXT NOT NULL, model TEXT NOT NULL, items_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress', created_by TEXT, created_at TEXT NOT NULL, ended_at TEXT)`),
    // Every step of every fix (Fix history page) and every AI email (the mail log).
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_fix_log (id INTEGER PRIMARY KEY AUTOINCREMENT, rec_id TEXT, fix_type TEXT, action TEXT NOT NULL, admin_id TEXT, admin_name TEXT,
      detail TEXT, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_fix_log_rec ON ai_fix_log (rec_id, id)`),
    // Before/after figures of applied fixes (checked again at 14 and 30 days).
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_fix_results (id INTEGER PRIMARY KEY AUTOINCREMENT, rec_id TEXT NOT NULL, fix_type TEXT, title TEXT, applied_at TEXT NOT NULL,
      metric TEXT, before_json TEXT, after14_json TEXT, after14_at TEXT, after30_json TEXT, after30_at TEXT, verdict TEXT)`),
  ]);
  ready = true;
}

// ── Settings ──
export async function getAiSettings(db) {
  await ensureAiSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM ai_settings`).all();
  const raw = { ...AI_DEFAULTS };
  for (const r of results) if (r.value !== null) raw[r.key] = r.value;
  return raw;
}
export async function saveAiSetting(db, key, value, by = 'Automatic') {
  await ensureAiSchema(db);
  await db.prepare(`INSERT INTO ai_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, value === null ? null : String(value), new Date().toISOString(), by).run();
}
/** The model for a feature ('default' = cheap, 'advanced' = only if a Super Admin chose it). */
// A task type (e.g. a news draft) can have its own choice; otherwise the feature's.
export const modelFor = (env, s, feature, taskType = null) => {
  if (mockMode(env)) return 'mock';
  const task = taskType ? s[`model_task_${taskType}`] : '';
  const tier = task === 'advanced' || task === 'default' ? task : s[`model_${feature}`] === 'advanced' ? 'advanced' : 'default';
  return models(env)[tier];
};
/** US$ per million tokens for a model: the Super Admin's figures, or the safe assumption. */
export function priceOf(s, model) {
  const n = k => { const v = Number(s[`price:${model}:${k}`]); return Number.isFinite(v) && v > 0 ? v : null; };
  const pin = n('in'), pout = n('out');
  return { in: pin ?? ASSUMED_PRICE.in, out: pout ?? ASSUMED_PRICE.out, assumed: pin === null || pout === null };
}
export const costOf = (s, model, inTok, outTok, batch = false) => {
  if (model === 'mock') return 0;
  const p = priceOf(s, model);
  return Math.round(((inTok * p.in + outTok * p.out) / 1e6) * (batch ? BATCH_DISCOUNT : 1) * 1e6) / 1e6;
};

/** Rough cost before sending (for "Fix all" and the dry run): about 3.5 characters per token, output assumed at 60% of the limit. */
export function estimateCost(s, model, promptChars, maxTokens, batch = false) {
  return costOf(s, model, Math.ceil(promptChars / 3.5) + 150, Math.ceil(maxTokens * 0.6), batch);
}

/**
 * Removes email addresses and phone or card numbers from text staff type before it
 * goes to Claude (dates, scores and times are kept: a number needs 10+ digits).
 */
export function scrubPersonal(text) {
  return String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, m => (/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(m) || m.replace(/\D/g, '').length < 10 ? m : '[number removed]'));
}

/** Writes one line to the fix log (Fix history). */
export async function logFix(db, { recId = null, fixType = null, action, admin = null, detail = null, before = null, after = null }) {
  await ensureAiSchema(db);
  await db.prepare(`INSERT INTO ai_fix_log (rec_id, fix_type, action, admin_id, admin_name, detail, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(recId, fixType, action, admin?.id || 'system', admin?.name || 'Automatic', detail === null ? null : String(detail).slice(0, 500),
      before === null ? null : JSON.stringify(before).slice(0, 8000), after === null ? null : JSON.stringify(after).slice(0, 8000), new Date().toISOString()).run();
}
/** An email to the Super Admins about AI work. Always recorded in the fix log (the mail log); sent when email is set up. */
export async function aiEmail(env, { subject, html, kind }) {
  const to = superAdminEmails(env);
  let sent = false;
  if (to.length && env.RESEND_API_KEY) {
    try { await sendEmail(env, { to, subject, html }); sent = true; } catch (err) { console.error('[ai] email', kind, err); }
  }
  await logFix(env.DB, { action: 'email', detail: `${kind}: ${subject} (${sent ? `sent to ${to.length}` : 'not sent: email not set up'})` });
  return sent;
}

// ── Usage and budget ──
export async function logUsage(db, { feature, model, inTok = 0, outTok = 0, cost = 0, adminId = null, relatedId = null, ok = true, error = null }) {
  await db.prepare(`INSERT INTO ai_usage_log (feature, model, input_tokens, output_tokens, estimated_cost, admin_id, related_id, success, error_message, month, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(feature, model, inTok, outTok, cost, adminId, relatedId === null ? null : String(relatedId).slice(0, 200), ok ? 1 : 0,
    error ? String(error).slice(0, 500) : null, lagosMonth(), new Date().toISOString()).run();
}
export async function monthSpend(db, month = lagosMonth()) {
  await ensureAiSchema(db);
  const r = await db.prepare(`SELECT COALESCE(SUM(estimated_cost), 0) AS spent, COUNT(*) AS calls FROM ai_usage_log WHERE month = ?`).bind(month).first();
  return { spent: r.spent || 0, calls: r.calls || 0 };
}
/**
 * Before every call. Warns the Super Admins once a month at warn_at_percent;
 * at 100% blocks everything except urgent calls (Test connection) until next
 * month or until a Super Admin raises the budget.
 */
export async function budgetCheck(env, { urgent = false } = {}) {
  const db = env.DB, s = await getAiSettings(db), month = lagosMonth();
  const budget = Math.max(0, Number(s.monthly_budget) || 0), { spent } = await monthSpend(db, month);
  const pct = budget ? (spent / budget) * 100 : 100;
  if (pct >= (Number(s.warn_at_percent) || 80) && s.warned_month !== month && budget) {
    await saveAiSetting(db, 'warned_month', month);
    await aiEmail(env, { kind: 'budget_warning', subject: `AI budget: ${Math.round(pct)}% of this month's $${budget} used`,
      html: `<p>The website's Claude (AI) use this month is about <b>$${spent.toFixed(2)}</b> of the <b>$${budget}</b> monthly budget (${Math.round(pct)}%).</p><p>At 100% the website stops non-urgent AI work until next month. You can change the budget in Admin › Settings › AI Settings.</p>` });
  }
  const blocked = spent >= budget;
  await saveAiSetting(db, 'blocked_month', blocked ? month : '');
  if (blocked && !urgent) return { ok: false, spent, budget, pct, error: 'Monthly AI budget reached. AI work resumes next month, or a Super Admin can raise the limit in AI Settings.' };
  return { ok: true, spent, budget, pct };
}

// ── Checking what Claude returns (untrusted) ──
/** Plain text: no HTML tags, no scripts, no javascript: links, no control characters. */
export function cleanText(v, { multiline = false } = {}) {
  let s = String(v ?? '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<\/?[a-z][^>]*>/gi, '');
  s = s.replace(/javascript\s*:/gi, '').replace(/data\s*:\s*text\/html/gi, '');
  // eslint-disable-next-line no-control-regex
  s = s.replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, multiline ? '' : ' ');
  return (multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ')).trim();
}
/**
 * schema: { field: { type: 'string'|'boolean'|'number', min, max, multiline, optional } }.
 * Returns { value } (cleaned, only the schema's fields) or { error }.
 */
export function validateJson(schema, obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'not a JSON object' };
  const out = {};
  for (const [k, rule] of Object.entries(schema)) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') { if (rule.optional) continue; return { error: `missing ${k}` }; }
    if (rule.type === 'boolean') { if (typeof v !== 'boolean') return { error: `${k} must be true/false` }; out[k] = v; continue; }
    if (rule.type === 'number') { if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `${k} must be a number` }; out[k] = v; continue; }
    if (typeof v !== 'string') return { error: `${k} must be text` };
    const t = cleanText(v, { multiline: !!rule.multiline });
    if (rule.min && t.length < rule.min) return { error: `${k} is too short (${t.length} < ${rule.min})` };
    if (rule.max && t.length > rule.max) return { error: `${k} is too long (${t.length} > ${rule.max})` };
    out[k] = t;
  }
  return { value: out };
}
/** The JSON object inside Claude's reply (it may wrap it in a code fence). */
export function extractJson(text) {
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
const NEEDS_HINT = 'If the facts given are not enough to write this without inventing anything, do NOT guess: reply instead with ONE JSON object {"needs": "a short question for the staff about what is missing"}.';
/** Made-up answer that passes the schema (CLAUDE_MOCK). */
export function mockFromSchema(schema) {
  const out = {};
  for (const [k, r] of Object.entries(schema || {})) {
    if (r.optional) continue;
    if (r.type === 'boolean') { out[k] = true; continue; }
    if (r.type === 'number') { out[k] = 1; continue; }
    let t = `Mock ${k} (CLAUDE_MOCK is on: no AI was used).`;
    while (t.length < (r.min || 0)) t += ' Mock text.';
    out[k] = r.max ? t.slice(0, r.max) : t;
  }
  return out;
}
const schemaHint = schema => `Reply with ONE JSON object only, no other text: {${Object.entries(schema).map(([k, r]) => `"${k}": ${r.type === 'string' ? `string${r.max ? ` (max ${r.max} characters)` : ''}` : r.type}${r.optional ? ' (optional)' : ''}`).join(', ')}}`;

function errorMessage(status, d) {
  const m = d?.error?.message || '';
  if (status === 401 || status === 403) return 'The Anthropic API key was not accepted (check ANTHROPIC_API_KEY in Cloudflare).';
  if (status === 429) return 'Claude is busy right now (rate limit). Please try again in a minute.';
  if (status === 529 || status === 503) return 'Claude is overloaded right now. Please try again in a few minutes.';
  if (/credit balance/i.test(m)) return 'The Anthropic account has no credit left: top up at console.anthropic.com › Billing.';
  return `Claude could not answer (${status}${m ? `: ${m.slice(0, 160)}` : ''}).`;
}

/**
 * One normal (instant) call, for when a person clicks and waits.
 * schema: check the reply as JSON (one retry); null: plain text.
 * Returns { ok, data | text, model, cost } or { ok: false, error }.
 */
export async function callClaude(env, { feature, system, prompt, messages = null, schema = null, maxTokens = 400, adminId = null, relatedId = null, urgent = false, taskType = null, allowNeeds = false }) {
  if (!aiReady(env)) return { ok: false, error: 'Claude is not connected (ANTHROPIC_API_KEY is not set in Cloudflare).' };
  const db = env.DB;
  const b = await budgetCheck(env, { urgent });
  if (!b.ok) return { ok: false, error: b.error, budget: true };
  const s = await getAiSettings(db), model = modelFor(env, s, feature, taskType);
  const sys = schema ? `${system}\n\n${schemaHint(schema)}${allowNeeds ? `\n${NEEDS_HINT}` : ''}` : system;
  let msgs = messages || [{ role: 'user', content: prompt }];
  if (model === 'mock') {
    await logUsage(db, { feature, model, adminId, relatedId, ok: true });
    if (allowNeeds && /needs-test/i.test(JSON.stringify(msgs))) return { ok: true, needs: 'Mock question: what was the final score? (CLAUDE_MOCK)', model, cost: 0 };
    return schema ? { ok: true, data: validateJson(schema, mockFromSchema(schema)).value, model, cost: 0, mock: true }
      : { ok: true, text: 'Mock answer: CLAUDE_MOCK is on, so no AI was used and nothing was spent.', model, cost: 0, mock: true };
  }
  let lastErr = '';
  for (let attempt = 0; attempt < (schema ? 2 : 1); attempt++) {
    let r, d;
    try {
      r = await fetch(`${API(env)}/messages`, { method: 'POST', headers: HEADERS(env), signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ model, max_tokens: maxTokens * (attempt + 1), output_config: { effort: 'low' }, system: sys, messages: msgs }) });
      d = await r.json().catch(() => ({}));
    } catch (err) {
      const msg = err?.name === 'TimeoutError' ? 'Claude took too long to answer (30 seconds). Please try again.' : 'Claude could not be reached. Please try again.';
      await logUsage(db, { feature, model, adminId, relatedId, ok: false, error: msg });
      return { ok: false, error: msg };
    }
    const inTok = d?.usage?.input_tokens || 0, outTok = d?.usage?.output_tokens || 0, cost = costOf(s, model, inTok, outTok);
    if (!r.ok) {
      const msg = errorMessage(r.status, d);
      await logUsage(db, { feature, model, inTok, outTok, cost, adminId, relatedId, ok: false, error: msg });
      return { ok: false, error: msg };
    }
    const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    if (!schema) {
      await logUsage(db, { feature, model, inTok, outTok, cost, adminId, relatedId, ok: !!text, error: text ? null : 'empty reply' });
      return text ? { ok: true, text, model, cost } : { ok: false, error: 'Claude returned an empty answer; please try again.' };
    }
    const parsed = extractJson(text);
    // Claude asks for the missing facts instead of inventing them.
    if (allowNeeds && parsed && typeof parsed.needs === 'string' && parsed.needs.trim()) {
      await logUsage(db, { feature, model, inTok, outTok, cost, adminId, relatedId, ok: true });
      return { ok: true, needs: cleanText(parsed.needs).slice(0, 300), model, cost };
    }
    const v = validateJson(schema, parsed);
    await logUsage(db, { feature, model, inTok, outTok, cost, adminId, relatedId, ok: !v.error, error: v.error ? `invalid JSON: ${v.error}` : null });
    if (!v.error) return { ok: true, data: v.value, model, cost };
    lastErr = v.error;
    msgs = [...msgs, { role: 'assistant', content: text || '(empty)' }, { role: 'user', content: `That reply could not be used (${v.error}). ${schemaHint(schema)}` }];
  }
  return { ok: false, error: `Claude's answer could not be used (${lastErr}). Nothing was changed.` };
}

// ── Message Batches (half price, results within 24 hours; for weekly and "Prepare all") ──
/** items: [{ customId, system, prompt, schema, maxTokens, meta }]. Returns { ok, id } or { ok: false, error }. */
export async function submitBatch(env, { feature, items, createdBy = 'Automatic' }) {
  if (!aiReady(env)) return { ok: false, error: 'Claude is not connected (ANTHROPIC_API_KEY).' };
  if (!items.length) return { ok: false, error: 'Nothing to prepare.' };
  const db = env.DB;
  const b = await budgetCheck(env);
  if (!b.ok) return { ok: false, error: b.error, budget: true };
  const s = await getAiSettings(db), model = modelFor(env, s, feature);
  if (model === 'mock') {
    const id = `mock_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO ai_batches (anthropic_id, feature, model, items_json, status, created_by, created_at) VALUES (?, ?, 'mock', ?, 'in_progress', ?, ?)`)
      .bind(id, feature, JSON.stringify(items.map(it => ({ customId: it.customId, ...it.meta }))), createdBy, new Date().toISOString()).run();
    return { ok: true, id, count: items.length, mock: true };
  }
  const requests = items.map(it => ({ custom_id: it.customId, params: { model, max_tokens: it.maxTokens, output_config: { effort: 'low' },
    system: it.schema ? `${it.system}\n\n${schemaHint(it.schema)}${it.allowNeeds ? `\n${NEEDS_HINT}` : ''}` : it.system, messages: [{ role: 'user', content: it.prompt }] } }));
  let r, d;
  try {
    r = await fetch(`${API(env)}/messages/batches`, { method: 'POST', headers: HEADERS(env), signal: AbortSignal.timeout(30000), body: JSON.stringify({ requests }) });
    d = await r.json().catch(() => ({}));
  } catch { return { ok: false, error: 'Claude could not be reached. Please try again.' }; }
  if (!r.ok || !d.id) {
    const msg = errorMessage(r.status, d);
    await logUsage(db, { feature, model, ok: false, error: msg });
    return { ok: false, error: msg };
  }
  await db.prepare(`INSERT INTO ai_batches (anthropic_id, feature, model, items_json, status, created_by, created_at) VALUES (?, ?, ?, ?, 'in_progress', ?, ?)`)
    .bind(d.id, feature, model, JSON.stringify(items.map(it => ({ customId: it.customId, ...it.meta }))), createdBy, new Date().toISOString()).run();
  return { ok: true, id: d.id, count: items.length };
}

/**
 * Checks unfinished batches; for each finished one, hands every result to
 * onResult({ item, text, ok, error }) and logs the usage (at batch price).
 */
export async function pollBatches(env, onResult) {
  const db = env.DB;
  await ensureAiSchema(db);
  const { results: open } = await db.prepare(`SELECT * FROM ai_batches WHERE status = 'in_progress' ORDER BY id LIMIT 3`).all();
  if (!open.length || !aiReady(env)) return { checked: 0 };
  const s = await getAiSettings(db);
  let finished = 0;
  for (const bt of open) {
    // CLAUDE_MOCK batches finish at once, with made-up answers (no API, no cost).
    if (bt.model === 'mock') {
      for (const item of JSON.parse(bt.items_json)) { try { await onResult({ item, text: '', ok: true, mock: true }); } catch (err) { console.error('[ai] mock batch result', err); } }
      await logUsage(db, { feature: bt.feature, model: 'mock', relatedId: `batch:${bt.anthropic_id}` });
      await db.prepare(`UPDATE ai_batches SET status = 'ended', ended_at = ? WHERE id = ?`).bind(new Date().toISOString(), bt.id).run();
      finished++;
      continue;
    }
    let st;
    try { st = await (await fetch(`${API(env)}/messages/batches/${encodeURIComponent(bt.anthropic_id)}`, { headers: HEADERS(env), signal: AbortSignal.timeout(20000) })).json(); } catch { continue; }
    const stale = Date.now() - Date.parse(bt.created_at) > 30 * 3600e3;
    if (st?.processing_status !== 'ended') {
      if (stale) await db.prepare(`UPDATE ai_batches SET status = 'failed', ended_at = ? WHERE id = ?`).bind(new Date().toISOString(), bt.id).run();
      continue;
    }
    const items = new Map(JSON.parse(bt.items_json).map(i => [i.customId, i]));
    let body = '';
    try { body = await (await fetch(st.results_url, { headers: HEADERS(env), signal: AbortSignal.timeout(25000) })).text(); } catch { continue; }
    let inTok = 0, outTok = 0, fails = 0;
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      const item = items.get(row.custom_id);
      if (!item) continue;
      const msg = row.result?.type === 'succeeded' ? row.result.message : null;
      inTok += msg?.usage?.input_tokens || 0; outTok += msg?.usage?.output_tokens || 0;
      const text = msg ? (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim() : '';
      if (!msg) fails++;
      try { await onResult({ item, text, ok: !!msg, error: msg ? null : (row.result?.error?.message || row.result?.type || 'failed') }); } catch (err) { console.error('[ai] batch result', err); }
    }
    await logUsage(db, { feature: bt.feature, model: bt.model, inTok, outTok, cost: costOf(s, bt.model, inTok, outTok, true), relatedId: `batch:${bt.anthropic_id}`, ok: fails === 0, error: fails ? `${fails} item(s) failed` : null });
    await db.prepare(`UPDATE ai_batches SET status = 'ended', ended_at = ? WHERE id = ?`).bind(new Date().toISOString(), bt.id).run();
    finished++;
  }
  return { checked: open.length, finished };
}

/** Settings › AI Settings › Test connection: the smallest possible call. */
export async function testConnection(env, admin) {
  const r = await callClaude(env, { feature: 'test', urgent: true, maxTokens: 30, adminId: admin?.id, system: 'You are a connection test.', prompt: 'Reply exactly {"ok": true}', schema: { ok: { type: 'boolean' } } });
  return r.ok ? { ok: true, model: r.model, cost: r.cost } : r;
}

/** Is AI work blocked this month? (For the "Monthly AI budget reached" bar; one cheap read.) */
export async function budgetBlocked(db) {
  try { const r = await db.prepare(`SELECT value FROM ai_settings WHERE key = 'blocked_month'`).first(); return r?.value === lagosMonth(); } catch { return false; }
}
