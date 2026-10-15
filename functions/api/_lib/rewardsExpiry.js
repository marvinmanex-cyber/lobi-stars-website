// Lobi Stars Rewards points expiry: a fan's available Star Points expire after
// `expiryMonths` (settings, default 12) with no activity. Any purchase, bonus,
// reward used or club adjustment is activity and resets the clock. Fans get an
// email 30 days before (once per quiet spell). Expired points become one EXPIRE
// row, so the history shows it. Runs only once Rewards is live.
import { ensureRewardsSchema, rewardsSettings, addLedger } from './rewards.js';
import { notify } from './rewardsNotify.js';

const WARN_DAYS = 30;
const sqlToMs = s => Date.parse(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));

/** When points with this last activity expire (ms). */
export function expiryAt(lastAt, months) {
  const d = new Date(sqlToMs(lastAt));
  d.setUTCMonth(d.getUTCMonth() + (Number(months) || 12));
  return d.getTime();
}

const lastActivitySql = `COALESCE((SELECT MAX(l.created_at) FROM rewards_ledger l WHERE l.member_id = r.member_id AND l.type NOT IN ('EXPIRE', 'REVERSE')), r.joined_at)`;
const balanceSql = `(SELECT COALESCE(SUM(l.points), 0) FROM rewards_ledger l WHERE l.member_id = r.member_id AND l.status = 'AVAILABLE')`;

async function ensureExpiryColumn(db) {
  const rc = new Set((await db.prepare(`PRAGMA table_info(rewards_members)`).all()).results.map(c => c.name));
  if (!rc.has('expiry_warned')) await db.prepare(`ALTER TABLE rewards_members ADD COLUMN expiry_warned TEXT`).run().catch(e => { if (!/duplicate column/i.test(String(e?.message))) throw e; });
}

/** For one fan: { at, days, points } when points expire within 30 days, else null. */
export async function expirySoon(db, memberId, now = Date.now()) {
  const s = await rewardsSettings(db);
  const r = await db.prepare(`SELECT ${lastActivitySql} AS last_at, ${balanceSql} AS bal FROM rewards_members r WHERE r.member_id = ?`).bind(memberId).first();
  if (!r || !(Number(r.bal) > 0)) return null;
  const at = expiryAt(r.last_at, s.expiryMonths);
  const days = Math.ceil((at - now) / 864e5);
  return days <= WARN_DAYS ? { at: new Date(at).toISOString(), days: Math.max(0, days), points: Number(r.bal) } : null;
}

/** The job: expire quiet balances and send the 30-day warnings. Returns { expired, warned }. */
export async function expirySweep(env, now = Date.now()) {
  const db = env.DB;
  await ensureRewardsSchema(db);
  await ensureExpiryColumn(db);
  const s = await rewardsSettings(db);
  const out = { expired: 0, warned: 0 };
  if (!s.live) return out;
  // Anyone quiet for (months - 30 days) or longer, with points.
  const cut = new Date(now + WARN_DAYS * 864e5); cut.setUTCMonth(cut.getUTCMonth() - s.expiryMonths);
  const cutSql = cut.toISOString().replace('T', ' ').slice(0, 19);
  const { results } = await db.prepare(`SELECT * FROM (SELECT r.member_id, r.seq, r.expiry_warned, m.email, m.first_name, ${lastActivitySql} AS last_at, ${balanceSql} AS bal
      FROM rewards_members r JOIN members m ON m.id = r.member_id WHERE r.status = 'active') WHERE bal > 0 AND last_at < ? LIMIT 500`).bind(cutSql).all();
  for (const m of results) {
    const at = expiryAt(m.last_at, s.expiryMonths);
    if (at <= now) {
      const ok = await addLedger(db, { memberId: m.member_id, type: 'EXPIRE', points: -Number(m.bal), source: 'expiry', sourceRef: `${m.member_id}:${m.last_at}`,
        description: `Points expired after ${s.expiryMonths} months with no activity` });
      if (ok) {
        out.expired++;
        await notify(env, m.member_id, { kind: 'expiry', ref: `expired:${m.last_at}`, title: 'Your Star Points have expired',
          body: `${Number(m.bal).toLocaleString('en-NG')} Star Points expired after ${s.expiryMonths} months with no activity. Points you earn from now on start a new ${s.expiryMonths}-month period.`, email: false });
      }
    } else if (m.expiry_warned !== m.last_at) {
      // Mark first, so a failed email is never sent twice in a row.
      await db.prepare(`UPDATE rewards_members SET expiry_warned = ? WHERE member_id = ?`).bind(m.last_at, m.member_id).run();
      const date = new Date(at).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric' });
      await notify(env, m.member_id, { kind: 'expiry', ref: `warn:${m.last_at}`, title: 'Your Star Points expire soon',
        body: `Your ${Number(m.bal).toLocaleString('en-NG')} Star Points expire on ${date} because there has been no activity on your account. Any purchase on lobistarsfc.com, a Predict & Win entry, a Man of the Match vote or using a reward keeps them.`,
        link: '/rewards/catalogue/' });
      out.warned++;
    }
  }
  return out;
}
