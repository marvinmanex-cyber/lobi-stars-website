import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logLeague } from '../../_lib/leagueDb.js';
import { ensureRewardsSchema, rewardsMember, memberNo, pointsSummary, ledgerFor } from '../../_lib/rewards.js';
import { adjustPoints } from '../../_lib/rewardsEarn.js';
import { ensureFanSchema } from '../../_lib/fans.js';
import { tierStatus } from '../../_lib/rewardsTiers.js';

// Admin › Rewards › Members.
// GET ?q=<email or member number LSR-000123> -> the member, balance, points history and referrals.
// POST { memberId, action: 'adjust', points, reason } | { memberId, action: 'suspend'|'unsuspend', reason }
// Adjustments need a reason and are in the points history and the audit log.
const ok = (d = {}) => Response.json({ ok: true, ...d }, { headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

async function find(db, q) {
  const s = String(q || '').trim();
  if (/^LSR-\d+$/i.test(s)) return db.prepare(`SELECT member_id FROM rewards_members WHERE seq = ?`).bind(Number(s.slice(4))).first();
  if (s.includes('@')) return db.prepare(`SELECT r.member_id FROM rewards_members r JOIN members m ON m.id = r.member_id WHERE lower(m.email) = lower(?)`).bind(s).first();
  return null;
}

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    await ensureRewardsSchema(db);
    const hit = await find(db, new URL(request.url).searchParams.get('q'));
    if (!hit) return fail('No Rewards member with that email or member number.', 404);
    const m = await rewardsMember(db, hit.member_id);
    const [sum, history, st, refs] = await Promise.all([
      pointsSummary(db, m.member_id), ledgerFor(db, m.member_id, 200),
      tierStatus(db, m.member_id),
      db.prepare(`SELECT f.friend_member_id, f.status, f.reason, f.created_at, f.decided_at, x.email FROM rewards_referrals f JOIN members x ON x.id = f.friend_member_id WHERE f.referrer_member_id = ? ORDER BY f.created_at DESC LIMIT 50`).bind(m.member_id).all(),
    ]);
    return ok({
      member: { id: m.member_id, memberNo: memberNo(m.seq), name: `${m.first_name} ${m.last_name}`, email: m.email, verified: !!m.email_verified, status: m.status, joinedAt: m.joined_at, state: m.state, dateOfBirth: m.date_of_birth },
      balance: sum.balance, pending: sum.pending, history,
      tier: { name: st.tier.name, key: st.tier.key, earned: st.earned, season: st.season, reason: st.reason, toNext: st.toNext, next: st.next?.name || null },
      referrals: refs.results.map(r => ({ email: r.email, status: r.status, reason: r.reason, createdAt: r.created_at, decidedAt: r.decided_at })),
    });
  } catch (err) {
    console.error('[rewards admin] member', err);
    return fail('Could not load the member.', 500);
  }
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureRewardsSchema(db);
    const b = await request.json().catch(() => ({}));
    const m = await rewardsMember(db, String(b.memberId || ''));
    if (!m) return fail('Member not found.', 404);
    const reason = String(b.reason || '').replace(/<[^>]*>/g, '').trim().slice(0, 160);
    if (reason.length < 3) return fail('Give the reason (it is shown in the member\'s points history).');
    const staff = admin.email || admin.name || 'owner';
    if (b.action === 'adjust') {
      const points = Number(b.points);
      if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 100000) return fail('Points: a whole number, plus or minus (not 0), up to 100,000.');
      await adjustPoints(db, { memberId: m.member_id, points, reason, staff });
      await logLeague(db, { email: staff }, 'rewards.adjust', 'rewards', m.member_id, { balance: (await pointsSummary(db, m.member_id)).balance - points }, { points, reason });
      return ok({ balance: (await pointsSummary(db, m.member_id)).balance });
    }
    if (b.action === 'suspend' || b.action === 'unsuspend') {
      const status = b.action === 'suspend' ? 'suspended' : 'active';
      await db.prepare(`UPDATE rewards_members SET status = ? WHERE member_id = ?`).bind(status, m.member_id).run();
      await logLeague(db, { email: staff }, `rewards.${b.action}`, 'rewards', m.member_id, { status: m.status }, { status, reason });
      return ok({ status });
    }
    return fail('Unknown action.');
  } catch (err) {
    console.error('[rewards admin] member action', err);
    return fail('Could not do that.', 500);
  }
}
