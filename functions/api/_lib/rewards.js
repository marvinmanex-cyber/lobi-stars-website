// Lobi Stars Rewards (Pride Points), Phase 1: membership and the points LEDGER.
// Reuses the fan accounts (members table, session cookie, email verification).
// Every change to a fan's points is one row in rewards_ledger; the balance is
// the sum of AVAILABLE rows. Each earning has a unique (source, source_ref),
// so the same order or event can never award points twice. Points are only
// ever awarded on the server. Points have no cash value.
const DEFAULTS = {
  welcomeBonus: 50,        // on joining (once the email is verified)
  profileBonus: 20,        // state of residence + date of birth added
  termsVersion: '2026-10-draft',
  // Until the programme launches, the Rewards sign-up box, the account-page
  // section and /rewards stay hidden (staff preview: /rewards/?preview=1).
  live: false,
};

export const LEDGER_TYPES = ['EARN', 'BONUS', 'REDEEM', 'EXPIRE', 'REVERSE', 'ADJUST'];
export const LEDGER_STATUSES = ['PENDING', 'AVAILABLE', 'REVERSED'];
export const SOURCES = ['ticket_order', 'shop_order', 'food_order', 'membership', 'attendance', 'vote', 'prediction', 'referral', 'birthday', 'admin', 'welcome', 'profile'];

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
  ready = true;
}

/** Programme settings (all editable later in Admin › Rewards; these are the starting defaults). */
export async function rewardsSettings(db) {
  try {
    const r = await db.prepare(`SELECT value FROM settings WHERE key = 'rewards_settings'`).first();
    return { ...DEFAULTS, ...(r?.value ? JSON.parse(r.value) : {}) };
  } catch { return { ...DEFAULTS }; }
}

export async function rewardsMember(db, memberId) {
  return db.prepare(`SELECT r.*, m.email_verified, m.first_name, m.last_name, m.email, m.state, m.date_of_birth
    FROM rewards_members r JOIN members m ON m.id = r.member_id WHERE r.member_id = ?`).bind(memberId).first();
}

/**
 * Adds one ledger row. Idempotent: a second call with the same (source,
 * sourceRef) does nothing and returns false. EARN and BONUS rows need an
 * active rewards member with a verified email.
 */
export async function addLedger(db, { memberId, type, points, status = 'AVAILABLE', source, sourceRef, description, availableAt = null, createdBy = null }) {
  if (!LEDGER_TYPES.includes(type) || !LEDGER_STATUSES.includes(status) || !SOURCES.includes(source)) throw new Error('bad ledger row');
  if (!Number.isInteger(points) || !sourceRef || !description) throw new Error('bad ledger row');
  if (type === 'EARN' || type === 'BONUS') {
    const m = await rewardsMember(db, memberId);
    if (!m || m.status !== 'active' || !m.email_verified) return false;
  }
  const r = await db.prepare(`INSERT OR IGNORE INTO rewards_ledger (member_id, type, points, status, source, source_ref, description, available_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(memberId, type, points, status, source, String(sourceRef), String(description).slice(0, 200), status === 'AVAILABLE' ? (availableAt || new Date().toISOString()) : availableAt, createdBy).run();
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
