import { aiGuard, json, SUPER_ONLY } from '../../_lib/aiApi.js';
import { listFixes, prepareFix, applyFix, undoFix, setStatus, prepareAll, planAll, editFix, applyMany } from '../../_lib/aiFix.js';
import { aiReady, monthSpend, getAiSettings, budgetBlocked, mockMode } from '../../_lib/claude.js';
import { githubReady } from '../../_lib/github.js';

// Admin › AI Fix.
// GET                                              -- every recommendation with its category, status and prepared fix
// POST { action: 'prepare', id, input, note }     -- Claude prepares the fix now (note = "Try again with a note")
//   (staff with ai.prepare and Super Admins; everything below: Super Admins only)
// POST { action: 'edit', id, proposal }           -- change the proposal before applying (checked again)
// POST { action: 'apply' | 'dismiss' | 'reopen', id }
// POST { action: 'undo', id, force }              -- force: undo although the item was edited since
// POST { action: 'apply_many' | 'dismiss_many', ids }   -- bulk review
// POST { action: 'estimate_all', types }          -- what "Fix all" would send, grouped, with the estimated cost
// POST { action: 'prepare_all', types }           -- send it in one Message Batch (half price, within 24 h)
const SUPER_ACTIONS = new Set(['edit', 'apply', 'undo', 'dismiss', 'reopen', 'apply_many', 'dismiss_many', 'estimate_all', 'prepare_all']);

export async function onRequestGet({ request, env }) {
  const { superAdmin, denied } = await aiGuard(request, env);
  if (denied) return denied;
  const s = await getAiSettings(env.DB), m = await monthSpend(env.DB);
  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ai_batches WHERE status = 'in_progress'`).first();
  return json({
    items: await listFixes(env),
    me: { canApply: superAdmin },
    ai: { ready: aiReady(env), mock: mockMode(env), github: githubReady(env), blocked: await budgetBlocked(env.DB), spent: m.spent, budget: Number(s.monthly_budget) || 0,
      batchesRunning: open?.n || 0, askEnabled: s.ask_claude_enabled === '1' },
  });
}

export async function onRequestPost({ request, env }) {
  const { admin, superAdmin, denied } = await aiGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  if (SUPER_ACTIONS.has(b.action) && !superAdmin) return json({ error: SUPER_ONLY }, 403);
  const id = String(b.id || '').slice(0, 300);
  const types = Array.isArray(b.types) && b.types.length ? b.types.map(String).slice(0, 20) : null;
  let r;
  try {
    if (b.action === 'prepare') r = await prepareFix(env, id, admin, { input: b.input || null, note: b.note || '' });
    else if (b.action === 'edit') r = await editFix(env, id, admin, b.proposal || {});
    else if (b.action === 'apply') r = await applyFix(env, id, admin);
    else if (b.action === 'undo') r = await undoFix(env, id, admin, { force: b.force === true });
    else if (b.action === 'dismiss') r = await setStatus(env, id, 'dismissed', admin);
    else if (b.action === 'reopen') r = await setStatus(env, id, 'open', admin);
    else if (b.action === 'apply_many') r = await applyMany(env, b.ids, admin, 'apply');
    else if (b.action === 'dismiss_many') r = await applyMany(env, b.ids, admin, 'dismiss');
    else if (b.action === 'estimate_all') { const p = await planAll(env, { types }); r = { ok: true, count: p.count, cost: p.cost, groups: p.groups, direct: p.direct.length, cached: p.cached.length }; }
    else if (b.action === 'prepare_all') r = await prepareAll(env, admin, 'batch_fix', { types });
    else return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[ai-fix]', err);
    return json({ error: 'Something went wrong; nothing was changed. Please try again.' }, 500);
  }
  return r.error ? json(r, r.editedSince ? 409 : 400) : json(r);
}
