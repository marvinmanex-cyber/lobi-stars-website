import { aiGuard, json } from '../../_lib/aiApi.js';
import { listFixes, prepareFix, applyFix, undoFix, setStatus, prepareAll } from '../../_lib/aiFix.js';
import { aiReady, monthSpend, getAiSettings, budgetBlocked } from '../../_lib/claude.js';
import { githubReady } from '../../_lib/github.js';

// Admin › AI Fix (Super Admins).
// GET                                          -- every recommendation with its category, status and prepared fix
// POST { action: 'prepare', id, input }       -- Claude prepares the fix now (normal API)
// POST { action: 'apply' | 'undo' | 'dismiss' | 'reopen', id }
// POST { action: 'prepare_all' }              -- every automatic fix in one Message Batch (half price, within 24 h)
export async function onRequestGet({ request, env }) {
  const { denied } = await aiGuard(request, env);
  if (denied) return denied;
  const s = await getAiSettings(env.DB), m = await monthSpend(env.DB);
  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ai_batches WHERE status = 'in_progress'`).first();
  return json({
    items: await listFixes(env),
    ai: { ready: aiReady(env), github: githubReady(env), blocked: await budgetBlocked(env.DB), spent: m.spent, budget: Number(s.monthly_budget) || 0, batchesRunning: open?.n || 0, askEnabled: s.ask_claude_enabled === '1' },
  });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await aiGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const id = String(b.id || '').slice(0, 300);
  let r;
  try {
    if (b.action === 'prepare') r = await prepareFix(env, id, admin, { input: b.input || null });
    else if (b.action === 'apply') r = await applyFix(env, id, admin);
    else if (b.action === 'undo') r = await undoFix(env, id, admin);
    else if (b.action === 'dismiss') r = await setStatus(env, id, 'dismissed', admin);
    else if (b.action === 'reopen') r = await setStatus(env, id, 'open', admin);
    else if (b.action === 'prepare_all') r = await prepareAll(env, admin);
    else return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[ai-fix]', err);
    return json({ error: 'Something went wrong; nothing was changed. Please try again.' }, 500);
  }
  return r.error ? json(r, 400) : json(r);
}
