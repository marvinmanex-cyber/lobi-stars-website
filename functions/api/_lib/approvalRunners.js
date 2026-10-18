// What approving each kind of request does (see approvals.js). Imported by the
// Approvals API so the runners are registered before a decision is made.
import { registerApprovalRunner } from './approvals.js';
import { inviteStaff, changeRole, ensureLifecycleSchema, staffStatus } from './staffLifecycle.js';
import { saveRole, ROLE_DEFAULTS, PERMISSIONS, rolePermissions, loadRoles } from './adminRoles.js';
import { logAdminAction } from './adminSession.js';
import { ensureRewardsSchema, rewardsMember, pointsSummary } from './rewards.js';
import { adjustPoints } from './rewardsEarn.js';
import { logLeague } from './leagueDb.js';

registerApprovalRunner('staff_invite', async (env, origin, p, requester, approver) => {
  const r = await inviteStaff(env, origin, { ...p, accessUntil: p.accessUntil || null }, { id: requester.id, name: `${requester.name} (approved by ${approver.name})` });
  return `Invite sent to ${p.email}${r.emailed ? '' : ' (email not sent: Resend not set up)'}`;
});

registerApprovalRunner('role_change', async (env, origin, p, requester, approver) => {
  await ensureLifecycleSchema(env.DB);
  const u = await env.DB.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(p.userId).first();
  if (!u) throw new Error('That staff account no longer exists.');
  if (staffStatus(u) === 'disabled') throw new Error('That staff account has been disabled.');
  return changeRole(env, origin, u, p.role, { id: requester.id, name: `${requester.name} (approved by ${approver.name})` });
});

registerApprovalRunner('role_permissions', async (env, origin, p, requester, approver) => {
  await loadRoles(env.DB, { force: true });
  const before = rolePermissions(p.roleId);
  await saveRole(env.DB, p.roleId, p.permissions, approver.name);
  const label = id => PERMISSIONS.flatMap(g => g.items).find(([x]) => x === id)?.[1] || id;
  const added = p.permissions.filter(x => !before.includes(x)), removed = before.filter(x => !p.permissions.includes(x));
  await logAdminAction(env.DB, { id: requester.id, name: `${requester.name} (approved by ${approver.name})` }, 'role_changed',
    `${ROLE_DEFAULTS[p.roleId]?.label || p.roleId}: ${[added.length && `added: ${added.map(label).join('; ')}`, removed.length && `removed: ${removed.map(label).join('; ')}`].filter(Boolean).join(' · ') || 'no change'}`);
  return `${ROLE_DEFAULTS[p.roleId]?.label || p.roleId} updated`;
});

registerApprovalRunner('points_adjust', async (env, origin, p, requester, approver) => {
  await ensureRewardsSchema(env.DB);
  const m = await rewardsMember(env.DB, p.memberId);
  if (!m) throw new Error('That Rewards member no longer exists.');
  const staff = `${p.staff} (approved by ${approver.name})`;
  await adjustPoints(env.DB, { memberId: m.member_id, points: p.points, reason: p.reason, staff });
  await logLeague(env.DB, { email: staff }, 'rewards.adjust', 'rewards', m.member_id, { balance: (await pointsSummary(env.DB, m.member_id)).balance - p.points }, { points: p.points, reason: p.reason });
  return `${p.points > 0 ? '+' : ''}${p.points} points for ${p.memberId}`;
});
