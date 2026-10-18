// Approvals for sensitive actions. Instead of taking effect at once, these
// become a request that another Super Admin approves or rejects (with a reason):
//   staff_invite        a new staff account
//   role_change         giving someone the Super Admin role or a role that can download fan data
//   role_permissions    adding "Download fan contact data" to a role
//   points_adjust       changing a fan's Rewards points by more than 1,000
//   official_statement  a news article marked "Official statement" (approved on the Approvals page)
// Each kind can be switched off (Approvals page). Nobody approves their own
// request. If there is nobody else who could approve, the action goes ahead and
// is recorded as "no other approver", so the club is never stuck.
import { logAdminAction } from './adminSession.js';
import { securitySettings, saveSecuritySetting, securityEmail } from './adminSecurity.js';
import { superAdminEmails, isFullSuperAdmin } from './superAdmins.js';
import { randomId } from './crypto.js';

export const POINTS_LIMIT = 1000;
export const APPROVAL_SWITCHES = {
  approvals_staff: { label: 'New staff accounts, and giving Super Admin or fan-data download rights', default: '1' },
  approvals_points: { label: `Adjusting a fan's Rewards points by more than ${POINTS_LIMIT.toLocaleString('en-GB')}`, default: '1' },
  approvals_official: { label: 'News articles marked "Official statement"', default: '1' },
  approvals_all_news: { label: 'Every news article (not only official statements)', default: '0' },
  approvals_predict: { label: 'The Prediction League prize (only Super Admins can change it in the Content CMS)', default: '1' },
};
const KIND_SWITCH = { staff_invite: 'approvals_staff', role_change: 'approvals_staff', role_permissions: 'approvals_staff', points_adjust: 'approvals_points' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ready = false;
export async function ensureApprovalsSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_approvals (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, summary TEXT NOT NULL, payload TEXT NOT NULL,
      requested_by_id TEXT NOT NULL, requested_by_name TEXT NOT NULL, requested_by_email TEXT, requested_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TEXT, reason TEXT, result TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS admin_approvals_status ON admin_approvals (status, requested_at)`),
    // Official statements approved: the article (slug) at that exact wording (hash). An edit needs approving again.
    db.prepare(`CREATE TABLE IF NOT EXISTS news_approvals (
      slug TEXT NOT NULL, hash TEXT NOT NULL, title TEXT, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
      PRIMARY KEY (slug, hash)
    )`),
  ]);
  ready = true;
}

export async function approvalSwitches(db) {
  const s = await securitySettings(db);
  return Object.fromEntries(Object.entries(APPROVAL_SWITCHES).map(([k, v]) => [k, (s[k] ?? v.default) === '1']));
}

/** Who could approve a request from this person: the other full Super Admins, plus the old admin code while it works. */
export async function otherApprovers(env, requester) {
  const list = superAdminEmails(env);
  // (On the local test server, test Super Admin accounts count too.)
  const testMode = env.STAFF_TEST_PASSWORDS === '1';
  const rows = list.length || testMode ? (await env.DB.prepare(`SELECT id, name, email, role, password_hash, test_account FROM admin_users WHERE role = 'super_admin' AND active = 1 AND disabled_at IS NULL
    AND (email IN (${list.map(() => '?').join(',') || "''"})${testMode ? ' OR test_account = 1' : ''})`).bind(...list).all()).results : [];
  const people = rows.filter(u => isFullSuperAdmin(env, u) && u.id !== requester.id);
  const s = await securitySettings(env.DB);
  if (requester.id !== 'owner' && s.admin_code_off !== '1') people.push({ id: 'owner', name: 'Owner (admin code)', email: '' });
  return people;
}

/** Does this action need approval right now? */
export async function needsApproval(env, kind, requester) {
  await ensureApprovalsSchema(env.DB);
  const sw = (await approvalSwitches(env.DB))[KIND_SWITCH[kind]];
  if (!sw) return false;
  return (await otherApprovers(env, requester)).length > 0;
}

/** Records the request and tells the approvers. Returns the approval. */
export async function requestApproval(env, origin, { kind, summary, payload, requester }) {
  await ensureApprovalsSchema(env.DB);
  const id = randomId('apr', 10);
  await env.DB.prepare(`INSERT INTO admin_approvals (id, kind, summary, payload, requested_by_id, requested_by_name, requested_by_email, requested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, kind, summary.slice(0, 300), JSON.stringify(payload), requester.id, requester.name, requester.email || null, new Date().toISOString()).run();
  await logAdminAction(env.DB, requester, 'approval_requested', `${summary} (waiting for approval)`);
  const to = (await otherApprovers(env, requester)).map(p => p.email).filter(Boolean);
  await securityEmail(env, to, 'Lobi Stars admin: an action is waiting for your approval', [
    `<strong>${esc(requester.name)}</strong> asked for: <strong>${esc(summary)}</strong>.`,
    `<a href="${origin}/admin/approvals/" style="display:inline-block;padding:12px 20px;background:#C11A1F;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">Approve or reject</a>`,
    'Sign in and open Settings › Approvals.'], origin);
  return { id, pending: true, message: `Sent for approval: ${summary}. A Super Admin has been asked to approve it.` };
}

/** "This needs approval" answer for an API: HTTP 202 with the request. */
export const pendingResponse = a => Response.json({ ok: true, pending: true, approvalId: a.id, message: a.message }, { status: 202, headers: { 'Cache-Control': 'no-store' } });

// What approving does, per kind (each re-checks and runs the action as the approver records it).
const runners = {};
export function registerApprovalRunner(kind, fn) { runners[kind] = fn; }

/** Approve or reject. Approving runs the action. Nobody decides their own request. */
export async function decideApproval(env, origin, id, { approve, reason }, approver) {
  await ensureApprovalsSchema(env.DB);
  const a = await env.DB.prepare(`SELECT * FROM admin_approvals WHERE id = ?`).bind(id).first();
  if (!a) return { error: 'Request not found.', status: 404 };
  if (a.status !== 'pending') return { error: 'This request has already been decided.', status: 409 };
  if (a.requested_by_id === approver.id) return { error: "You can't approve or reject your own request. Another Super Admin must do it.", status: 403 };
  const why = String(reason || '').trim().slice(0, 300);
  if (!approve && why.length < 3) return { error: 'Please give a reason for rejecting it.', status: 400 };
  // Claim it first (two Super Admins pressing at once can't both run it).
  const claim = await env.DB.prepare(`UPDATE admin_approvals SET status = ?, decided_by = ?, decided_at = ?, reason = ? WHERE id = ? AND status = 'pending'`)
    .bind(approve ? 'approving' : 'rejected', approver.name, new Date().toISOString(), why || null, id).run();
  if (!claim.meta?.changes) return { error: 'This request has already been decided.', status: 409 };
  let result = null;
  if (approve) {
    try {
      const run = runners[a.kind];
      if (!run) throw new Error('This kind of request can no longer be approved.');
      result = await run(env, origin, JSON.parse(a.payload), { id: a.requested_by_id, name: a.requested_by_name, email: a.requested_by_email }, approver) || 'done';
      await env.DB.prepare(`UPDATE admin_approvals SET status = 'approved', result = ? WHERE id = ?`).bind(String(result).slice(0, 300), id).run();
    } catch (err) {
      await env.DB.prepare(`UPDATE admin_approvals SET status = 'failed', result = ? WHERE id = ?`).bind(String(err.message || err).slice(0, 300), id).run();
      await logAdminAction(env.DB, approver, 'approval_failed', `${a.summary}: ${err.message || err}`);
      return { error: `Approved, but it could not be done: ${err.message || err}`, status: 400 };
    }
  }
  await logAdminAction(env.DB, approver, approve ? 'approval_approved' : 'approval_rejected', `${a.summary} (asked by ${a.requested_by_name})${why ? `: ${why}` : ''}`);
  if (a.requested_by_email) {
    await securityEmail(env, a.requested_by_email, `Lobi Stars admin: your request was ${approve ? 'approved' : 'rejected'}`, [
      `Your request <strong>${esc(a.summary)}</strong> was <strong>${approve ? 'approved' : 'rejected'}</strong> by ${esc(approver.name)}.`, why ? `Reason: ${esc(why)}` : ''].filter(Boolean), origin);
  }
  return { ok: true, status: 200, result };
}

export async function listApprovals(db, { status = 'pending', limit = 100 } = {}) {
  await ensureApprovalsSchema(db);
  const { results } = await db.prepare(status === 'pending'
    ? `SELECT * FROM admin_approvals WHERE status = 'pending' ORDER BY requested_at ASC LIMIT ?`
    : `SELECT * FROM admin_approvals WHERE status != 'pending' ORDER BY COALESCE(decided_at, requested_at) DESC LIMIT ?`).bind(limit).all();
  return results.map(r => ({ ...r, payload: undefined }));
}
export const pendingCount = async db => { await ensureApprovalsSchema(db); return (await db.prepare(`SELECT COUNT(*) AS n FROM admin_approvals WHERE status = 'pending'`).first()).n || 0; };

// ── Official statements ──

/** The articles marked "Official statement" in the current site build (written at build time, admins only). */
export async function officialArticles(env, origin) {
  try {
    const res = await env.ASSETS.fetch(new URL('/admin/news-approvals.json', origin));
    return res.ok ? (await res.json()).articles || [] : [];
  } catch { return []; }
}
export async function approvedStatements(db) {
  await ensureApprovalsSchema(db);
  return (await db.prepare(`SELECT slug, hash, title, approved_by, approved_at FROM news_approvals ORDER BY approved_at DESC`).all()).results;
}
/** Official statements in this build that still need approval (this exact wording not approved yet). */
export async function pendingStatements(env, origin) {
  const [articles, approved] = await Promise.all([officialArticles(env, origin), approvedStatements(env.DB)]);
  const ok = new Set(approved.map(a => `${a.slug}|${a.hash}`));
  return articles.filter(a => a.needsApproval && !ok.has(`${a.slug}|${a.hash}`));
}
/** Approve a statement: it appears at the next site update (straight away if a deploy hook is set). */
export async function approveStatement(env, { slug, hash, title }, approver) {
  await ensureApprovalsSchema(env.DB);
  await env.DB.prepare(`INSERT OR IGNORE INTO news_approvals (slug, hash, title, approved_by, approved_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(slug, hash, title || null, approver.name, new Date().toISOString()).run();
  await logAdminAction(env.DB, approver, 'approval_approved', `Official statement "${title || slug}" approved for publishing`);
  let rebuilt = false;
  if (env.PAGES_DEPLOY_HOOK) {
    try { rebuilt = (await fetch(env.PAGES_DEPLOY_HOOK, { method: 'POST' })).ok; } catch { /* the next site update shows it */ }
  }
  return { rebuilt };
}

/** Tell the approvers once about each new statement waiting (called every minute by the timer job). */
export async function notifyPendingStatements(env, origin) {
  const pending = await pendingStatements(env, origin);
  if (!pending.length) return 0;
  const s = await securitySettings(env.DB);
  const told = new Set(String(s.statements_notified || '').split(',').filter(Boolean));
  const fresh = pending.filter(p => !told.has(`${p.slug}|${p.hash}`));
  if (!fresh.length) return 0;
  const to = superAdminEmails(env);
  await securityEmail(env, to, 'Lobi Stars admin: an official statement is waiting for approval', [
    `${fresh.length === 1 ? 'An article marked <strong>Official statement</strong> is' : `${fresh.length} articles marked <strong>Official statement</strong> are`} waiting for approval before ${fresh.length === 1 ? 'it appears' : 'they appear'} on the website:`,
    fresh.map(p => `• <strong>${esc(p.title)}</strong>`).join('<br>'),
    `<a href="${origin}/admin/approvals/">Open Settings › Approvals</a>`], origin);
  const keep = [...told, ...fresh.map(p => `${p.slug}|${p.hash}`)].slice(-200);
  await saveSecuritySetting(env.DB, 'statements_notified', keep.join(','), 'Approvals');
  return fresh.length;
}
