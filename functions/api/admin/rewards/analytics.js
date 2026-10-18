import { freshCodeCheck, exportName } from '../../_lib/exportGuard.js';
import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { ensureRewardsSchema, rewardsSettings, memberNo } from '../../_lib/rewards.js';
import { ensureCatalogueSchema } from '../../_lib/rewardsCatalogue.js';
import { rewardsTierMap } from '../../_lib/rewardsTiers.js';
import { buildXlsx } from '../../_lib/xlsx.js';

// Admin › Rewards › Reports.
// GET                 -> { summary, months, sources, tiers, rewards, flags } (figures for the charts + checks)
// GET ?format=xlsx    -> the same as an Excel file, plus every member (needs "can export fan data")
// Flags are things to look at, not proof of cheating: staff decide (suspend or adjust in Admin › Rewards).
const SOURCE_LABELS = {
  ticket_order: 'Match tickets', shop_order: 'Shop', food_order: 'MatchDay Kitchen', membership: 'Membership', attendance: 'Home match attendance',
  vote: 'Man of the Match votes', prediction: 'Predict & Win', referral: 'Referrals', birthday: 'Birthdays', admin: 'Club adjustments', welcome: 'Welcome bonus',
  profile: 'Profile bonus', newsletter: 'Newsletter bonus', alerts: 'Match alerts bonus', first_purchase: 'First purchase bonus', programme: 'Match Day Programme',
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function figures(db) {
  await ensureRewardsSchema(db);
  await ensureCatalogueSchema(db);
  const s = await rewardsSettings(db);
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - 11, 1); since.setUTCHours(0, 0, 0, 0);
  const sinceSql = since.toISOString().slice(0, 10);
  const [tot, mem, months, joins, src, red, tierMap] = await Promise.all([
    db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN type IN ('EARN', 'BONUS') AND status != 'REVERSED' THEN points END), 0) AS issued,
        COALESCE(SUM(CASE WHEN type IN ('EARN', 'BONUS') AND status = 'PENDING' THEN points END), 0) AS pending,
        COALESCE(-SUM(CASE WHEN type = 'REDEEM' AND status = 'AVAILABLE' THEN points WHEN type = 'REVERSE' AND source = 'redeem' THEN points END), 0) AS used,
        COALESCE(-SUM(CASE WHEN type = 'EXPIRE' THEN points END), 0) AS expired,
        COALESCE(SUM(CASE WHEN type = 'ADJUST' THEN points END), 0) AS adjusted,
        COALESCE(-SUM(CASE WHEN type = 'REVERSE' AND source != 'redeem' THEN points END), 0) AS taken_back,
        COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN points END), 0) AS outstanding
      FROM rewards_ledger`).first(),
    db.prepare(`SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(status = 'suspended') AS suspended, SUM(joined_at >= datetime('now', '-30 days')) AS joined30 FROM rewards_members`).first(),
    db.prepare(`SELECT substr(created_at, 1, 7) AS ym,
        COALESCE(SUM(CASE WHEN type IN ('EARN', 'BONUS') AND status != 'REVERSED' THEN points END), 0) AS issued,
        COALESCE(-SUM(CASE WHEN type = 'REDEEM' AND status = 'AVAILABLE' THEN points WHEN type = 'REVERSE' AND source = 'redeem' THEN points END), 0) AS used,
        COALESCE(-SUM(CASE WHEN type = 'EXPIRE' THEN points END), 0) AS expired
      FROM rewards_ledger WHERE created_at >= ? GROUP BY ym`).bind(sinceSql).all(),
    db.prepare(`SELECT substr(joined_at, 1, 7) AS ym, COUNT(*) AS n FROM rewards_members WHERE joined_at >= ? GROUP BY ym`).bind(sinceSql).all(),
    db.prepare(`SELECT source, COALESCE(SUM(points), 0) AS points, COUNT(*) AS n FROM rewards_ledger WHERE type IN ('EARN', 'BONUS') AND status != 'REVERSED' GROUP BY source ORDER BY points DESC`).all(),
    db.prepare(`SELECT item_name, COUNT(*) AS n, COALESCE(SUM(points), 0) AS points FROM rewards_redemptions WHERE status != 'refunded' GROUP BY item_name ORDER BY n DESC LIMIT 15`).all(),
    rewardsTierMap(db),
  ]);
  const byMonth = new Map(months.results.map(r => [r.ym, r]));
  const joinMonth = new Map(joins.results.map(r => [r.ym, r.n]));
  const monthList = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(since); d.setUTCMonth(since.getUTCMonth() + i);
    const ym = d.toISOString().slice(0, 7), r = byMonth.get(ym) || {};
    monthList.push({ month: ym, label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), issued: Number(r.issued) || 0, used: Number(r.used) || 0, expired: Number(r.expired) || 0, joined: Number(joinMonth.get(ym)) || 0 });
  }
  const tiers = s.tiers.map(t => ({ key: t.key, name: t.name, members: [...tierMap.values()].filter(x => x.status === 'active' && x.tierKey === t.key).length }));
  return {
    s, tierMap,
    summary: {
      members: Number(mem.total) || 0, active: Number(mem.active) || 0, suspended: Number(mem.suspended) || 0, joined30: Number(mem.joined30) || 0,
      issued: Number(tot.issued) || 0, pending: Number(tot.pending) || 0, used: Number(tot.used) || 0, expired: Number(tot.expired) || 0, adjusted: Number(tot.adjusted) || 0, takenBack: Number(tot.taken_back) || 0,
      outstanding: Number(tot.outstanding) || 0, outstandingKobo: (Number(tot.outstanding) || 0) * s.pointValueKobo, pointValueKobo: s.pointValueKobo,
    },
    months: monthList,
    sources: src.results.map(r => ({ source: r.source, label: SOURCE_LABELS[r.source] || r.source, points: Number(r.points), count: Number(r.n) })),
    tiers,
    rewards: red.results.map(r => ({ item: r.item_name, count: Number(r.n), points: Number(r.points) })),
  };
}

/** Accounts worth a look. Each: { type, label, members: [{ memberNo, name, email }], detail }. */
async function fraudFlags(db) {
  const who = `SELECT r.member_id, r.seq, m.first_name, m.last_name, m.email FROM rewards_members r JOIN members m ON m.id = r.member_id`;
  const person = r => ({ memberNo: memberNo(r.seq), name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), email: r.email });
  const cols = new Set((await db.prepare(`PRAGMA table_info(members)`).all()).results.map(c => c.name));
  const flags = [];
  const group = async (col, type, label, min, detail) => {
    if (!cols.has(col)) return;
    const { results } = await db.prepare(`SELECT w.*, m2.${col} AS k FROM (${who}) w JOIN members m2 ON m2.id = w.member_id
      WHERE m2.${col} IN (SELECT m3.${col} FROM members m3 JOIN rewards_members r3 ON r3.member_id = m3.id WHERE m3.${col} IS NOT NULL AND m3.${col} != '' GROUP BY m3.${col} HAVING COUNT(*) >= ?)
      ORDER BY k LIMIT 300`).bind(min).all();
    const by = new Map();
    for (const r of results) { const a = by.get(r.k) || []; a.push(person(r)); by.set(r.k, a); }
    for (const [, members] of by) flags.push({ type, label, members, detail: detail(members.length) });
  };
  await group('signup_device', 'device', 'Several accounts made on one device', 3, n => `${n} Rewards accounts were created on the same browser.`);
  // (Phone numbers are unique per fan account, so there is no "shared phone" check.)
  const ref = await db.prepare(`SELECT f.reason, w.* FROM rewards_referrals f JOIN (${who}) w ON w.member_id = f.referrer_member_id WHERE f.status = 'flagged' ORDER BY f.created_at DESC LIMIT 100`).all();
  for (const r of ref.results) flags.push({ type: 'referral', label: 'Referral held back', members: [person(r)], detail: r.reason || 'A referral by this member was not rewarded (looks like their own second account).' });
  const spike = await db.prepare(`SELECT w.*, x.n FROM (SELECT member_id, SUM(points) AS n FROM rewards_ledger WHERE type IN ('EARN', 'BONUS') AND status != 'REVERSED' AND source != 'admin' AND created_at >= datetime('now', '-7 days') GROUP BY member_id HAVING n >= 1000) x JOIN (${who}) w ON w.member_id = x.member_id ORDER BY x.n DESC LIMIT 50`).all();
  for (const r of spike.results) flags.push({ type: 'spike', label: 'Many points in a week', members: [person(r)], detail: `${Number(r.n).toLocaleString('en-NG')} Star Points earned in the last 7 days.` });
  const rev = await db.prepare(`SELECT w.*, x.n FROM (SELECT member_id, COUNT(*) AS n FROM rewards_ledger WHERE type = 'REVERSE' AND source != 'redeem' AND created_at >= datetime('now', '-90 days') GROUP BY member_id HAVING n >= 2) x JOIN (${who}) w ON w.member_id = x.member_id ORDER BY x.n DESC LIMIT 50`).all();
  for (const r of rev.results) flags.push({ type: 'refunds', label: 'Points taken back after refunds', members: [person(r)], detail: `${r.n} purchases refunded or disputed after earning points (last 90 days).` });
  const many = await db.prepare(`SELECT w.*, x.n FROM (SELECT member_id, COUNT(*) AS n FROM rewards_redemptions WHERE created_at >= datetime('now', '-1 day') GROUP BY member_id HAVING n >= 5) x JOIN (${who}) w ON w.member_id = x.member_id LIMIT 50`).all();
  for (const r of many.results) flags.push({ type: 'redeems', label: 'Many rewards in a day', members: [person(r)], detail: `${r.n} rewards redeemed in the last 24 hours.` });
  const adj = await db.prepare(`SELECT w.*, x.n, x.by FROM (SELECT member_id, SUM(ABS(points)) AS n, GROUP_CONCAT(DISTINCT created_by) AS by FROM rewards_ledger WHERE type = 'ADJUST' AND created_at >= datetime('now', '-90 days') GROUP BY member_id HAVING n >= 1000) x JOIN (${who}) w ON w.member_id = x.member_id ORDER BY x.n DESC LIMIT 50`).all();
  for (const r of adj.results) flags.push({ type: 'adjust', label: 'Large manual adjustments', members: [person(r)], detail: `${Number(r.n).toLocaleString('en-NG')} points added or removed by staff in the last 90 days (${r.by || 'staff'}).` });
  return flags;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const xlsx = url.searchParams.get('format') === 'xlsx';
  const { admin, denied } = await requireAdminUser(request, env, { needExport: xlsx });
  if (denied) return denied;
  if (xlsx) { const needCode = await freshCodeCheck(request, env, admin); if (needCode) return needCode; }
  try {
    const db = env.DB;
    const f = await figures(db);
    const flags = await fraudFlags(db);
    if (!xlsx) {
      const { s, tierMap, ...out } = f;
      return Response.json({ ...out, flags, live: !!s.live }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const naira = k => Math.round(k / 100);
    const members = await db.prepare(`SELECT r.member_id, r.seq, r.status, r.joined_at, m.first_name, m.last_name, m.email, m.phone_e164, m.state FROM rewards_members r JOIN members m ON m.id = r.member_id ORDER BY r.seq`).all();
    const sheets = [
      { name: 'Summary', columns: ['Measure', 'Value'], rows: [
        ['Exported (UTC)', new Date().toISOString().slice(0, 16).replace('T', ' ')], ['Exported by', admin.name || admin.email || ''],
        ['Rewards members', f.summary.members], ['Active', f.summary.active], ['On hold', f.summary.suspended], ['Joined in the last 30 days', f.summary.joined30],
        ['Star Points issued (all time)', f.summary.issued], ['Pending (tickets before the match)', f.summary.pending], ['Used on rewards and at checkout', f.summary.used],
        ['Expired', f.summary.expired], ['Taken back after refunds', f.summary.takenBack], ['Club adjustments (net)', f.summary.adjusted], ['Points in fans\' balances now', f.summary.outstanding],
        [`Value of those points (₦, at ₦${naira(f.s.pointValueKobo)} per point)`, naira(f.summary.outstandingKobo)],
      ] },
      { name: 'By month', columns: ['Month', 'Points issued', 'Points used', 'Points expired', 'New members'], rows: f.months.map(m => [m.month, m.issued, m.used, m.expired, m.joined]) },
      { name: 'How points are earned', columns: ['Way', 'Star Points', 'Times'], rows: f.sources.map(x => [x.label, x.points, x.count]) },
      { name: 'Tiers', columns: ['Tier', 'Active members'], rows: f.tiers.map(t => [t.name, t.members]) },
      { name: 'Rewards redeemed', columns: ['Reward', 'Times', 'Star Points'], rows: f.rewards.map(r => [r.item, r.count, r.points]) },
      { name: 'Members', columns: ['Member No', 'First Name', 'Surname', 'Email', 'Phone', 'State', 'Status', 'Tier', 'Earned this season', 'Star Points', 'Joined'],
        rows: members.results.map(m => { const t = f.tierMap.get(m.member_id) || {}; return [memberNo(m.seq), m.first_name || '', m.last_name || '', m.email || '', m.phone_e164 || '', m.state || '', m.status === 'active' ? 'Active' : 'On hold', t.tier || '', t.earned || 0, t.balance || 0, String(m.joined_at || '').slice(0, 10)]; }) },
      { name: 'Checks', columns: ['Check', 'Members', 'Detail'], rows: flags.map(x => [x.label, x.members.map(p => `${p.memberNo} ${p.name} <${p.email}>`).join('; '), x.detail]) },
    ];
    await logAdminAction(db, admin, 'export_rewards_xlsx', `Rewards report: ${members.results.length} members`);
    return new Response(buildXlsx(sheets), { headers: { 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${exportName('lobi-stars-rewards', admin, 'xlsx')}"`, 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[rewards admin] analytics', err);
    return Response.json({ error: 'Could not load the report.' }, { status: 500 });
  }
}

