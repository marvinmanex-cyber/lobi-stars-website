// Official membership, one season at a time.
//
// A fan account becomes a confirmed member for a season when staff confirm
// the payment (Admin -> Members) or, if online payment is switched on in the
// CMS, when the Paystack payment succeeds. Confirmed members get the digital
// membership card, members-only stories and the ticket priority window.
// (Signing up on /membership alone does NOT make someone a member.)
import settings from '../../../src/data/membership.json';
import { ensureFanSchema } from './fans.js';

export const MEMBERSHIP = {
  priceKobo: Math.round(Number(settings.priceNaira || 0) * 100),
  onlinePayment: settings.onlinePayment === true && Number(settings.priceNaira) > 0,
  howToPay: String(settings.howToPay || ''),
};

let ready = false;
export async function ensureMembershipSchema(db) {
  if (ready) return;
  await ensureFanSchema(db);
  const cols = new Set((await db.prepare(`PRAGMA table_info(members)`).all()).results.map(r => r.name));
  for (const [name, type] of [
    ['membership_season', 'TEXT'],     // e.g. "2026/27" once confirmed
    ['membership_since', 'TEXT'],      // when it was confirmed (ISO)
    ['membership_source', 'TEXT'],     // 'staff' or 'online'
    ['membership_note', 'TEXT'],       // staff: how it was paid / reference
  ]) if (!cols.has(name)) await db.prepare(`ALTER TABLE members ADD COLUMN ${name} ${type}`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS membership_payments (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    season TEXT NOT NULL,
    amount_kobo INTEGER NOT NULL,
    paystack_reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending / paid
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    paid_at TEXT
  )`).run();
  ready = true;
}

/** Is this member row a confirmed member for `season`? */
export const isMember = (row, season) => !!row && !!season && row.membership_season === season;

export async function setMembership(db, memberId, { season, source, note = null }) {
  await ensureMembershipSchema(db);
  return db.prepare(
    `UPDATE members SET membership_season = ?, membership_since = ?, membership_source = ?, membership_note = ? WHERE id = ?`
  ).bind(season, season ? new Date().toISOString() : null, season ? source : null, season ? note : null, memberId).run();
}

/** The signed-in fan's membership for the current season: { active, season, since } (or null if not logged in). */
export async function membershipOf(db, memberId, season) {
  if (!memberId) return null;
  await ensureMembershipSchema(db);
  const row = await db.prepare(`SELECT id, first_name, last_name, tier, membership_season, membership_since FROM members WHERE id = ?`).bind(memberId).first();
  if (!row) return null;
  return { row, active: isMember(row, season), season, since: isMember(row, season) ? row.membership_since : null };
}
