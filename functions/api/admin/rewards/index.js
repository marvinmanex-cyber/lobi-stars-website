import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logLeague } from '../../_lib/leagueDb.js';
import { ensureRewardsSchema, rewardsSettings, REWARDS_DEFAULTS } from '../../_lib/rewards.js';
import { settingsProblem } from '../../_lib/rewardsRules.js';
import { ensureFanSchema } from '../../_lib/fans.js';
import { tierStatus } from '../../_lib/rewardsTiers.js';

/** How many active members are in each tier (worked out per member; fine for thousands). */
async function tierDistribution(db) {
  const { results } = await db.prepare(`SELECT member_id FROM rewards_members WHERE status = 'active' LIMIT 5000`).all();
  const out = {};
  for (const r of results) { const k = (await tierStatus(db, r.member_id)).tier.key; out[k] = (out[k] || 0) + 1; }
  return out;
}

// Admin › Rewards › Settings.
// GET -> { settings, defaults, stats }; PUT { settings } -> saves every editable
// number (validated), the tiers and the "live" switch; the change goes to the audit log.
const ok = (d = {}) => Response.json({ ok: true, ...d }, { headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const NUMBERS = Object.keys(REWARDS_DEFAULTS).filter(k => typeof REWARDS_DEFAULTS[k] === 'number');

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    await ensureRewardsSchema(db);
    const [settings, members, points, referrals] = await Promise.all([
      rewardsSettings(db),
      db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended FROM rewards_members`).first(),
      db.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN points END), 0) AS available, COALESCE(SUM(CASE WHEN status = 'PENDING' THEN points END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'AVAILABLE' AND points > 0 AND type IN ('EARN', 'BONUS') THEN points END), 0) AS issued FROM rewards_ledger`).first(),
      db.prepare(`SELECT status, COUNT(*) AS n FROM rewards_referrals GROUP BY status`).all(),
    ]);
    const tierCounts = await tierDistribution(db);
    return ok({
      settings, defaults: REWARDS_DEFAULTS,
      stats: { members: members?.n || 0, suspended: members?.suspended || 0, available: points?.available || 0, pending: points?.pending || 0, issued: points?.issued || 0,
        referrals: Object.fromEntries(referrals.results.map(r => [r.status, r.n])), tiers: tierCounts },
    });
  } catch (err) {
    console.error('[rewards admin] load', err);
    return fail('Could not load Rewards.', 500);
  }
}

export async function onRequestPut({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureRewardsSchema(db);
    const b = (await request.json().catch(() => ({}))).settings || {};
    const before = await rewardsSettings(db);
    const next = { ...before };
    for (const k of NUMBERS) if (b[k] !== undefined && b[k] !== '') next[k] = Number(b[k]);
    if (b.live !== undefined) next.live = !!b.live;
    if (b.paidMembersStartGold !== undefined) next.paidMembersStartGold = !!b.paidMembersStartGold;
    // Tiers: Red, Gold, Star (names fixed); points needed, purchase multiplier, early ticket access, extra benefits.
    if (Array.isArray(b.tiers)) {
      next.tiers = before.tiers.map((t, i) => {
        const x = b.tiers[i] || {};
        const clean = v => String(v || '').replace(/<[^>]*>/g, '').trim().slice(0, 140);
        return { ...t, min: Number(x.min ?? t.min), multiplier: Number(x.multiplier ?? t.multiplier), presaleHours: Number(x.presaleHours ?? t.presaleHours),
          benefits: Array.isArray(x.benefits) ? x.benefits.map(clean).filter(Boolean) : t.benefits };
      });
    }
    if (b.seasonStart !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.seasonStart)) || Number.isNaN(Date.parse(b.seasonStart))) return fail('Season start: a real date.');
      next.seasonStart = String(b.seasonStart);
    }
    const problem = settingsProblem(next);
    if (problem) return fail(problem);
    await db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('rewards_settings', ?, datetime('now'), ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(JSON.stringify(next), admin.email || admin.name || 'owner').run();
    await logLeague(db, { email: admin.email || admin.name || 'owner' }, next.live !== before.live ? (next.live ? 'rewards.live.on' : 'rewards.live.off') : 'rewards.settings', 'rewards', 'settings', before, next);
    return ok({ settings: next });
  } catch (err) {
    console.error('[rewards admin] save', err);
    return fail('Could not save.', 500);
  }
}
