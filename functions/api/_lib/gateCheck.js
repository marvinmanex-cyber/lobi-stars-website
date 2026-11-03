// Gate Control ticket checks: read a scanned QR code or a typed ticket number,
// say whether the ticket is genuine, show everything about it (buyer, when and
// where it was bought, price, stand, adult / child) and, when asked, check the
// person in. Used by /api/gate-control/* (gateControl.js has the sign-in side).
//
// Results (`code`):
//   admitted     genuine, for today's match, checked in now           (green)
//   valid        genuine and unused (Look up only: not checked in)    (blue)
//   used         already checked in (when, at which gate, by whom)    (red)
//   wrong_match  genuine but for another match / day                  (amber)
//   void         refunded or cancelled                                (red)
//   unpaid       the order was never paid                             (red)
//   fake         a Lobi Stars-style number that does not exist        (red, FAKE)
//   not_lobi     a code that is not a Lobi Stars ticket at all        (red, FAKE)
//   bad_number   typed number with letters tickets never use          (amber: check the typing)
//   readmitted   a supervisor let a used ticket back in (with reason) (green)
// The check-in is one atomic UPDATE ... WHERE status = 'valid', so two gates
// scanning the same ticket at the same moment can never both admit it.
import { ensureGateSchema, oneLine } from './gateControl.js';
import { ensureTicketShopSchema } from './ticketShop.js';
import { ensureDiscountSchema } from './ticketDiscounts.js';
import { scanSeasonPass, todaysHomeMatch, ensureSeasonSchema } from './seasonTickets.js';
import { earnAttendance } from './rewardsEarn.js';
import { TIER_LABELS, TIERS } from './tickets/rules.js';
import { parseTicketInput } from './gateTicketNumber.js';
export { parseTicketInput };

const nowIso = () => new Date().toISOString();
const lagosDay = d => new Date(new Date(d).getTime() + 3600e3).toISOString().slice(0, 10);
const sqlTime = s => (s ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`) : null);

const maskPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 7 ? `${d.startsWith('234') ? '0' + d.slice(3, 6) : d.slice(0, 4)} *** ${d.slice(-4)}` : ''; };
const maskEmail = e => { const [u, h] = String(e || '').split('@'); return h ? `${u.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, u.length - 2)))}@${h}` : ''; };

async function ticketRow(db, id) {
  return db.prepare(`SELECT t.id, t.status, t.tier, t.ticket_type, t.used_at, t.scanned_by, t.event_id, t.unit_price_kobo AS t_price, t.discount_kobo AS t_discount,
      o.id AS order_id, o.buyer_name, o.buyer_email, o.buyer_phone, o.quantity, o.unit_price_kobo, o.total_kobo, o.payment_status, o.paid_at, o.created_at AS ordered_at,
      o.refunded_at, o.source, o.city, o.region, o.device, o.paystack_reference,
      e.home_team, e.away_team, e.event_date, e.venue, e.competition
    FROM tickets t JOIN orders o ON o.id = t.order_id JOIN events e ON e.id = t.event_id WHERE t.id = ?`).bind(id).first();
}
/** Everything the steward sees about a match ticket. */
function describe(t, lastScan) {
  const paid = t.t_price != null ? Math.max(0, t.t_price - (t.t_discount || 0)) : Math.round((t.total_kobo || 0) / Math.max(1, t.quantity || 1));
  const bought = sqlTime(t.paid_at || t.ordered_at);
  return {
    kind: 'match', id: t.id, stand: TIER_LABELS[t.tier] || t.tier, tier: t.tier, type: t.ticket_type === 'child' ? 'Child' : 'Adult',
    match: `${t.home_team} vs ${t.away_team}`, matchDate: t.event_date, venue: t.venue, competition: t.competition,
    buyer: t.buyer_name, phone: maskPhone(t.buyer_phone), email: maskEmail(t.buyer_email),
    boughtAt: bought, pricePaidKobo: paid, orderTotalKobo: t.total_kobo, ticketsInOrder: t.quantity,
    where: { source: t.source || 'Online (lobistarsfc.com)', device: t.device || null, place: [t.city, t.region].filter(Boolean).join(', ') || null },
    channel: 'Online (lobistarsfc.com, paid by card / transfer via Paystack)',
    orderId: t.order_id, paymentRef: t.paystack_reference, payment: t.refunded_at ? 'Refunded' : t.payment_status === 'paid' ? 'Paid' : t.payment_status === 'failed' ? 'Payment failed' : 'Not paid',
    status: t.status, usedAt: sqlTime(t.used_at), usedBy: t.scanned_by || null,
    usedGate: lastScan?.gate || null, usedByName: lastScan ? `${lastScan.staff_name}${lastScan.staff_code ? ` (${lastScan.staff_code})` : ''}` : null,
  };
}
async function lastAdmit(db, id) {
  return db.prepare(`SELECT * FROM gc_scans WHERE ticket_id = ? AND result IN ('admitted', 'readmitted') ORDER BY id DESC LIMIT 1`).bind(id).first();
}
async function fakeTries(db, id) {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM gc_scans WHERE ticket_id = ? AND result IN ('fake', 'used') AND at > ?`).bind(id, new Date(Date.now() - 18 * 3600e3).toISOString()).first();
  return r?.n || 0;
}
const usedLine = d => {
  const when = d.usedAt ? new Date(d.usedAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'earlier';
  return `Already checked in ${when}${d.usedGate ? ` at ${d.usedGate}` : ''}${d.usedByName ? ` by ${d.usedByName}` : d.usedBy ? ` (${d.usedBy})` : ''}.`;
};

/** Season tickets (LS-SZN-…): one entry per home match. */
async function seasonCheck(env, id, { admit, station }) {
  const db = env.DB;
  await ensureSeasonSchema(db);
  const p = await db.prepare(`SELECT p.*, o.buyer_name, o.buyer_email, o.buyer_phone, o.paid_at, o.created_at AS ordered_at, o.total_kobo, o.quantity, o.payment_status
    FROM season_passes p JOIN season_orders o ON o.id = p.order_id WHERE p.id = ?`).bind(id).first().catch(() => null);
  if (!p) return { code: 'fake', title: 'FAKE TICKET', reason: 'No Lobi Stars season ticket has this number. Do not admit.' };
  const match = await todaysHomeMatch(db);
  const ticket = {
    kind: 'season', id: p.id, stand: `${TIER_LABELS[p.tier] || p.tier} (season ${p.season})`, tier: p.tier, type: 'Adult',
    match: match ? `${match.home_team} vs ${match.away_team}` : 'No home match today', matchDate: match?.event_date || null, venue: match?.venue || null,
    buyer: p.holder_name || p.buyer_name, phone: maskPhone(p.buyer_phone), email: maskEmail(p.buyer_email), boughtAt: sqlTime(p.paid_at || p.ordered_at),
    pricePaidKobo: Math.round((p.total_kobo || 0) / Math.max(1, p.quantity || 1)), orderTotalKobo: p.total_kobo, ticketsInOrder: p.quantity,
    where: { source: 'Online (lobistarsfc.com)', device: null, place: null }, channel: 'Season ticket, bought online', payment: p.payment_status === 'paid' ? 'Paid' : 'Not paid', status: p.status,
  };
  if (p.status !== 'valid') return { code: 'void', title: 'CANCELLED', reason: 'This season ticket has been cancelled. Do not admit.', ticket };
  if (!admit) {
    const used = match ? await db.prepare(`SELECT scanned_at FROM season_pass_scans WHERE pass_id = ? AND event_id = ?`).bind(p.id, match.id).first() : null;
    return used ? { code: 'used', title: 'ALREADY USED', reason: `Already used for today's match (${used.scanned_at}).`, ticket } : { code: 'valid', title: 'VALID SEASON TICKET', reason: 'Genuine and not yet used today. Not checked in (Look up only).', ticket, eventId: match?.id };
  }
  const r = await scanSeasonPass(db, p.id, station);
  if (r.body.valid) return { code: 'admitted', title: 'ADMIT', reason: 'Season ticket checked in for today’s match.', ticket, eventId: match?.id };
  const code = /Already used/i.test(r.body.reason) ? 'used' : /No Lobi Stars home match|not this match/i.test(r.body.reason) ? 'wrong_match' : 'void';
  return { code, title: code === 'used' ? 'ALREADY USED' : code === 'wrong_match' ? 'WRONG MATCH' : 'DO NOT ADMIT', reason: r.body.reason, ticket, eventId: match?.id };
}

/**
 * Check a scanned / typed ticket. mode: 'admit' (check the person in) or 'lookup' (only show it).
 * who = { user, gate }. Every attempt is recorded in gc_scans.
 */
export async function checkTicket(env, raw, { mode = 'admit', how = 'camera', who, request } = {}) {
  const db = env.DB;
  await ensureGateSchema(db); await ensureTicketShopSchema(db); await ensureDiscountSchema(db);
  const admit = mode === 'admit';
  const gate = who?.gate || null, u = who?.user || {};
  const station = `${u.name || 'Gate Control'}${u.code ? ` (${u.code})` : ''}${gate ? ` – ${gate}` : ''}`.slice(0, 120);
  const record = (res, extra = {}) => db.prepare(`INSERT INTO gc_scans (at, ticket_id, raw, event_id, tier, result, how, gate, staff_user_id, staff_name, staff_code, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(nowIso(), extra.id || null, oneLine(raw, 200), extra.eventId || null, extra.tier || null, res, ['typed', 'scanner'].includes(how) ? how : 'camera', gate, u.id || null, u.name || null, u.code || null, extra.note || null).run()
    .catch(e => console.error('[gate control] scan record', e));

  const parsed = parseTicketInput(raw);
  if (!parsed.id) {
    await record(parsed.code);
    return { code: parsed.code, title: parsed.code === 'not_lobi' ? 'NOT A LOBI STARS TICKET' : 'CHECK THE NUMBER', reason: parsed.reason, fake: parsed.code === 'not_lobi' };
  }
  const id = parsed.id;

  if (id.startsWith('LS-SZN-')) {
    const r = await seasonCheck(env, id, { admit, station });
    await record(r.code === 'valid' ? 'lookup' : r.code, { id, eventId: r.eventId, tier: r.ticket?.tier });
    if (r.code === 'admitted') await earnAttendance(env, id).catch(() => {});
    return { ...r, fake: r.code === 'fake' };
  }

  const t = await ticketRow(db, id);
  if (!t) {
    const tries = await fakeTries(db, id);
    await record('fake', { id });
    return { code: 'fake', fake: true, title: 'FAKE TICKET', reason: `No Lobi Stars ticket has the number ${id}. Do not admit.${tries ? ` This number has been tried ${tries} time${tries === 1 ? '' : 's'} before today.` : ''}` };
  }
  let d = describe(t, t.status === 'used' ? await lastAdmit(db, id) : null);
  const base = { id, eventId: t.event_id, tier: t.tier };
  if (t.refunded_at || t.status === 'void') {
    await record('void', base);
    return { code: 'void', title: 'CANCELLED TICKET', reason: t.refunded_at ? 'This ticket was refunded. Do not admit.' : 'This ticket was cancelled. Do not admit.', ticket: d };
  }
  if (t.payment_status !== 'paid') {
    await record('unpaid', base);
    return { code: 'unpaid', title: 'NOT PAID', reason: 'This ticket was never paid for. Do not admit.', ticket: d };
  }
  if (t.status === 'used') {
    const tries = await fakeTries(db, id);
    await record('used', base);
    return { code: 'used', title: 'ALREADY USED', reason: `${usedLine(d)} Do not admit again.${tries ? ` Tried ${tries} more time${tries === 1 ? '' : 's'} since.` : ''}`, ticket: d };
  }
  if (lagosDay(t.event_date) !== lagosDay(Date.now())) {
    await record('wrong_match', base);
    const date = new Date(t.event_date).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return { code: 'wrong_match', title: 'WRONG MATCH', reason: `Genuine ticket, but for ${t.home_team} vs ${t.away_team} on ${date}. Do not admit today; it stays valid for that match.`, ticket: d };
  }
  if (!admit) {
    await record('lookup', base);
    return { code: 'valid', title: 'VALID TICKET', reason: 'Genuine and not yet used. Not checked in (Look up only).', ticket: d };
  }
  const claim = await db.prepare(`UPDATE tickets SET status = 'used', used_at = datetime('now'), scanned_by = ? WHERE id = ? AND status = 'valid'`).bind(station, id).run();
  if (!claim.meta.changes) {
    // Another gate checked it in a moment ago.
    const again = await ticketRow(db, id);
    d = describe(again, await lastAdmit(db, id));
    await record('used', base);
    return { code: 'used', title: 'ALREADY USED', reason: `${usedLine(d)} Do not admit again.`, ticket: d };
  }
  await record('admitted', base);
  await earnAttendance(env, id).catch(() => {});
  d = describe(await ticketRow(db, id), null);
  return { code: 'admitted', title: d.type === 'Child' ? 'ADMIT CHILD' : 'ADMIT', reason: d.type === 'Child' ? 'Child ticket: check the age if unsure.' : 'Genuine ticket, checked in now.', ticket: d };
}

/** A supervisor lets a used ticket back in (e.g. stepped out and came back), with a reason. */
export async function readmitTicket(env, raw, { reason, who }) {
  const db = env.DB;
  await ensureGateSchema(db);
  const parsed = parseTicketInput(raw);
  if (!parsed.id || parsed.id.startsWith('LS-SZN-')) return { error: 'Re-admit works for match tickets only.' };
  const why = oneLine(reason, 200);
  if (why.length < 4) return { error: 'Write the reason for letting this ticket back in.' };
  const t = await ticketRow(db, parsed.id);
  if (!t || t.status !== 'used') return { error: 'Only a ticket that was already checked in can be re-admitted.' };
  const u = who.user;
  await db.prepare(`INSERT INTO gc_scans (at, ticket_id, raw, event_id, tier, result, how, gate, staff_user_id, staff_name, staff_code, note) VALUES (?, ?, ?, ?, ?, 'readmitted', 'typed', ?, ?, ?, ?, ?)`)
    .bind(nowIso(), t.id, t.id, t.event_id, t.tier, who.gate || null, u.id, u.name, u.code, why).run();
  return { ok: true, code: 'readmitted', title: 'RE-ADMITTED', reason: `Let back in by ${u.name}. Reason: ${why}`, ticket: describe(t, await lastAdmit(db, t.id)) };
}

// "Today" is the match day in Nigeria: from midnight Lagos time.
const REFUSED = `'used', 'fake', 'not_lobi', 'wrong_match', 'void', 'unpaid'`;
export const dayStart = (now = Date.now()) => new Date(Date.parse(`${lagosDay(now)}T00:00:00Z`) - 3600e3).toISOString();

/** The counts on the scan screen: me, my gate, everyone (fans checked in today). Cheap: one query. */
export async function myCounts(env, user) {
  const db = env.DB;
  await ensureGateSchema(db);
  const r = await db.prepare(`SELECT
      SUM(CASE WHEN result = 'admitted' THEN 1 ELSE 0 END) AS total,
      SUM(CASE WHEN result = 'admitted' AND staff_user_id = ? THEN 1 ELSE 0 END) AS me,
      SUM(CASE WHEN result IN (${REFUSED}) AND staff_user_id = ? THEN 1 ELSE 0 END) AS me_refused,
      SUM(CASE WHEN result = 'admitted' AND gate = ? THEN 1 ELSE 0 END) AS gate
    FROM gc_scans WHERE at >= ?`).bind(user.id, user.id, user.gate || '', dayStart()).first();
  return { me: r?.me || 0, meRefused: r?.me_refused || 0, gate: { name: user.gate || '', admitted: r?.gate || 0 }, total: r?.total || 0 };
}

/** The live view: today's home match, check-ins by steward, gate, stand and time of day, refusals, the latest scans. */
export async function todayView(env, user = null) {
  const db = env.DB;
  await ensureGateSchema(db); await ensureTicketShopSchema(db);
  const match = await todaysHomeMatch(db).catch(() => null);
  const since = dayStart();
  const latest = (await db.prepare(`SELECT s.at, s.ticket_id, s.result, s.gate, s.staff_name, s.staff_code, s.how, s.tier, s.note FROM gc_scans s WHERE s.at >= ? ORDER BY s.id DESC LIMIT 30`).bind(since).all()).results;
  const counts = Object.fromEntries((await db.prepare(`SELECT result, COUNT(*) AS n FROM gc_scans WHERE at >= ? GROUP BY result`).bind(since).all()).results.map(r => [r.result, r.n]));
  const byGate = (await db.prepare(`SELECT COALESCE(gate, 'No gate') AS gate, COUNT(*) AS n FROM gc_scans WHERE at >= ? AND result = 'admitted' GROUP BY 1 ORDER BY n DESC`).bind(since).all()).results;
  // Each steward (one phone each): fans checked in, refused, re-admitted, their latest gate and scan.
  const byStaff = (await db.prepare(`SELECT staff_user_id AS id, MAX(staff_name) AS name, MAX(staff_code) AS code,
      SUM(CASE WHEN result = 'admitted' THEN 1 ELSE 0 END) AS admitted,
      SUM(CASE WHEN result IN (${REFUSED}) THEN 1 ELSE 0 END) AS refused,
      SUM(CASE WHEN result = 'readmitted' THEN 1 ELSE 0 END) AS readmitted,
      MAX(at) AS last,
      (SELECT g.gate FROM gc_scans g WHERE g.staff_user_id = s.staff_user_id AND g.at >= ? ORDER BY g.id DESC LIMIT 1) AS gate
    FROM gc_scans s WHERE at >= ? AND staff_user_id IS NOT NULL AND result != 'lookup' GROUP BY staff_user_id ORDER BY admitted DESC, last DESC`).bind(since, since).all()).results
    .map(r => ({ id: r.id, name: r.name || 'Unknown', code: r.code || '', admitted: r.admitted || 0, refused: r.refused || 0, readmitted: r.readmitted || 0, gate: r.gate || '', last: r.last, me: !!user && r.id === user.id }));
  // Check-ins through the day, in 15-minute steps (Lagos time).
  const times = (await db.prepare(`SELECT at FROM gc_scans WHERE at >= ? AND result = 'admitted' ORDER BY at`).bind(since).all()).results;
  const STEP = 15 * 60e3, buckets = new Map();
  for (const t of times) { const k = Math.floor(Date.parse(t.at) / STEP) * STEP; buckets.set(k, (buckets.get(k) || 0) + 1); }
  const timeline = [];
  if (buckets.size) {
    const keys = [...buckets.keys()], first = Math.min(...keys), last = Math.max(...keys, Math.floor(Date.now() / STEP) * STEP);
    for (let k = first; k <= last && timeline.length < 96; k += STEP) timeline.push({ at: new Date(k).toISOString(), n: buckets.get(k) || 0 });
  }
  let stands = [];
  if (match) {
    const sold = Object.fromEntries((await db.prepare(`SELECT t.tier, COUNT(*) AS n, SUM(CASE WHEN t.status = 'used' THEN 1 ELSE 0 END) AS inn FROM tickets t JOIN orders o ON o.id = t.order_id
      WHERE t.event_id = ? AND o.payment_status = 'paid' AND o.refunded_at IS NULL AND t.status != 'void' GROUP BY t.tier`).bind(match.id).all()).results.map(r => [r.tier, r]));
    stands = TIERS.map(tier => ({ tier, label: TIER_LABELS[tier], sold: sold[tier]?.n || 0, in: sold[tier]?.inn || 0 }));
  }
  const refused = ['used', 'fake', 'not_lobi', 'wrong_match', 'void', 'unpaid'].reduce((s, k) => s + (counts[k] || 0), 0);
  return {
    match: match ? { id: match.id, name: `${match.home_team} vs ${match.away_team}`, date: match.event_date, venue: match.venue } : null,
    totals: { admitted: counts.admitted || 0, readmitted: counts.readmitted || 0, refused, fake: (counts.fake || 0) + (counts.not_lobi || 0), used: counts.used || 0, lookups: counts.lookup || 0 },
    stands, byGate, byStaff, timeline,
    latest: latest.map(s => ({ at: s.at, ticket: s.ticket_id, result: s.result, gate: s.gate, by: s.staff_name ? `${s.staff_name}${s.staff_code ? ` (${s.staff_code})` : ''}` : '', how: s.how, stand: TIER_LABELS[s.tier] || '', note: s.note })),
  };
}
