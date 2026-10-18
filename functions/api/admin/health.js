import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { healthSummary } from '../_lib/uptime.js';
import { healthOverview, startRun, stepRun, checkHistory, acknowledge, ensureHealthSchema } from '../_lib/healthRun.js';
import { FIXES, runFix } from '../_lib/healthFixes.js';
import { CATEGORIES, INFO } from '../_lib/healthChecks.js';
import { sendEmail } from '../_lib/email.js';

// Website Health (only the three Super Admins: permission website.health, checked
// here and by the route rules). Read-only checks; secrets are never shown.
// GET  /api/admin/health                    -- the latest state of every check, categories, last run, uptime
// GET  /api/admin/health?brief=1            -- the status dot and problem count (dashboard button)
// GET  /api/admin/health?history=<checkId>  -- when that check failed and was fixed (90 days)
// GET  /api/admin/health?run=<id>           -- progress of a run
// POST { action: 'start', kind: 'full' | 'category', only }  -- "Run full check now" / "Check again" (one category)
// POST { action: 'step', id }                -- the next step of a run (the page calls it until done)
// POST { action: 'fix', fixId, checkId, eventId }  -- a safe one-click fix (confirmed on the page)
// POST { action: 'ack', checkId, note }      -- acknowledge: stays visible, no repeat alerts for 24 hours
// POST { action: 'test_email' }              -- a test email to the Super Admin pressing it
// POST { action: 'report' }                  -- records a report download (PDF) in the Activity Log
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

async function guard(request, env) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return { denied };
  if (!admin.permissions?.includes('website.health')) return { denied: json({ error: 'Only the three Super Admins can open Website Health.' }, 403) };
  return { admin };
}

export async function onRequestGet({ request, env }) {
  const { denied } = await guard(request, env);
  if (denied) return denied;
  const u = new URL(request.url);
  await ensureHealthSchema(env.DB);
  if (u.searchParams.get('history')) {
    const id = u.searchParams.get('history');
    if (!INFO[id]) return json({ error: 'Unknown check' }, 404);
    return json(await checkHistory(env.DB, id));
  }
  if (u.searchParams.get('run')) {
    const r = await env.DB.prepare(`SELECT * FROM health_runs WHERE id = ?`).bind(u.searchParams.get('run')).first();
    if (!r) return json({ error: 'Not found' }, 404);
    const { progressOf } = await import('../_lib/healthRun.js');
    return json({ run: progressOf(r) });
  }
  const o = await healthOverview(env);
  if (u.searchParams.get('brief')) {
    return json({ status: o.problems.fail ? 'FAIL' : o.problems.warning ? 'WARNING' : o.checks.length ? 'PASS' : null, fail: o.problems.fail, warning: o.problems.warning, lastRun: o.lastRun?.finishedAt || null, running: !!o.running });
  }
  let uptime = null;
  try { uptime = await healthSummary(env.DB); } catch {}
  return json({ ...o, uptime, fixes: Object.fromEntries(Object.entries(FIXES).map(([k, v]) => [k, v])), categoriesInfo: CATEGORIES, cron: !!env.CRON_SECRET, deployHook: !!env.PAGES_DEPLOY_HOOK });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await guard(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const origin = new URL(request.url).origin;
  if (b.action === 'start') {
    const kind = b.kind === 'category' ? 'category' : 'full';
    if (kind === 'category' && !CATEGORIES.some(c => c.key === b.only)) return json({ error: 'Unknown category' }, 400);
    const r = await startRun(env, { kind, only: kind === 'category' ? b.only : null, trigger: 'manual', by: admin.name });
    if (!r.already) await logAdminAction(env.DB, admin, 'health_check', kind === 'full' ? 'Website Health: full check started' : `Website Health: checked again (${CATEGORIES.find(c => c.key === b.only).label})`);
    return json(r);
  }
  if (b.action === 'step') {
    const r = await stepRun(env, origin, String(b.id || ''));
    if (r.error) return json(r, 404);
    return json(r);
  }
  if (b.action === 'fix') {
    if (!FIXES[b.fixId]) return json({ error: 'Unknown fix' }, 400);
    const r = await runFix(env, origin, b.fixId, admin, { eventId: b.eventId });
    await logAdminAction(env.DB, admin, 'health_fix', `Website Health fix "${FIXES[b.fixId].label}"${b.checkId ? ` (${b.checkId})` : ''}: ${r.message}`);
    return json(r, r.ok ? 200 : 400);
  }
  if (b.action === 'ack') {
    if (!INFO[b.checkId]) return json({ error: 'Unknown check' }, 400);
    const until = await acknowledge(env.DB, b.checkId, b.note, admin.name);
    if (!until) return json({ error: 'That check has no result yet.' }, 400);
    await logAdminAction(env.DB, admin, 'health_ack', `Website Health: "${INFO[b.checkId].name}" acknowledged for 24 hours${b.note ? `: ${String(b.note).slice(0, 200)}` : ''}`);
    return json({ ok: true, until });
  }
  if (b.action === 'test_email') {
    if (!env.RESEND_API_KEY) return json({ error: 'Email is not set up (RESEND_API_KEY).' }, 400);
    if (!admin.email) return json({ error: 'Your account has no email address.' }, 400);
    try {
      await sendEmail(env, { to: admin.email, subject: 'Lobi Stars website: test email', html: `<p>This test email from Website Health arrived, so the website can send email.</p><p>Sent ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.</p>` });
    } catch (err) { return json({ error: `Not sent: ${String(err.message || err).slice(0, 200)}` }, 500); }
    await logAdminAction(env.DB, admin, 'health_test_email', `Website Health: test email sent to ${admin.email}`);
    return json({ ok: true, message: `Test email sent to ${admin.email}.` });
  }
  if (b.action === 'report') {
    await logAdminAction(env.DB, admin, 'health_report', 'Website Health report downloaded (PDF)');
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
}
