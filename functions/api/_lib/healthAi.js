// Website Health › three buttons on every problem:
//  1. "Fix it for me"       runs the website's safe fix for that check, if it has
//                           one (no AI cost). Otherwise it says so and points to 2 and 3.
//  2. "Teach AI to fix this next time"
//                           if there is a safe fix: one click lets it run by
//                           itself whenever the check fails (the every-minute
//                           health job does it, at most every 6 hours per check);
//                           if not: Claude explains the one-time setup that makes
//                           the problem stop or fix itself, plus a request the
//                           developer can use to add an automatic fix.
//  3. "Show me how to fix it myself"
//                           numbered steps written by Claude for this exact problem.
// Lowest cost: Claude is only asked when a Super Admin presses 2 or 3, with the
// cheap model and a short answer; each answer is kept and reused while the
// problem stays the same. Without Claude the built-in steps are shown.
// Claude only writes instructions: it never changes anything on the website.
import { aiReady, callClaude, scrubPersonal, logFix } from './claude.js';
import { FIXES, runFix } from './healthFixes.js';
import { INFO } from './healthChecks.js';
import { healthOverview } from './healthRun.js';
import { logAdminAction } from './adminSession.js';

// Fixes that need a person to confirm a fact first: never run by AI or automatically.
export const NOT_AUTOMATIC = new Set(['mark_restore_tested']);
const KEEP_DAYS = 30;
const RETRY_MS = 6 * 3600e3;
const canFix = c => !!(c.fixId && FIXES[c.fixId] && !NOT_AUTOMATIC.has(c.fixId));

async function ensureTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS health_ai_help (check_id TEXT NOT NULL, hash TEXT NOT NULL, answer_json TEXT NOT NULL, model TEXT, cost REAL, created_at TEXT NOT NULL, PRIMARY KEY (check_id, hash))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS health_auto_fix (fix_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, set_by TEXT, set_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS health_auto_attempts (check_id TEXT PRIMARY KEY, fix_id TEXT, ok INTEGER, message TEXT, at TEXT NOT NULL)`),
  ]);
}
async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
function factsOf(c) {
  const details = c.details ? scrubPersonal(JSON.stringify(c.details)).slice(0, 1200) : '';
  return { id: c.id, name: c.name, status: c.status, problem: scrubPersonal(String(c.problem || '')).slice(0, 600), why: c.why || '', who: c.who || '', usual: (c.fix || INFO[c.id]?.fix || []).join(' | '), details };
}
const builtin = (c, kind) => ({ source: 'builtin', kind, who: c.who || INFO[c.id]?.who || 'Developer', minutes: null,
  summary: kind === 'teach' ? 'There is no automatic fix for this yet. These are the usual steps; the developer can add an automatic fix (see the request below).' : c.problem,
  steps: c.fix || INFO[c.id]?.fix || ['Press "Copy details for developer" and send the details to the developer.'] });

const CONTEXT = `You help the Super Admins of the Lobi Stars FC website (lobistarsfc.com: Cloudflare Pages with a D1 database; admin at /admin; a timer job runs every minute). They are not technical.
Write clear British English for Nigerian readers: numbered steps a non-technical person can follow, naming the exact admin menu (e.g. "Settings › Data Backup") or outside website (Cloudflare dashboard, Paystack dashboard, Resend) and button. If a step needs the developer, say so plainly and say what to send them. Never invent menus that are not in the facts; never ask for passwords or keys to be pasted anywhere.`;

/** Steps written by Claude: kind 'self' (fix it now by hand) or 'teach' (make it fix itself / stop happening next time). */
export async function aiGuide(env, c, admin, { kind = 'self', fresh = false } = {}) {
  const db = env.DB;
  await ensureTables(db);
  const f = factsOf(c);
  const hash = await sha(JSON.stringify([kind, f.status, f.problem, f.details]));
  if (!fresh) {
    const hit = await db.prepare(`SELECT answer_json, created_at FROM health_ai_help WHERE check_id = ? AND hash = ? AND created_at > ?`).bind(c.id, hash, new Date(Date.now() - KEEP_DAYS * 864e5).toISOString()).first();
    if (hit) return { ...JSON.parse(hit.answer_json), source: 'saved', savedAt: hit.created_at };
  }
  if (!aiReady(env)) return { ...builtin(c, kind), note: 'Claude is not connected, so these are the standard steps.' };
  const task = kind === 'teach'
    ? `The website has NO automatic fix for this check. Explain the one-time setup or change that would stop this problem coming back, or make the website fix it by itself next time (for example a setting to switch on, a key or service to set up once, a schedule). If only the developer can add an automatic fix, say what it should do in one sentence in "request".`
    : `Write the steps to fix THIS problem now, by hand.`;
  const prompt = `A Website Health check needs attention.
Check: ${f.name} (${f.id}), status ${f.status}.
Problem: ${f.problem}
Why it matters: ${f.why}
Usually fixed by: ${f.who}
Usual steps: ${f.usual}
Technical details: ${f.details || 'none'}

${task}`;
  const schema = { summary: { type: 'string', min: 10, max: 300 }, who: { type: 'string', min: 3, max: 60 }, minutes: { type: 'number' }, steps: { type: 'string', min: 20, max: 1800, multiline: true },
    ...(kind === 'teach' ? { request: { type: 'string', max: 400, optional: true } } : {}) };
  const r = await callClaude(env, { feature: 'health_help', system: CONTEXT, prompt, schema, maxTokens: 500, adminId: admin?.id || null, relatedId: c.id });
  if (!r.ok) return { ...builtin(c, kind), note: `${r.error} These are the standard steps.` };
  const steps = r.data.steps.split('\n').map(s => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean).slice(0, 12);
  const answer = { source: 'claude', kind, summary: r.data.summary, who: r.data.who, minutes: Math.max(1, Math.min(600, Math.round(r.data.minutes) || 10)), steps, request: r.data.request || null };
  await db.prepare(`INSERT OR REPLACE INTO health_ai_help (check_id, hash, answer_json, model, cost, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(c.id, hash, JSON.stringify(answer), r.model || null, r.cost || 0, new Date().toISOString()).run();
  await logFix(db, { action: 'health_guide', admin, detail: `Website Health: ${kind === 'teach' ? '"fix it next time" steps' : 'steps'} written for "${f.name}"` });
  return answer;
}

async function findCheck(env, checkId) {
  const o = await healthOverview(env);
  return o.checks.find(x => x.id === checkId) || null;
}
const isProblem = c => ['FAIL', 'WARNING'].includes(c.status);

/** 1. Fix it for me. */
export async function fixForMe(env, origin, checkId, admin) {
  const c = await findCheck(env, checkId);
  if (!c) return { error: 'Unknown check.' };
  if (!isProblem(c)) return { ok: true, mode: 'nothing', message: `${c.name} is working: nothing to fix.` };
  if (!canFix(c)) return { ok: true, mode: 'cannot', checkId: c.id, message: c.fixId && NOT_AUTOMATIC.has(c.fixId) ? 'This one needs a person to confirm something first, so AI won\'t do it.' : 'The website has no safe automatic fix for this problem yet.' };
  const r = await runFix(env, origin, c.fixId, admin, { eventId: c.details?.eventId });
  await logFix(env.DB, { action: 'health_autofix', admin, detail: `Website Health: "${FIXES[c.fixId].label}" for "${c.name}": ${r.message}` });
  return r.ok ? { ok: true, mode: 'fixed', checkId: c.id, category: c.category, fix: FIXES[c.fixId].label, message: r.message }
    : { ok: true, mode: 'failed', checkId: c.id, category: c.category, fix: FIXES[c.fixId].label, message: r.message };
}

/** 2. Teach AI to fix this next time. */
export async function teachAi(env, checkId, admin, { fresh = false } = {}) {
  const c = await findCheck(env, checkId);
  if (!c) return { error: 'Unknown check.' };
  await ensureTables(env.DB);
  if (canFix(c)) {
    const on = !!(await env.DB.prepare(`SELECT enabled FROM health_auto_fix WHERE fix_id = ? AND enabled = 1`).bind(c.fixId).first());
    return { ok: true, mode: 'switch', checkId: c.id, fixId: c.fixId, fix: FIXES[c.fixId].label, enabled: on };
  }
  return { ok: true, mode: 'guide', checkId: c.id, guide: await aiGuide(env, c, admin, { kind: 'teach', fresh }),
    developerRequest: `Website Health: please add a safe automatic fix for the check "${c.name}" (${c.id}). Problem now: ${c.problem}` };
}
/** Switches "fix automatically from now on" for a safe fix. */
export async function setAutoFix(env, admin, fixId, enabled) {
  if (!FIXES[fixId] || NOT_AUTOMATIC.has(fixId)) return { error: 'This fix can\'t run automatically.' };
  await ensureTables(env.DB);
  await env.DB.prepare(`INSERT INTO health_auto_fix (fix_id, enabled, set_by, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(fix_id) DO UPDATE SET enabled = excluded.enabled, set_by = excluded.set_by, set_at = excluded.set_at`)
    .bind(fixId, enabled ? 1 : 0, admin.name || admin.email, new Date().toISOString()).run();
  await logAdminAction(env.DB, admin, 'health_auto_fix', `Website Health: "${FIXES[fixId].label}" ${enabled ? 'will now run automatically when needed' : 'no longer runs automatically'}`);
  return { ok: true, fixId, enabled: !!enabled };
}
export async function autoFixList(env) {
  await ensureTables(env.DB);
  return (await env.DB.prepare(`SELECT fix_id FROM health_auto_fix WHERE enabled = 1`).all()).results.map(r => r.fix_id);
}

/** 3. Show me how to fix it myself. */
export async function fixMyself(env, checkId, admin, { fresh = false } = {}) {
  const c = await findCheck(env, checkId);
  if (!c) return { error: 'Unknown check.' };
  return { ok: true, mode: 'guide', checkId: c.id, guide: await aiGuide(env, c, admin, { kind: 'self', fresh }) };
}

/** The every-minute health job: runs the switched-on fixes for failing checks (each check at most every 6 hours). */
export async function runAutoFixes(env, origin, now = Date.now()) {
  const db = env.DB;
  await ensureTables(db);
  const on = new Set(await autoFixList(env));
  if (!on.size) return [];
  const o = await healthOverview(env);
  const done = [];
  for (const c of o.checks.filter(x => isProblem(x) && canFix(x) && on.has(x.fixId) && !x.ack)) {
    const last = await db.prepare(`SELECT at FROM health_auto_attempts WHERE check_id = ?`).bind(c.id).first();
    if (last && now - Date.parse(last.at) < RETRY_MS) continue;
    const system = { id: 'system', name: 'Website Health (automatic)', email: 'website-health', role: 'super_admin', permissions: ['website.health'] };
    const r = await runFix(env, origin, c.fixId, system, { eventId: c.details?.eventId }).catch(err => ({ ok: false, message: String(err.message || err) }));
    await db.prepare(`INSERT INTO health_auto_attempts (check_id, fix_id, ok, message, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(check_id) DO UPDATE SET fix_id = excluded.fix_id, ok = excluded.ok, message = excluded.message, at = excluded.at`)
      .bind(c.id, c.fixId, r.ok ? 1 : 0, String(r.message || '').slice(0, 300), new Date(now).toISOString()).run();
    await logAdminAction(db, system, 'health_auto_fix_run', `Website Health fixed "${c.name}" automatically ("${FIXES[c.fixId].label}"): ${r.message}`);
    await logFix(db, { action: 'health_autofix', detail: `Automatic: "${FIXES[c.fixId].label}" for "${c.name}": ${r.message}` });
    done.push({ checkId: c.id, ok: !!r.ok });
  }
  return done;
}
