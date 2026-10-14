// Lobi Stars Rewards: the rewards catalogue and redemptions.
// Points are deducted and the reward created in ONE database batch, guarded by
// the fan's balance, the stock and the per-fan limit, with a unique key per
// click, so a double click or two tabs can never spend points twice.
// Points have no cash value: there is no cash-out anywhere.
import { ensureRewardsSchema, rewardsSettings, rewardsMember, memberNo, addLedger } from './rewards.js';
import { tierStatus } from './rewardsTiers.js';
import { tierRank } from './rewardsRules.js';
import { vtuSend, vtuConfigured, NETWORKS } from './vtu.js';
import { sendEmail } from './email.js';
import { randomId } from './crypto.js';

export const TYPES = ['voucher', 'ticket', 'airtime', 'data', 'experience', 'physical'];
// Fan-facing filter groups.
export const GROUPS = { ticket: 'Tickets', airtime: 'Airtime & Data', data: 'Airtime & Data', experience: 'Experiences', physical: 'Shop' };
const groupOf = it => (it.type === 'voucher' ? (it.config.kind === 'food' ? 'Food' : 'Shop') : GROUPS[it.type]);

// Starting catalogue from the programme spec. TODO (club): confirm every
// points cost and value; set stock for the limited items (0 = not available yet).
const SEED = [
  { id: 'airtime-500', name: '₦500 airtime', type: 'airtime', points: 100, sort: 10, description: 'Airtime on MTN, Airtel, Glo or 9mobile, sent straight to your phone.', config: { amountKobo: 50000 } },
  { id: 'ticket-popular', name: 'Free Popular Stand ticket', type: 'ticket', points: 200, sort: 20, description: 'One Popular Stand ticket for a Lobi Stars home match of your choice.', config: { tier: 'Regular' } },
  { id: 'food-1500', name: '₦1,500 food & drinks voucher', type: 'voucher', points: 300, sort: 30, description: 'For in-seat food and drinks at MatchDay Kitchen.', config: { kind: 'food', valueKobo: 150000 } },
  { id: 'data-2000', name: '₦2,000 data bundle', type: 'data', points: 400, sort: 40, description: 'A data bundle on MTN, Airtel, Glo or 9mobile.', config: { amountKobo: 200000, dataCodes: {} } },
  { id: 'free-printing', name: 'Free name & number printing', type: 'voucher', points: 600, sort: 50, description: 'Your name and number printed free on a shirt bought on lobistarsfc.com.', config: { kind: 'shop', appliesTo: 'personalisation' } },
  { id: 'jersey-5000-off', name: '₦5,000 off any jersey', type: 'voucher', points: 1000, sort: 60, description: 'Money off any official jersey bought on lobistarsfc.com.', config: { kind: 'shop', appliesTo: 'jersey', valueKobo: 500000 } },
  { id: 'official-cap', name: 'Free official cap', type: 'physical', points: 1000, sort: 65, description: 'Collect an official Lobi Stars cap from the club shop.', config: {} },
  { id: 'vip-upgrade', name: 'VIP Sitting for one home match', type: 'ticket', points: 1500, sort: 70, description: 'One VIP Sitting ticket for a Lobi Stars home match of your choice.', config: { tier: 'VIP' } },
  { id: 'free-jersey', name: 'Free official home or away jersey', type: 'physical', points: 2500, sort: 80, description: 'Choose home or away and your size; collect from the club shop.', config: {} },
  { id: 'pitchside', name: 'Pitchside matchday experience', type: 'experience', points: 5000, sort: 90, stock: 0, description: 'Watch the warm-up from pitchside at a home match. Limited places.', config: {} },
  { id: 'signed-jersey', name: 'Signed match-worn jersey', type: 'physical', points: 8000, sort: 100, stock: 0, description: 'A match-worn jersey signed by the players. Limited stock.', config: {} },
];

let ready = false;
export async function ensureCatalogueSchema(db) {
  if (ready) return;
  await ensureRewardsSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS rewards_catalogue (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image TEXT,
      type TEXT NOT NULL CHECK (type IN ('voucher', 'ticket', 'airtime', 'data', 'experience', 'physical')),
      points INTEGER NOT NULL CHECK (points > 0),
      config_json TEXT NOT NULL DEFAULT '{}',
      stock INTEGER,                 -- NULL = unlimited; goes down by one per redemption
      per_fan_limit INTEGER,         -- NULL = no limit
      min_age INTEGER,               -- e.g. 18 for alcohol-sponsored rewards
      min_tier TEXT,                 -- 'gold' / 'star' or NULL
      sponsor TEXT,                  -- partner id (optional)
      starts_at TEXT, ends_at TEXT,
      active INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 100,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rewards_redemptions (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      type TEXT NOT NULL,
      points INTEGER NOT NULL,
      status TEXT NOT NULL,          -- issued, used, expired | processing, delivered, retry, manual, failed | requested, confirmed, fulfilled, collected | refunded
      idem_key TEXT NOT NULL UNIQUE, -- one per click: a double click can't redeem twice
      details_json TEXT NOT NULL DEFAULT '{}',
      voucher_code TEXT UNIQUE, value_kobo INTEGER, expires_at TEXT,
      ticket_order_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, provider_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rewards_redemptions_member ON rewards_redemptions (member_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rewards_redemptions_status ON rewards_redemptions (status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rewards_codes (
      member_id TEXT NOT NULL, item_id TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (member_id, item_id))`),
  ]);
  // Seed the starting catalogue once (never overwrites the club's changes).
  const seeded = await db.prepare(`SELECT value FROM settings WHERE key = 'rewards_catalogue_seeded'`).first();
  if (!seeded) {
    await db.batch(SEED.map(it => db.prepare(`INSERT OR IGNORE INTO rewards_catalogue (id, name, description, type, points, config_json, stock, per_fan_limit, sort, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'setup')`)
      .bind(it.id, it.name, it.description, it.type, it.points, JSON.stringify(it.config), it.stock ?? null, it.type === 'physical' || it.type === 'experience' ? 1 : null, it.sort)));
    await db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('rewards_catalogue_seeded', ?)`).bind(new Date().toISOString()).run();
  }
  ready = true;
}

const toItem = r => {
  let config = {}; try { config = JSON.parse(r.config_json || '{}'); } catch { /* keep {} */ }
  const it = { id: r.id, name: r.name, description: r.description, image: r.image || null, type: r.type, points: r.points, config,
    stock: r.stock, perFanLimit: r.per_fan_limit, minAge: r.min_age, minTier: r.min_tier, sponsor: r.sponsor || null,
    startsAt: r.starts_at, endsAt: r.ends_at, active: !!r.active, archived: !!r.archived, sort: r.sort };
  it.group = groupOf(it);
  return it;
};

export async function listItems(db, { all = false } = {}) {
  await ensureCatalogueSchema(db);
  const { results } = await db.prepare(`SELECT * FROM rewards_catalogue ${all ? '' : 'WHERE active = 1 AND archived = 0'} ORDER BY sort, points`).all();
  const now = Date.now();
  return results.map(toItem).filter(it => all || ((!it.startsAt || Date.parse(it.startsAt) <= now) && (!it.endsAt || Date.parse(it.endsAt) > now)));
}

/** Spendable points: available balance minus points held for unpaid "pay with points" checkouts. */
export async function spendable(db, memberId) {
  const r = await db.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN points END), 0) + COALESCE(SUM(CASE WHEN status = 'PENDING' AND points < 0 THEN points END), 0) AS n FROM rewards_ledger WHERE member_id = ?`).bind(memberId).first();
  return Number(r?.n) || 0;
}

const ageOn = (dob, now = Date.now()) => (dob ? Math.floor((now - Date.parse(`${dob}T00:00:00Z`)) / (365.25 * 864e5)) : null);

/** Can this fan redeem this item now? { ok, reason, short } (short = points still needed). */
export async function eligibility(db, member, item, { balance, tierKey, used }) {
  if (item.stock !== null && item.stock !== undefined && item.stock <= 0) return { ok: false, reason: 'Out of stock' };
  if (item.perFanLimit && used >= item.perFanLimit) return { ok: false, reason: 'You have already redeemed this' };
  if (item.minAge) {
    const age = ageOn(member?.date_of_birth);
    if (age === null) return { ok: false, reason: `${item.minAge}+ only: add your date of birth to your profile` };
    if (age < item.minAge) return { ok: false, reason: `${item.minAge}+ only` };
  }
  if (item.minTier && tierKey) {
    const s = await rewardsSettings(db);
    if (tierRank(tierKey, s.tiers) < tierRank(item.minTier, s.tiers)) return { ok: false, reason: `For ${s.tiers.find(t => t.key === item.minTier)?.name || item.minTier} members` };
  }
  if (balance < item.points) return { ok: false, short: item.points - balance, reason: `You need ${(item.points - balance).toLocaleString('en-NG')} more points` };
  return { ok: true };
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function voucherCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = [...b].map(x => CODE_CHARS[x % CODE_CHARS.length]).join('');
  return `LSR-${s.slice(0, 4)}-${s.slice(4)}`;
}
const sha256 = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');

/** Emails a 6-digit code for a big redemption. Returns the code in local tests (FANS_DEV_LINKS=1). */
export async function sendRedeemCode(env, memberId, item) {
  const db = env.DB;
  const m = await rewardsMember(db, memberId);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  await db.prepare(`INSERT INTO rewards_codes (member_id, item_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(member_id, item_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`)
    .bind(memberId, item.id, await sha256(`${env.SESSION_SECRET}:${memberId}:${item.id}:${code}`), Date.now() + 10 * 60e3).run();
  if (env.RESEND_API_KEY) {
    await sendEmail(env, { to: m.email, subject: `Your Lobi Stars Rewards code: ${code}`, html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><p>Hi ${String(m.first_name).replace(/[<>&]/g, '')},</p><p>Your code to redeem <strong>${item.name.replace(/[<>&]/g, '')}</strong> for ${item.points.toLocaleString('en-NG')} Pride Points is:</p><p style="font-size:30px;font-weight:bold;letter-spacing:6px">${code}</p><p>It works for 10 minutes. If you didn't ask for it, ignore this email: no points have been used.</p></div>` }).catch(err => console.error('[rewards] code email', err));
  }
  return String(env.FANS_DEV_LINKS) === '1' ? code : null;
}

async function checkRedeemCode(env, memberId, itemId, code) {
  const db = env.DB;
  const r = await db.prepare(`SELECT * FROM rewards_codes WHERE member_id = ? AND item_id = ?`).bind(memberId, itemId).first();
  if (!r || r.expires_at < Date.now() || r.attempts >= 5) return false;
  if (r.code_hash !== await sha256(`${env.SESSION_SECRET}:${memberId}:${itemId}:${String(code || '').trim()}`)) {
    await db.prepare(`UPDATE rewards_codes SET attempts = attempts + 1 WHERE member_id = ? AND item_id = ?`).bind(memberId, itemId).run();
    return false;
  }
  await db.prepare(`DELETE FROM rewards_codes WHERE member_id = ? AND item_id = ?`).bind(memberId, itemId).run();
  return true;
}

/** Gives the points back for a redemption that could not be delivered (once). */
export async function refundRedemption(env, red, reason) {
  const db = env.DB;
  const r = await db.prepare(`UPDATE rewards_redemptions SET status = 'refunded', last_error = ?, updated_at = datetime('now') WHERE id = ? AND status NOT IN ('refunded', 'delivered', 'used', 'fulfilled', 'collected')`).bind(String(reason).slice(0, 200), red.id).run();
  if (!r.meta.changes) return false;
  if (red.type !== 'voucher' && red.type !== 'ticket') await db.prepare(`UPDATE rewards_catalogue SET stock = stock + 1 WHERE id = ? AND stock IS NOT NULL`).bind(red.item_id).run();
  return addLedger(db, { memberId: red.member_id, type: 'REVERSE', points: red.points, source: 'redeem', sourceRef: `refund:${red.id}`, description: `Points returned: ${red.item_name} (${reason})` });
}

/**
 * Redeems an item. opts: { key (unique per click), code (for big ones), network, phone, eventId, notes }.
 * Returns { ok, redemption } or { ok: false, status, error, needCode }.
 */
export async function redeem(env, memberId, itemId, opts = {}) {
  const db = env.DB;
  await ensureCatalogueSchema(db);
  const s = await rewardsSettings(db);
  const m = await rewardsMember(db, memberId);
  if (!m || m.status !== 'active') return { ok: false, status: 403, error: 'Join Lobi Stars Rewards first.' };
  if (!m.email_verified) return { ok: false, status: 403, error: 'Confirm your email address first.' };
  const item = (await listItems(db)).find(i => i.id === itemId);
  if (!item) return { ok: false, status: 404, error: 'That reward is not available.' };
  const key = String(opts.key || '').slice(0, 64);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return { ok: false, status: 400, error: 'Please try again.' };
  const done = await db.prepare(`SELECT * FROM rewards_redemptions WHERE idem_key = ?`).bind(key).first();
  if (done) return done.member_id === memberId ? { ok: true, redemption: publicRedemption(done), repeat: true } : { ok: false, status: 409, error: 'Please try again.' };

  const [balance, st, usedRow] = await Promise.all([spendable(db, memberId), tierStatus(db, memberId), db.prepare(`SELECT COUNT(*) AS n FROM rewards_redemptions WHERE member_id = ? AND item_id = ? AND status != 'refunded'`).bind(memberId, itemId).first()]);
  const el = await eligibility(db, m, item, { balance, tierKey: st.tier.key, used: Number(usedRow?.n) || 0 });
  if (!el.ok) return { ok: false, status: 409, error: el.reason };

  // What the fan chose for this reward.
  const details = {};
  if (item.type === 'airtime' || item.type === 'data') {
    const { normalizeNigerianPhone } = await import('./fans.js');
    if (!NETWORKS[opts.network]) return { ok: false, status: 400, error: 'Choose your network: MTN, Airtel, Glo or 9mobile.' };
    const phone = normalizeNigerianPhone(opts.phone || m.phone_e164 || '');
    if (!phone) return { ok: false, status: 400, error: 'Enter a valid Nigerian mobile number.' };
    if (item.type === 'data' && !item.config.dataCodes?.[opts.network] && vtuConfigured(env) && !env.VTU_FAKE) {
      // No bundle code for this network yet: staff send it by hand.
      details.manual = true;
    }
    Object.assign(details, { network: opts.network, phone });
  }
  if (item.type === 'ticket') {
    const { catalogue } = await import('./ticketShop.js');
    const cat = await catalogue(env);
    const c = cat.get(String(opts.eventId || ''));
    if (!c || !c.event.is_home || c.ticket.state !== 'on_sale') return { ok: false, status: 400, error: 'Choose a home match that is on sale.' };
    const t = c.ticket.tiers.find(x => x.tier === item.config.tier);
    if (!t) return { ok: false, status: 400, error: 'That stand is not sold for this match.' };
    if (t.remaining !== null && t.remaining < 1) return { ok: false, status: 409, error: 'That stand is sold out for this match.' };
    Object.assign(details, { eventId: c.event.id, match: `${c.event.home_team} vs ${c.event.away_team}`, kickoff: c.event.event_date, tier: item.config.tier });
  }
  if (item.type === 'experience' || item.type === 'physical') details.notes = String(opts.notes || '').replace(/<[^>]*>/g, '').trim().slice(0, 300);
  if (item.points >= s.redeemCodeThreshold) {
    if (!opts.code) return { ok: false, status: 428, needCode: true, error: `Redeeming ${item.points.toLocaleString('en-NG')} points needs the 6-digit code we email you.` };
    if (!(await checkRedeemCode(env, memberId, item.id, opts.code))) return { ok: false, status: 400, needCode: true, error: "That code didn't work. Check it or ask for a new one." };
  }

  // One batch (a transaction): the redemption only inserts if the points,
  // stock and per-fan limit still allow it; the points and stock follow it.
  const id = randomId('RDM', 10);
  const code = item.type === 'voucher' ? voucherCode() : null;
  const expires = item.type === 'voucher' ? new Date(Date.now() + s.voucherDays * 864e5).toISOString() : null;
  const status = { voucher: 'issued', ticket: 'processing', airtime: 'processing', data: 'processing', experience: 'requested', physical: 'requested' }[item.type];
  const res = await db.batch([
    db.prepare(`INSERT INTO rewards_redemptions (id, member_id, item_id, item_name, type, points, status, idem_key, details_json, voucher_code, value_kobo, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN points END), 0) + COALESCE(SUM(CASE WHEN status = 'PENDING' AND points < 0 THEN points END), 0) FROM rewards_ledger WHERE member_id = ?) >= ?
        AND COALESCE((SELECT stock FROM rewards_catalogue WHERE id = ?), 1) > 0
        AND (? IS NULL OR (SELECT COUNT(*) FROM rewards_redemptions WHERE member_id = ? AND item_id = ? AND status != 'refunded') < ?)`)
      .bind(id, memberId, item.id, item.name, item.type, item.points, status, key, JSON.stringify(details), code, item.config.valueKobo ?? null, expires,
        memberId, item.points, item.id, item.perFanLimit ?? null, memberId, item.id, item.perFanLimit ?? 0),
    db.prepare(`INSERT INTO rewards_ledger (member_id, type, points, status, source, source_ref, description, available_at)
      SELECT ?, 'REDEEM', ?, 'AVAILABLE', 'redeem', ?, ?, ? WHERE EXISTS (SELECT 1 FROM rewards_redemptions WHERE id = ?)`)
      .bind(memberId, -item.points, id, `Redeemed: ${item.name}`, new Date().toISOString(), id),
    db.prepare(`UPDATE rewards_catalogue SET stock = stock - 1 WHERE id = ? AND stock IS NOT NULL AND EXISTS (SELECT 1 FROM rewards_redemptions WHERE id = ?)`).bind(item.id, id),
  ]).catch(err => { if (/UNIQUE/i.test(String(err))) return null; throw err; });
  if (!res || !res[0].meta.changes) {
    const again = await db.prepare(`SELECT * FROM rewards_redemptions WHERE idem_key = ?`).bind(key).first();
    if (again && again.member_id === memberId) return { ok: true, redemption: publicRedemption(again), repeat: true };
    return { ok: false, status: 409, error: 'Not enough points, or that reward has just run out.' };
  }
  let red = await db.prepare(`SELECT * FROM rewards_redemptions WHERE id = ?`).bind(id).first();
  red = await fulfil(env, red, m);
  await redemptionEmail(env, red, m).catch(err => console.error('[rewards] redemption email', err));
  return { ok: true, redemption: publicRedemption(red) };
}

/** Delivers what was redeemed: a ticket, a top-up (or the manual queue), or nothing more to do. */
async function fulfil(env, red, m) {
  const db = env.DB;
  const d = JSON.parse(red.details_json || '{}');
  if (red.type === 'ticket') {
    const { holdLineStatement } = await import('./ticketShop.js');
    const { fulfillOrder } = await import('./fulfillOrder.js');
    const orderId = `${red.id}-T`;
    const held = await holdLineStatement(db, { orderId, basketId: null, eventId: d.eventId, tier: d.tier, quantity: 1, unitKobo: 0, buyer: { name: `${m.first_name} ${m.last_name}`, email: m.email, phone: m.phone_e164 || m.phone || '' }, reference: `RWD-${red.id}` }).run();
    if (!held.meta.changes) { await refundRedemption(env, red, 'that stand sold out'); }
    else {
      const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
      await fulfillOrder(env, order, null);
      await db.prepare(`UPDATE rewards_redemptions SET status = 'issued', ticket_order_id = ?, updated_at = datetime('now') WHERE id = ?`).bind(orderId, red.id).run();
    }
  }
  if (red.type === 'airtime' || red.type === 'data') await topUp(env, red);
  return db.prepare(`SELECT * FROM rewards_redemptions WHERE id = ?`).bind(red.id).first();
}

/** Tries a top-up once: delivered, retry later, manual queue, or (after the last try) refund. */
export async function topUp(env, red) {
  const db = env.DB;
  const s = await rewardsSettings(db);
  const d = JSON.parse(red.details_json || '{}');
  const item = (await listItems(db, { all: true })).find(i => i.id === red.item_id) || { config: {} };
  if (d.manual) { await db.prepare(`UPDATE rewards_redemptions SET status = 'manual', updated_at = datetime('now') WHERE id = ?`).bind(red.id).run(); return; }
  const r = await vtuSend(env, { kind: red.type, network: d.network, phone: d.phone, amountKobo: item.config.amountKobo, dataCode: item.config.dataCodes?.[d.network], requestId: `${red.id}-${red.attempts + 1}` });
  if (!r.configured) { await db.prepare(`UPDATE rewards_redemptions SET status = 'manual', updated_at = datetime('now') WHERE id = ?`).bind(red.id).run(); return; }
  const attempts = red.attempts + 1;
  if (r.ok) { await db.prepare(`UPDATE rewards_redemptions SET status = 'delivered', attempts = ?, provider_ref = ?, updated_at = datetime('now') WHERE id = ?`).bind(attempts, r.providerRef || null, red.id).run(); return; }
  if (attempts >= s.vtuMaxAttempts) {
    await db.prepare(`UPDATE rewards_redemptions SET attempts = ?, last_error = ? WHERE id = ?`).bind(attempts, r.error || 'failed', red.id).run();
    await refundRedemption(env, { ...red, attempts }, 'top-up failed');
    return;
  }
  await db.prepare(`UPDATE rewards_redemptions SET status = 'retry', attempts = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`).bind(attempts, r.error || 'failed', red.id).run();
}

/** The Rewards job: retry failed top-ups (a few minutes apart) and mark old vouchers expired. */
export async function redemptionSweep(env) {
  const db = env.DB;
  await ensureCatalogueSchema(db);
  const { results } = await db.prepare(`SELECT * FROM rewards_redemptions WHERE status = 'retry' AND updated_at <= datetime('now', '-5 minutes') LIMIT 50`).all();
  for (const r of results) await topUp(env, r);
  const ex = await db.prepare(`UPDATE rewards_redemptions SET status = 'expired', updated_at = datetime('now') WHERE status = 'issued' AND type = 'voucher' AND expires_at < ?`).bind(new Date().toISOString()).run();
  return { retried: results.length, expired: ex.meta.changes };
}

const STATUS_TEXT = {
  issued: 'Ready to use', used: 'Used', expired: 'Expired', processing: 'Processing', delivered: 'Delivered', retry: 'Processing (retrying)',
  manual: 'Processing (sent by the club)', failed: 'Failed', refunded: 'Points returned', requested: 'Requested', confirmed: 'Confirmed', fulfilled: 'Done', collected: 'Collected',
};
export function publicRedemption(r) {
  const d = JSON.parse(r.details_json || '{}');
  return { id: r.id, item: r.item_name, itemId: r.item_id, type: r.type, points: r.points, status: r.status, statusText: STATUS_TEXT[r.status] || r.status,
    voucherCode: r.voucher_code || null, valueKobo: r.value_kobo, expiresAt: r.expires_at, ticketOrderId: r.ticket_order_id, createdAt: r.created_at,
    network: d.network ? NETWORKS[d.network] : null, phone: d.phone ? d.phone.replace(/^(\+234\d{3})\d{4}(\d{3})$/, '$1••••$2') : null, match: d.match || null, notes: d.notes || null };
}

async function redemptionEmail(env, red, m) {
  if (!env.RESEND_API_KEY || red.status === 'refunded') return;
  const r = publicRedemption(red);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const body = r.voucherCode ? `<p>Your voucher code:</p><p style="font-size:26px;font-weight:bold;letter-spacing:3px">${esc(r.voucherCode)}</p><p>Use it by ${esc(new Date(r.expiresAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric' }))}. It can be used once.</p>`
    : r.type === 'ticket' ? `<p>Your ticket for <strong>${esc(r.match)}</strong> has been sent in a separate email with its QR code.</p>`
    : r.type === 'airtime' || r.type === 'data' ? `<p>We are sending it to ${esc(r.network)} ${esc(r.phone)}. If it doesn't arrive, your points are returned automatically.</p>`
    : '<p>The club will contact you to arrange it.</p>';
  await sendEmail(env, { to: m.email, subject: `You redeemed: ${red.item_name} – Lobi Stars Rewards`, html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto"><h2 style="color:#A3161B">${esc(red.item_name)}</h2><p>Hi ${esc(m.first_name)}, you used ${red.points.toLocaleString('en-NG')} Pride Points (member ${esc(memberNo(m.seq))}).</p>${body}<p><a href="https://lobistarsfc.com/fans/account/">See your rewards</a></p><p style="font-size:12px;color:#888">Pride Points have no cash value.</p></div>` });
}
