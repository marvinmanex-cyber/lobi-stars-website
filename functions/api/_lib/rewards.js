// Lobi Stars Rewards (Pride Points): membership, the points LEDGER and settings.
// Earning hooks are in rewardsEarn.js; pure rules in rewardsRules.js.
// Reuses the fan accounts (members table, session cookie, email verification).
// Every change to a fan's points is one row in rewards_ledger; the balance is
// the sum of AVAILABLE rows. Each earning has a unique (source, source_ref),
// so the same order or event can never award points twice. Points are only
// ever awarded on the server. Points have no cash value.
const DEFAULTS = {
  welcomeBonus: 50,        // on joining (once the email is verified)
  profileBonus: 20,        // state of residence + date of birth added
  termsVersion: '2026-10-draft',
  // Earning (starting defaults; all editable in Admin › Rewards).
  ticketsPer100: 1,        // points per ₦100 paid for match tickets (pending until the match is played)
  shopPer100: 1,           // shirts/merchandise bought through our own checkout
  foodPer100: 1,           // in-seat food (MatchDay Kitchen)
  membershipPer100: 1,     // annual membership ...
  membershipBonus: 300,    // ... plus this bonus
  attendance: 30,          // ticket scanned at the gate (once per match)
  streakBonus: 100,        // home matches attended in a row ...
  streakLength: 3,         // ... this many
  motmVote: 5,             // Man of the Match vote
  prediction: 5,           // Predict & Win prediction submitted
  predictionCorrect: 10,   // correct result (at full-time)
  predictionExact: 30,     // exact score (at full-time)
  referral: 150,           // to the referrer, after the friend's first paid purchase
  referralMaxPerSeason: 10,
  birthday: 100,           // in the birthday month, once a year
  birthdayDobMinDays: 30,  // date of birth saved at least this many days before
  engagementMonthlyCap: 200, // votes, predictions and programme reads per calendar month (0 = no cap; attendance not included)
  // One-off actions that help the club (each once per fan).
  newsletterBonus: 20,     // signing up to the newsletter with their account email
  alertsBonus: 10,         // switching on match alerts (push notifications) while signed in
  firstPurchaseBonus: 50,  // first paid purchase on lobistarsfc.com (tickets, shop, food, membership)
  programmeRead: 5,        // opening the Match Day Programme, per programme (monthly limit applies)
  seasonStart: '2026-08-01', // first day of the current season (tiers, referral limit). Same as the CMS seasonStart.
  // Redeeming.
  redeemCodeThreshold: 1000, // redemptions of this many points or more need a 6-digit code emailed to the fan
  voucherDays: 90,           // vouchers are valid this many days
  vtuMaxAttempts: 3,         // airtime/data tries before the points are returned
  // Tiers by points EARNED this season (spending never lowers a tier).
  tierGraceMonths: 2,          // last season's tier is kept this long after the new season starts
  paidMembersStartGold: true,  // paid annual members are at least Gold for the season
  tiers: [
    // benefits: extra benefits as text; the multiplier and early-access lines are written from the numbers.
    { key: 'red', name: 'Red', min: 0, multiplier: 1, presaleHours: 0, benefits: [] },
    { key: 'gold', name: 'Gold', min: 1000, multiplier: 1.25, presaleHours: 24, benefits: ['Birthday gift'] },
    { key: 'star', name: 'Star', min: 3000, multiplier: 1.5, presaleHours: 48, benefits: ["Invitation to the end-of-season fans' event", 'Your name on the Star Fans wall (if you choose)'] },
  ],
  // Until the programme launches, the Rewards sign-up box, the account-page
  // section and /rewards stay hidden (staff preview: /rewards/?preview=1).
  live: false,
};

export const LEDGER_TYPES = ['EARN', 'BONUS', 'REDEEM', 'EXPIRE', 'REVERSE', 'ADJUST'];
export const LEDGER_STATUSES = ['PENDING', 'AVAILABLE', 'REVERSED'];
export const SOURCES = ['ticket_order', 'shop_order', 'food_order', 'membership', 'attendance', 'vote', 'prediction', 'referral', 'birthday', 'admin', 'welcome', 'profile', 'redeem', 'points_payment', 'newsletter', 'alerts', 'first_purchase', 'programme'];

// Nigeria's 36 states and the FCT (state of residence on the profile).
export const NIGERIAN_STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];

export const memberNo = seq => `LSR-${String(seq).padStart(6, '0')}`;

let ready = false;
export async function ensureRewardsSchema(db) {
  if (ready) return;
  await db.batch([
    // seq gives the member number (LSR-000123).
    db.prepare(`CREATE TABLE IF NOT EXISTS rewards_members (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      terms_version TEXT NOT NULL,
      terms_accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
      joined_via TEXT,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rewards_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('EARN', 'BONUS', 'REDEEM', 'EXPIRE', 'REVERSE', 'ADJUST')),
      points INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'AVAILABLE', 'REVERSED')),
      source TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      available_at TEXT,
      created_by TEXT,
      UNIQUE (source, source_ref))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rewards_ledger_member ON rewards_ledger (member_id, status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`),
  ]);
  const { results } = await db.prepare(`PRAGMA table_info(members)`).all();
  const cols = new Set(results.map(c => c.name));
  if (!cols.has('date_of_birth')) await db.prepare(`ALTER TABLE members ADD COLUMN date_of_birth TEXT`).run();
  if (!cols.has('state')) await db.prepare(`ALTER TABLE members ADD COLUMN state TEXT`).run();
  if (!cols.has('dob_set_at')) await db.prepare(`ALTER TABLE members ADD COLUMN dob_set_at TEXT`).run();       // birthday bonus needs the date of birth saved 30+ days before
  if (!cols.has('referred_by')) await db.prepare(`ALTER TABLE members ADD COLUMN referred_by TEXT`).run();     // referrer's member id (from ?ref= at sign-up)
  if (!cols.has('signup_device')) await db.prepare(`ALTER TABLE members ADD COLUMN signup_device TEXT`).run(); // random id from the browser (self-referral checks)
  const rc = new Set((await db.prepare(`PRAGMA table_info(rewards_members)`).all()).results.map(c => c.name));
  if (!rc.has('tier_notified')) await db.prepare(`ALTER TABLE rewards_members ADD COLUMN tier_notified TEXT`).run(); // highest tier emailed this season ("2026/27:gold")
  if (!rc.has('tier_seen')) await db.prepare(`ALTER TABLE rewards_members ADD COLUMN tier_seen TEXT`).run();         // highest tier the fan has seen the celebration for
  if (!rc.has('star_wall')) await db.prepare(`ALTER TABLE rewards_members ADD COLUMN star_wall INTEGER NOT NULL DEFAULT 0`).run(); // opt-in to the Star Fans wall
  const lc = new Set((await db.prepare(`PRAGMA table_info(rewards_ledger)`).all()).results.map(c => c.name));
  if (!lc.has('event_id')) await db.prepare(`ALTER TABLE rewards_ledger ADD COLUMN event_id TEXT`).run(); // ticket points wait for this match
  if (!lc.has('pay_ref')) await db.prepare(`ALTER TABLE rewards_ledger ADD COLUMN pay_ref TEXT`).run();   // Paystack reference (refunds/disputes reverse by it)
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rewards_ledger_pending ON rewards_ledger (status, event_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rewards_ledger_payref ON rewards_ledger (pay_ref)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rewards_referrals (
      friend_member_id TEXT PRIMARY KEY,
      referrer_member_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'awarded', 'flagged', 'capped')),
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rewards_referrals_referrer ON rewards_referrals (referrer_member_id, status)`),
  ]);
  ready = true;
}

/** Programme settings (all editable later in Admin › Rewards; these are the starting defaults). */
export const REWARDS_DEFAULTS = DEFAULTS;
export async function rewardsSettings(db) {
  try {
    const r = await db.prepare(`SELECT value FROM settings WHERE key = 'rewards_settings'`).first();
    return { ...DEFAULTS, ...(r?.value ? JSON.parse(r.value) : {}) };
  } catch { return { ...DEFAULTS }; }
}

export async function rewardsMember(db, memberId) {
  return db.prepare(`SELECT r.*, m.email_verified, m.first_name, m.last_name, m.email, m.state, m.date_of_birth, m.phone, m.phone_e164
    FROM rewards_members r JOIN members m ON m.id = r.member_id WHERE r.member_id = ?`).bind(memberId).first();
}

/**
 * Adds one ledger row. Idempotent: a second call with the same (source,
 * sourceRef) does nothing and returns false. EARN and BONUS rows need an
 * active rewards member with a verified email.
 */
export async function addLedger(db, { memberId, type, points, status = 'AVAILABLE', source, sourceRef, description, availableAt = null, createdBy = null, eventId = null, payRef = null }) {
  if (!LEDGER_TYPES.includes(type) || !LEDGER_STATUSES.includes(status) || !SOURCES.includes(source)) throw new Error('bad ledger row');
  if (!Number.isInteger(points) || !sourceRef || !description) throw new Error('bad ledger row');
  if (type === 'EARN' || type === 'BONUS') {
    const m = await rewardsMember(db, memberId);
    if (!m || m.status !== 'active' || !m.email_verified) return false;
  }
  const r = await db.prepare(`INSERT OR IGNORE INTO rewards_ledger (member_id, type, points, status, source, source_ref, description, available_at, created_by, event_id, pay_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(memberId, type, points, status, source, String(sourceRef), String(description).slice(0, 200), status === 'AVAILABLE' ? (availableAt || new Date().toISOString()) : availableAt, createdBy, eventId, payRef).run();
  return r.meta.changes > 0;
}

/** Welcome bonus (once per member, only after the email is verified). */
export async function welcomeBonus(db, memberId) {
  const s = await rewardsSettings(db);
  if (!(s.welcomeBonus > 0)) return false;
  return addLedger(db, { memberId, type: 'BONUS', points: s.welcomeBonus, source: 'welcome', sourceRef: memberId, description: 'Welcome to Lobi Stars Rewards' });
}

/** Profile bonus: once, when the state of residence and date of birth are both on the profile. */
export async function profileBonus(db, memberId) {
  const m = await rewardsMember(db, memberId);
  if (!m || !m.state || !m.date_of_birth) return false;
  const s = await rewardsSettings(db);
  if (!(s.profileBonus > 0)) return false;
  return addLedger(db, { memberId, type: 'BONUS', points: s.profileBonus, source: 'profile', sourceRef: memberId, description: 'Profile completed' });
}

/** Joins a fan account to Rewards (once). Bonuses follow when the email is verified. */
export async function joinRewards(db, memberId, via = 'site') {
  await ensureRewardsSchema(db);
  const s = await rewardsSettings(db);
  await db.prepare(`INSERT OR IGNORE INTO rewards_members (member_id, terms_version, joined_via) VALUES (?, ?, ?)`).bind(memberId, s.termsVersion, via).run();
  await welcomeBonus(db, memberId);
  await profileBonus(db, memberId);
  return rewardsMember(db, memberId);
}

/** Called after a fan verifies their email: gives the bonuses that were waiting. */
export async function rewardsOnVerified(db, memberId) {
  try {
    await ensureRewardsSchema(db);
    if (!(await db.prepare(`SELECT 1 FROM rewards_members WHERE member_id = ?`).bind(memberId).first())) return;
    await welcomeBonus(db, memberId);
    await profileBonus(db, memberId);
  } catch (err) { console.error('[rewards] on verified', err); }
}

/** Balance = AVAILABLE rows; pending = PENDING rows (e.g. tickets until the match is played). */
export async function pointsSummary(db, memberId) {
  const r = await db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN points END), 0) AS balance,
      COALESCE(SUM(CASE WHEN status = 'PENDING' THEN points END), 0) AS pending
    FROM rewards_ledger WHERE member_id = ?`).bind(memberId).first();
  return { balance: Number(r?.balance) || 0, pending: Number(r?.pending) || 0 };
}

export async function ledgerFor(db, memberId, limit = 50) {
  const { results } = await db.prepare(`SELECT id, type, points, status, source, source_ref, description, created_at, available_at FROM rewards_ledger WHERE member_id = ? ORDER BY id DESC LIMIT ?`).bind(memberId, limit).all();
  return results.map(r => ({ id: r.id, type: r.type, points: r.points, status: r.status, source: r.source, ref: r.source_ref, description: r.description, createdAt: r.created_at, availableAt: r.available_at }));
}

/** Date of birth: "YYYY-MM-DD", a real date, age 5 to 110. Returns the date or null. */
export function cleanDob(v, now = Date.now()) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return null;
  const age = (now - t) / (365.25 * 864e5);
  return age >= 5 && age <= 110 ? s : null;
}
