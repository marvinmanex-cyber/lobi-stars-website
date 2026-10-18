import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { saveSecuritySetting } from '../_lib/adminSecurity.js';
import {
  APPROVAL_SWITCHES, approvalSwitches, listApprovals, decideApproval, pendingStatements, approvedStatements, approveStatement, ensureApprovalsSchema,
} from '../_lib/approvals.js';
import '../_lib/approvalRunners.js';

const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });

// Settings › Approvals (staff with approvals.approve: the Super Admins).
// GET  /api/admin/approvals -- waiting requests, official statements waiting, recent decisions, the switches
// POST /api/admin/approvals
//   { id, approve: true }                     approve (runs the action) -- never your own request
//   { id, approve: false, reason }            reject, with a reason
//   { statement: { slug, hash, title } }      approve an official statement for publishing
//   { switch: key, on }                       which actions need approval
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureApprovalsSchema(db);
  const origin = new URL(request.url).origin;
  const sw = await approvalSwitches(db);
  return json({
    switches: Object.entries(APPROVAL_SWITCHES).map(([key, v]) => ({ key, label: v.label, on: sw[key] })),
    pending: await listApprovals(db, { status: 'pending' }),
    history: await listApprovals(db, { status: 'done', limit: 60 }),
    statements: await pendingStatements(env, origin),
    approvedStatements: (await approvedStatements(db)).slice(0, 30),
    deployHook: !!env.PAGES_DEPLOY_HOOK,
  });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  const origin = new URL(request.url).origin;
  const b = await request.json().catch(() => ({}));

  if (b.switch) {
    if (!(b.switch in APPROVAL_SWITCHES)) return json({ error: 'Unknown setting.' }, 400);
    await saveSecuritySetting(db, b.switch, b.on === true ? '1' : '0', admin.name);
    await logAdminAction(db, admin, 'approval_settings', `${APPROVAL_SWITCHES[b.switch].label}: ${b.on === true ? 'needs approval' : 'no approval needed'}`);
    return json({ ok: true });
  }
  if (b.statement) {
    const { slug, hash, title } = b.statement;
    const waiting = (await pendingStatements(env, origin)).find(s => s.slug === slug && s.hash === hash);
    if (!waiting) return json({ error: 'That article is no longer waiting (it may have been changed: check the list again).' }, 409);
    const r = await approveStatement(env, { slug, hash, title: waiting.title || title }, admin);
    return json({ ok: true, rebuilt: r.rebuilt });
  }
  const r = await decideApproval(env, origin, String(b.id || ''), { approve: b.approve === true, reason: b.reason }, admin);
  if (r.error) return json({ error: r.error }, r.status);
  return json({ ok: true, result: r.result });
}
