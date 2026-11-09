// MatchDay Kitchen goal deals: when Lobi Stars score at a home match, food is a set percentage off for
// a few minutes (e.g. 10% off for 10 minutes). Set by supervisors and Super Admins in MatchDay Kitchen
// › Menu and prices. Started by the goal itself (the same moment as the goal alert to fans). The
// discount is worked out on the server at checkout and saved on the order (deal_kobo), so the
// sales reports count it like Star Points and vouchers.
const DEFAULT = { enabled: false, percent: 10, minutes: 10 };
const nowIso = () => new Date().toISOString();

let ready = false;
async function ensure(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS food_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`).run().catch(() => {});
  const cols = new Set((await db.prepare(`PRAGMA table_info(food_orders)`).all()).results.map(r => r.name));
  if (!cols.has('deal_kobo')) await db.prepare(`ALTER TABLE food_orders ADD COLUMN deal_kobo INTEGER NOT NULL DEFAULT 0`).run().catch(() => {});
  ready = true;
}
const getVal = async (db, key) => (await db.prepare(`SELECT value FROM food_settings WHERE key = ?`).bind(key).first())?.value ?? null;
const putVal = (db, key, value, by) => db.prepare(`INSERT INTO food_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(key, String(value), nowIso(), by || null).run();

/** The settings and, if one is running, when the current deal ends. */
export async function goalDeal(db, now = Date.now()) {
  await ensure(db);
  let s = {};
  try { s = JSON.parse((await getVal(db, 'goalDeal')) || '{}'); } catch { /* defaults */ }
  const conf = { ...DEFAULT, ...s };
  const until = await getVal(db, 'goalDealUntil');
  const active = conf.enabled && until && Date.parse(until) > now;
  return { ...conf, activeUntil: active ? until : null };
}
export async function saveGoalDeal(db, b, by) {
  await ensure(db);
  const percent = Math.round(Number(b.percent)), minutes = Math.round(Number(b.minutes));
  if (!(percent >= 5 && percent <= 50)) return { error: 'The goal deal must be between 5% and 50% off.' };
  if (!(minutes >= 3 && minutes <= 20)) return { error: 'The goal deal must last between 3 and 20 minutes.' };
  const next = { enabled: !!b.enabled, percent, minutes };
  await putVal(db, 'goalDeal', JSON.stringify(next), by);
  if (!next.enabled) await putVal(db, 'goalDealUntil', '', by);
  return { ok: true, ...next };
}
/** A Lobi Stars goal: starts (or restarts) the deal. Returns the deal, or null if switched off. */
export async function startGoalDeal(db, now = Date.now()) {
  const d = await goalDeal(db, now);
  if (!d.enabled) return null;
  const until = new Date(now + d.minutes * 60e3).toISOString();
  await putVal(db, 'goalDealUntil', until, 'Goal');
  return { ...d, activeUntil: until };
}
/** The discount on this basket right now (kobo, whole naira), or 0. */
export async function goalDiscount(db, subtotalKobo, now = Date.now()) {
  const d = await goalDeal(db, now);
  if (!d.activeUntil) return { dealKobo: 0, deal: null };
  const dealKobo = Math.floor((subtotalKobo * d.percent) / 100 / 100) * 100;
  return { dealKobo, deal: { percent: d.percent, until: d.activeUntil } };
}
