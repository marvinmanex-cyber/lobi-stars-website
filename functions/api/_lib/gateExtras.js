// Gate Control extras (free, best practice at stadium gates):
//  - Offline list: each phone keeps today's tickets so scanning carries on when the
//    stadium's mobile data drops; offline check-ins are sent when the signal returns
//    and anyone let in twice while offline is flagged ("double entry").
//  - Supervisor broadcasts to every steward's screen.
//  - Incident log (medical, lost child, ejection, crowd, fake-ticket seller, …).
//  - Watch list: tickets tried more than once, bursts of fake tickets at a gate.
//  - End-of-day report (CSV of every scan).
import { ensureGateSchema, gateSettings, gcLog, oneLine, clean } from './gateControl.js';
import { checkTicket, dayStart } from './gateCheck.js';
import { parseTicketInput } from './gateTicketNumber.js';
import { todaysHomeMatch, ensureSeasonSchema } from './seasonTickets.js';
import { ensureTicketShopSchema } from './ticketShop.js';
import { ensureDiscountSchema } from './ticketDiscounts.js';
import { TIER_LABELS } from './tickets/rules.js';

const nowIso = () => new Date().toISOString();
const first = n => String(n || '').trim().split(/\s+/)[0] || '';

let ready = false;
async function ensureExtras(db) {
  await ensureGateSchema(db);
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, text TEXT NOT NULL, gate TEXT,
      from_name TEXT, from_code TEXT, until TEXT NOT NULL, cleared_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, gate TEXT, user_id TEXT, name TEXT, code TEXT,
      category TEXT NOT NULL, details TEXT, ticket_id TEXT,
      status TEXT NOT NULL DEFAULT 'open', closed_at TEXT, closed_by TEXT, close_note TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS gc_incidents_at ON gc_incidents (at)`),
  ]);
  ready = true;
}

// ── Offline list ──
/** Today's tickets for this phone: ticket number, stand, child?, first name, already in? (no phone or email). */
export async function offlinePack(env) {
  const db = env.DB;
  await ensureGateSchema(db); await ensureTicketShopSchema(db); await ensureDiscountSchema(db); await ensureSeasonSchema(db);
  const match = await todaysHomeMatch(db).catch(() => null);
  const { stands } = await gateSettings(db);
  if (!match) return { match: null, at: nowIso(), stands, tickets: [] };
  const rows = (await db.prepare(`SELECT t.id, t.tier, t.ticket_type, t.status, o.buyer_name FROM tickets t JOIN orders o ON o.id = t.order_id
    WHERE t.event_id = ? AND o.payment_status = 'paid' AND o.refunded_at IS NULL AND t.status != 'void'`).bind(match.id).all()).results;
  const season = (await db.prepare(`SELECT p.id, p.tier, p.holder_name, (SELECT 1 FROM season_pass_scans s WHERE s.pass_id = p.id AND s.event_id = ?) AS used
    FROM season_passes p JOIN season_orders o ON o.id = p.order_id WHERE p.status = 'valid' AND o.payment_status = 'paid'`).bind(match.id).all().catch(() => ({ results: [] }))).results;
  return {
    match: { id: match.id, name: `${match.home_team} vs ${match.away_team}`, date: match.event_date }, at: nowIso(), stands,
    // [ticket number, stand, child (1/0), first name, already in (1/0)]
    tickets: rows.map(r => [r.id, r.tier, r.ticket_type === 'child' ? 1 : 0, first(r.buyer_name), r.status === 'used' ? 1 : 0])
      .concat(season.map(p => [p.id, p.tier, 0, first(p.holder_name), p.used ? 1 : 0])),
  };
}
/** Offline check-ins sent when the signal returns. Each one is checked in now; a ticket already used elsewhere is a double entry. */
export async function syncOffline(env, scans, who, request) {
  const db = env.DB;
  const list = (Array.isArray(scans) ? scans : []).slice(0, 500);
  const out = { sent: list.length, admitted: 0, doubles: [], other: [] };
  for (const s of list) {
    // Sent twice (the answer was lost on a weak signal): already checked in by this person offline, not a double entry.
    const id = parseTicketInput(s.ticket).id;
    if (id && await db.prepare(`SELECT 1 FROM gc_scans s LEFT JOIN tickets t ON t.id = s.ticket_id
        WHERE s.ticket_id = ? AND s.result = 'admitted' AND s.how = 'offline' AND s.staff_user_id = ? AND s.at >= ? AND (t.id IS NULL OR t.status = 'used')`).bind(id, who.user.id, dayStart()).first()) { out.admitted++; continue; }
    const when = Date.parse(s.at) ? new Date(s.at).toISOString() : nowIso();
    const r = await checkTicket(env, String(s.ticket || '').slice(0, 300), { mode: 'admit', how: 'offline', who, override: true,
      note: `Offline check-in at ${new Date(when).toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' })}` });
    if (r.code === 'admitted') out.admitted++;
    else if (r.code === 'used') { out.doubles.push(r.ticket?.id || s.ticket); await gcLog(db, who.user, `Double entry: ${r.ticket?.id || s.ticket} was let in offline but had already been checked in`, { kind: 'scan', details: r.reason, request }); }
    else out.other.push({ ticket: r.ticket?.id || s.ticket, code: r.code, reason: r.reason });
  }
  if (list.length) await gcLog(db, who.user, `Sent ${list.length} offline check-in${list.length === 1 ? '' : 's'} (${out.admitted} new${out.doubles.length ? `, ${out.doubles.length} double entr${out.doubles.length === 1 ? 'y' : 'ies'}` : ''})`, { kind: 'scan', request });
  return out;
}

// ── Broadcasts ──
export async function postMessage(db, user, { text, gate, hours = 3 }, request) {
  await ensureExtras(db);
  const t = oneLine(text, 240);
  if (t.length < 3) return { error: 'Write the message first.' };
  const { gates } = await gateSettings(db);
  const g = gate && gates.includes(gate) ? gate : null;
  const until = new Date(Date.now() + Math.max(0.25, Math.min(12, Number(hours) || 3)) * 3600e3).toISOString();
  await db.prepare(`INSERT INTO gc_messages (at, text, gate, from_name, from_code, until) VALUES (?, ?, ?, ?, ?, ?)`).bind(nowIso(), t, g, user.name, user.code, until).run();
  await gcLog(db, user, `Sent a message to ${g || 'every gate'}`, { kind: 'message', details: t, request });
  return { ok: true };
}
export async function clearMessage(db, user, id, request) {
  await ensureExtras(db);
  const m = await db.prepare(`SELECT * FROM gc_messages WHERE id = ?`).bind(Number(id) || 0).first();
  if (!m) return { error: 'That message no longer exists.' };
  await db.prepare(`UPDATE gc_messages SET until = ?, cleared_by = ? WHERE id = ?`).bind(nowIso(), `${user.name} (${user.code})`, m.id).run();
  await gcLog(db, user, 'Took down a message', { kind: 'message', details: m.text, request });
  return { ok: true };
}
/** Messages showing now for this gate (newest first). */
export async function liveMessages(db, gate, all = false) {
  await ensureExtras(db);
  // Supervisors (all gates) see every message showing now.
  return (await db.prepare(`SELECT id, at, text, gate, from_name, from_code FROM gc_messages WHERE until > ? AND (gate IS NULL OR gate = ? OR ?) ORDER BY id DESC LIMIT 5`).bind(nowIso(), gate || '', all ? 1 : 0).all()).results
    .map(m => ({ id: m.id, at: m.at, text: m.text, gate: m.gate, from: m.from_name }));
}
export async function todaysMessages(db) {
  await ensureExtras(db);
  return (await db.prepare(`SELECT * FROM gc_messages WHERE at >= ? ORDER BY id DESC LIMIT 30`).bind(dayStart()).all()).results
    .map(m => ({ id: m.id, at: m.at, text: m.text, gate: m.gate, from: m.from_name, live: m.until > nowIso() }));
}

// ── Incidents ──
export const INCIDENTS = {
  medical: 'Medical / first aid', lost_child: 'Lost child', crowd: 'Crowding / crush risk', aggression: 'Aggression or fight',
  ejection: 'Fan refused or removed', fake_seller: 'Fake tickets / tout', lost_property: 'Lost property', safety: 'Safety hazard', other: 'Other',
};
export async function addIncident(db, user, { category, details, ticket }, request) {
  await ensureExtras(db);
  if (!INCIDENTS[category]) return { error: 'Choose what happened.' };
  const d = clean(details, 1000);
  if (d.length < 3) return { error: 'Write a few words about what happened.' };
  const r = await db.prepare(`INSERT INTO gc_incidents (at, gate, user_id, name, code, category, details, ticket_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(nowIso(), user.gate || null, user.id, user.name, user.code, category, d, oneLine(ticket, 40) || null).run();
  await gcLog(db, user, `Reported an incident: ${INCIDENTS[category]}`, { kind: 'incident', details: d, request });
  return { ok: true, id: r.meta?.last_row_id };
}
export async function closeIncident(db, user, { id, note }, request) {
  await ensureExtras(db);
  const i = await db.prepare(`SELECT * FROM gc_incidents WHERE id = ?`).bind(Number(id) || 0).first();
  if (!i) return { error: 'That incident no longer exists.' };
  if (i.status === 'closed') return { error: 'Already closed.' };
  await db.prepare(`UPDATE gc_incidents SET status = 'closed', closed_at = ?, closed_by = ?, close_note = ? WHERE id = ?`).bind(nowIso(), `${user.name} (${user.code})`, oneLine(note, 300) || null, i.id).run();
  await gcLog(db, user, `Closed incident #${i.id}: ${INCIDENTS[i.category] || i.category}`, { kind: 'incident', details: note, request });
  return { ok: true };
}
export async function listIncidents(db, { userId = '', day = '' } = {}) {
  await ensureExtras(db);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(Date.parse(`${day}T00:00:00Z`) - 3600e3).toISOString() : dayStart();
  const to = new Date(Date.parse(from) + 24 * 3600e3).toISOString();
  const rows = (await db.prepare(`SELECT * FROM gc_incidents WHERE at >= ? AND at < ? ${userId ? 'AND user_id = ?' : ''} ORDER BY status = 'open' DESC, id DESC LIMIT 200`)
    .bind(...[from, to, ...(userId ? [userId] : [])]).all()).results;
  return rows.map(i => ({ id: i.id, at: i.at, gate: i.gate, by: `${i.name}${i.code ? ` (${i.code})` : ''}`, category: i.category, label: INCIDENTS[i.category] || i.category,
    details: i.details, ticket: i.ticket_id, open: i.status === 'open', closedAt: i.closed_at, closedBy: i.closed_by, closeNote: i.close_note }));
}
export async function openIncidentCount(db) {
  await ensureExtras(db);
  return (await db.prepare(`SELECT COUNT(*) AS n FROM gc_incidents WHERE status = 'open' AND at >= ?`).bind(dayStart()).first())?.n || 0;
}

// ── Watch list ──
export async function watchList(db) {
  await ensureGateSchema(db);
  const since = dayStart();
  const repeats = (await db.prepare(`SELECT ticket_id, COUNT(*) AS n, GROUP_CONCAT(DISTINCT gate) AS gates, MAX(at) AS last, MAX(result) AS result
    FROM gc_scans WHERE at >= ? AND ticket_id IS NOT NULL AND result IN ('used', 'fake') GROUP BY ticket_id HAVING n >= 2 ORDER BY last DESC LIMIT 20`).bind(since).all()).results
    .map(r => ({ ticket: r.ticket_id, tries: r.n, gates: r.gates || '', last: r.last, fake: r.result === 'fake' }));
  const bursts = (await db.prepare(`SELECT COALESCE(gate, 'No gate') AS gate, COUNT(*) AS n FROM gc_scans WHERE at >= ? AND result IN ('fake', 'not_lobi') GROUP BY 1 HAVING n >= 3 ORDER BY n DESC`)
    .bind(new Date(Date.now() - 30 * 60e3).toISOString()).all()).results;
  const doubles = (await db.prepare(`SELECT ticket_id, gate, staff_name, at FROM gc_scans WHERE at >= ? AND how = 'offline' AND result = 'used' ORDER BY id DESC LIMIT 20`).bind(since).all()).results
    .map(r => ({ ticket: r.ticket_id, gate: r.gate, by: r.staff_name, at: r.at }));
  return { repeats, bursts, doubles };
}

// ── End-of-day report ──
const RESULT = { admitted: 'Checked in', readmitted: 'Re-admitted', lookup: 'Looked up', used: 'Refused: already used', fake: 'Refused: fake', not_lobi: 'Refused: not a Lobi Stars ticket',
  wrong_match: 'Refused: wrong match', wrong_gate: 'Sent to another gate', void: 'Refused: cancelled', unpaid: 'Refused: not paid', bad_number: 'Number mistyped' };
const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export async function reportCsv(db, day = '') {
  await ensureGateSchema(db);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(Date.parse(`${day}T00:00:00Z`) - 3600e3).toISOString() : dayStart();
  const to = new Date(Date.parse(from) + 24 * 3600e3).toISOString();
  const rows = (await db.prepare(`SELECT * FROM gc_scans WHERE at >= ? AND at < ? ORDER BY id`).bind(from, to).all()).results;
  const lag = iso => new Date(Date.parse(iso) + 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  const lines = [['Time (Nigeria)', 'Result', 'Ticket', 'Stand', 'Gate', 'Steward', 'Staff ID', 'How', 'Note'].join(',')]
    .concat(rows.map(r => [lag(r.at), RESULT[r.result] || r.result, r.ticket_id || r.raw, TIER_LABELS[r.tier] || '', r.gate, r.staff_name, r.staff_code, r.how, r.note].map(cell).join(',')));
  return `﻿${lines.join('\r\n')}\r\n`;
}
