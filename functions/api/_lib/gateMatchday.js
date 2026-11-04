// Lobi Gate Control: match-day running (best practice at professional stadiums, all free):
//  - Gates open / closed: scanners only check fans in while the gates are open. Automatic
//    (from a set time before kick-off of today's home match) unless an admin opens or closes
//    them by hand for today. Gate Supervisors can still let someone in (recorded).
//  - Stand capacity: how full each stand is (fans checked in today against the stand's size),
//    a message to every gate at 90% and when full; a full stand stops check-ins for that
//    stand (a Gate Supervisor can still let someone in).
//  - Queue speed: fans per minute at each gate and the average time per fan when busy.
//  - Banned list: a ticket, or everything bought with an email / phone number, is refused
//    with DO NOT ADMIT and an incident is opened for the supervisors.
//  - Staff and media passes (LS-ACC-…): players' guests, club staff, officials, stewards,
//    security, medical, VIP guests, contractors; zones; printed with a QR code. Media
//    accreditation cards (Media Centre) scan here too.
//  - Scanner readiness (camera, offline list, gate, battery, screen kept awake), reported
//    by each phone.
//  - Practice tickets: test numbers that show each result, used in Practice mode (nothing
//    is checked in or counted).
//  - The match-day report emailed to management after the gates close.
import { ensureGateSchema, gcLog, oneLine, clean } from './gateControl.js';
import { todaysHomeMatch } from './seasonTickets.js';
import { TIER_LABELS, TIERS } from './tickets/rules.js';
import { sendEmail } from './email.js';

const nowIso = () => new Date().toISOString();
const lagosDay = d => new Date(new Date(d).getTime() + 3600e3).toISOString().slice(0, 10);
const dayStartIso = (now = Date.now()) => new Date(Date.parse(`${lagosDay(now)}T00:00:00Z`) - 3600e3).toISOString();
const hmLagos = iso => iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' }) : '';
const parse = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const normPhone = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('234') && d.length === 13) d = `0${d.slice(3)}`; if (d.length === 10 && !d.startsWith('0')) d = `0${d}`; return d.length >= 10 ? d : ''; };
export const normEmail = e => { const s = String(e || '').trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : ''; };

// ── Schema ──
let ready = false;
export async function ensureMatchdaySchema(db) {
  await ensureGateSchema(db);
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_banned (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,   -- ticket / email / phone
      value TEXT NOT NULL, name TEXT, reason TEXT NOT NULL, until TEXT,
      added_by TEXT, added_at TEXT NOT NULL, removed_at TEXT, removed_by TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS gc_banned_value ON gc_banned (value, removed_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_passes (
      id TEXT PRIMARY KEY,                       -- LS-ACC-XXXXXXXXXXXX (in the QR code)
      name TEXT NOT NULL, organisation TEXT, category TEXT NOT NULL, zones TEXT NOT NULL DEFAULT '[]',
      phone TEXT, notes TEXT, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',     -- active / revoked
      created_by TEXT, created_at TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT, last_scan_at TEXT)`),
    // (Also made by gateExtras.js; here so capacity and banned alerts can use them first.)
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, text TEXT NOT NULL, gate TEXT,
      from_name TEXT, from_code TEXT, until TEXT NOT NULL, cleared_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS gc_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, gate TEXT, user_id TEXT, name TEXT, code TEXT,
      category TEXT NOT NULL, details TEXT, ticket_id TEXT,
      status TEXT NOT NULL DEFAULT 'open', closed_at TEXT, closed_by TEXT, close_note TEXT)`),
  ]);
  // Newer columns: a message for one scanner; what each scanner last reported (readiness).
  for (const sql of [`ALTER TABLE gc_messages ADD COLUMN device_id TEXT`, `ALTER TABLE gc_devices ADD COLUMN readiness TEXT`, `ALTER TABLE gc_devices ADD COLUMN readiness_at TEXT`]) {
    try { await db.prepare(sql).run(); } catch { /* already there */ }
  }
  ready = true;
}

async function getSetting(db, key, def) {
  const r = await db.prepare(`SELECT value FROM gc_settings WHERE key = ?`).bind(key).first();
  return r ? parse(r.value, def) : def;
}
async function putSetting(db, key, value, by) {
  await db.prepare(`INSERT INTO gc_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(key, JSON.stringify(value), nowIso(), by || null).run();
}
/** A message on every scanner (or one gate / one scanner). */
export async function systemMessage(db, text, { gate = null, deviceId = null, hours = 3, from = 'Lobi Gate Control' } = {}) {
  await ensureMatchdaySchema(db);
  await db.prepare(`INSERT INTO gc_messages (at, text, gate, from_name, from_code, until, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(nowIso(), oneLine(text, 240), gate, from, 'system', new Date(Date.now() + hours * 3600e3).toISOString(), deviceId).run();
}

// ── Gates open / closed ──
// gates_state = { mode: auto | open | closed, day, at, by, openBefore (minutes before kick-off) }
export async function gatesStatus(db, match = undefined) {
  await ensureMatchdaySchema(db);
  const s = await getSetting(db, 'gates_state', {});
  const openBefore = Math.max(15, Math.min(480, Number(s.openBefore) || 180));
  if (match === undefined) match = await todaysHomeMatch(db).catch(() => null);
  const today = lagosDay(Date.now());
  const mode = s.day === today && ['open', 'closed'].includes(s.mode) ? s.mode : 'auto';
  const opensAt = match ? new Date(Date.parse(match.event_date) - openBefore * 60e3).toISOString() : null;
  const base = { mode, openBefore, opensAt, kickOff: match?.event_date || null, changedAt: mode === 'auto' ? null : s.at, changedBy: mode === 'auto' ? null : s.by };
  if (mode === 'open') return { ...base, open: true, label: `Open (opened by hand at ${hmLagos(s.at)})` };
  if (mode === 'closed') return { ...base, open: false, closed: true, closedAt: s.at, label: `Closed at ${hmLagos(s.at)}` };
  // Automatic: no home match today = open (look-ups and practice); otherwise from the set time.
  if (!match) return { ...base, open: true, label: 'No home match today' };
  const open = Date.now() >= Date.parse(opensAt);
  return { ...base, open, label: open ? `Open since ${hmLagos(opensAt)} (automatic)` : `Opening at ${hmLagos(opensAt)} (automatic)` };
}
export async function setGates(db, by, { mode, openBefore }, request) {
  await ensureMatchdaySchema(db);
  const s = await getSetting(db, 'gates_state', {});
  const m = ['auto', 'open', 'closed'].includes(mode) ? mode : null;
  const next = { ...s, openBefore: openBefore !== undefined ? Math.max(15, Math.min(480, Number(openBefore) || 180)) : (s.openBefore || 180) };
  if (m) Object.assign(next, { mode: m, day: lagosDay(Date.now()), at: nowIso(), by });
  await putSetting(db, 'gates_state', next, by);
  const st = await gatesStatus(db);
  if (m) {
    await gcLog(db, { kind: 'admin', name: by, code: by }, m === 'open' ? 'Opened the gates' : m === 'closed' ? 'Closed the gates' : 'Gates back to automatic', { kind: 'settings', details: st.label, request });
    if (m === 'open') await systemMessage(db, 'The gates are now OPEN. Start checking fans in.', { hours: 1, from: by });
    if (m === 'closed') await systemMessage(db, 'The gates are now CLOSED. Do not check anyone else in; call a supervisor.', { hours: 2, from: by });
  } else await gcLog(db, { kind: 'admin', name: by, code: by }, `Gates open automatically ${next.openBefore} minutes before kick-off`, { kind: 'settings', request });
  return { ok: true, gates: st };
}

// ── Stand capacity ──
export async function capacitySettings(db) {
  await ensureMatchdaySchema(db);
  const c = await getSetting(db, 'stand_capacity', {});
  return Object.fromEntries(TIERS.map(t => [t, Number(c[t]) > 0 ? Math.floor(Number(c[t])) : null]));
}
export async function saveCapacity(db, by, caps, request) {
  const out = Object.fromEntries(TIERS.map(t => { const n = Number(String(caps?.[t] ?? '').replace(/[,\s]/g, '')); return [t, n > 0 && n < 200000 ? Math.floor(n) : null]; }));
  await ensureMatchdaySchema(db);
  await putSetting(db, 'stand_capacity', out, by);
  await gcLog(db, { kind: 'admin', name: by, code: by }, 'Changed the stand sizes', { kind: 'settings', details: TIERS.map(t => `${TIER_LABELS[t]}: ${out[t] ?? 'no limit'}`).join(', '), request });
  return { ok: true, capacity: out };
}
/** How full each stand is today: fans checked in (match and season tickets) against its size. */
export async function capacityView(db) {
  const caps = await capacitySettings(db);
  const rows = Object.fromEntries((await db.prepare(`SELECT tier, COUNT(*) AS n FROM gc_scans WHERE at >= ? AND result = 'admitted' GROUP BY tier`).bind(dayStartIso()).all()).results.map(r => [r.tier, r.n]));
  return TIERS.map(t => {
    const inside = rows[t] || 0, cap = caps[t];
    const pct = cap ? Math.round((inside / cap) * 100) : null;
    return { tier: t, label: TIER_LABELS[t], capacity: cap, inside, pct, state: !cap ? 'none' : inside >= cap ? 'full' : pct >= 90 ? 'near' : 'ok' };
  });
}
/** Is this stand full? (checked before each check-in) */
export async function standFull(db, tier) {
  const cap = (await capacitySettings(db))[tier];
  if (!cap) return null;
  const n = (await db.prepare(`SELECT COUNT(*) AS n FROM gc_scans WHERE at >= ? AND result = 'admitted' AND tier = ?`).bind(dayStartIso(), tier).first())?.n || 0;
  return n >= cap ? { capacity: cap, inside: n } : null;
}
/** After each check-in: tell every gate once when a stand reaches 90% and when it is full. */
export async function capacityAlerts(db, tier) {
  const cap = (await capacitySettings(db))[tier];
  if (!cap) return;
  const n = (await db.prepare(`SELECT COUNT(*) AS n FROM gc_scans WHERE at >= ? AND result = 'admitted' AND tier = ?`).bind(dayStartIso(), tier).first())?.n || 0;
  const level = n >= cap ? 'full' : n >= Math.ceil(cap * 0.9) ? 'near' : null;
  if (!level) return;
  const key = `cap_alerts_${lagosDay(Date.now())}`;
  const sent = await getSetting(db, key, {});
  if (sent[`${tier}:${level}`]) return;
  sent[`${tier}:${level}`] = nowIso();
  await putSetting(db, key, sent, 'system');
  const label = TIER_LABELS[tier];
  await systemMessage(db, level === 'full'
    ? `${label} is FULL (${n.toLocaleString('en-GB')} of ${cap.toLocaleString('en-GB')}). Stop checking in ${label} tickets; call a supervisor.`
    : `${label} is 90% full (${n.toLocaleString('en-GB')} of ${cap.toLocaleString('en-GB')}).`, { hours: level === 'full' ? 4 : 1 });
  await gcLog(db, { kind: 'system', name: 'Lobi Gate Control', code: '' }, level === 'full' ? `${label} is full` : `${label} is 90% full`, { kind: 'settings', details: `${n} of ${cap}` });
}

// ── Queue speed ──
/** Fans per minute at each gate (last 5 minutes) and the average time per fan when busy (gaps under a minute, last 10 minutes). */
export async function queueView(db) {
  await ensureGateSchema(db);
  const since = new Date(Date.now() - 10 * 60e3).toISOString(), five = Date.now() - 5 * 60e3;
  const rows = (await db.prepare(`SELECT at, gate, staff_user_id, result FROM gc_scans WHERE at >= ? AND result NOT IN ('lookup', 'pass_ok', 'pass_bad') ORDER BY at`).bind(since).all()).results;
  const gates = new Map();
  const g = name => { if (!gates.has(name)) gates.set(name, { gate: name, admitted5: 0, gaps: [], scanners: new Set(), last: new Map() }); return gates.get(name); };
  for (const r of rows) {
    const x = g(r.gate || 'No gate'), t = Date.parse(r.at);
    if (r.result === 'admitted' && t >= five) x.admitted5++;
    x.scanners.add(r.staff_user_id);
    const prev = x.last.get(r.staff_user_id);
    if (prev && t - prev <= 60e3 && t - prev > 0) x.gaps.push((t - prev) / 1000);
    x.last.set(r.staff_user_id, t);
  }
  return [...gates.values()].map(x => {
    const avg = x.gaps.length >= 4 ? Math.round(x.gaps.reduce((a, b) => a + b, 0) / x.gaps.length) : null;
    return { gate: x.gate, perMinute: Math.round((x.admitted5 / 5) * 10) / 10, avgSeconds: avg, scanners: x.scanners.size,
      state: avg === null ? (x.admitted5 ? 'ok' : 'quiet') : avg >= 15 ? 'slow' : 'ok' };
  }).sort((a, b) => b.perMinute - a.perMinute);
}

// ── Banned list ──
function banKind(value) {
  const v = String(value || '').trim();
  const t = /LS-?(TIX|SZN)-?([A-HJ-NP-Z2-9]{12})/i.exec(v.toUpperCase().replace(/\s+/g, ''));
  if (t) return { kind: 'ticket', value: `LS-${t[1].toUpperCase()}-${t[2].toUpperCase()}` };
  if (normEmail(v)) return { kind: 'email', value: normEmail(v) };
  if (normPhone(v)) return { kind: 'phone', value: normPhone(v) };
  return null;
}
export async function addBan(db, by, { value, name, reason, until }, request) {
  await ensureMatchdaySchema(db);
  const k = banKind(value);
  if (!k) return { error: 'Enter a ticket number (LS-TIX-…), an email address or a phone number.' };
  const why = oneLine(reason, 200);
  if (why.length < 3) return { error: 'Write the reason (e.g. "Crowd trouble, 8 Nov").' };
  const end = /^\d{4}-\d{2}-\d{2}$/.test(until || '') ? until : null;
  if (await db.prepare(`SELECT 1 FROM gc_banned WHERE value = ? AND removed_at IS NULL`).bind(k.value).first()) return { error: 'Already on the banned list.' };
  await db.prepare(`INSERT INTO gc_banned (kind, value, name, reason, until, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(k.kind, k.value, oneLine(name, 80) || null, why, end, by, nowIso()).run();
  await gcLog(db, { kind: 'admin', name: by, code: by }, `Added to the banned list: ${k.kind === 'ticket' ? k.value : k.kind}`, { kind: 'settings', details: `${oneLine(name, 80) || ''} ${why}`.trim(), request });
  return { ok: true };
}
export async function removeBan(db, by, id, request) {
  await ensureMatchdaySchema(db);
  const r = await db.prepare(`SELECT * FROM gc_banned WHERE id = ? AND removed_at IS NULL`).bind(Number(id) || 0).first();
  if (!r) return { error: 'Not on the list.' };
  await db.prepare(`UPDATE gc_banned SET removed_at = ?, removed_by = ? WHERE id = ?`).bind(nowIso(), by, r.id).run();
  await gcLog(db, { kind: 'admin', name: by, code: by }, `Removed from the banned list: ${r.kind === 'ticket' ? r.value : r.kind}`, { kind: 'settings', details: r.name || '', request });
  return { ok: true };
}
const mask = (k, v) => k === 'email' ? v.replace(/^(.{2}).*(@.*)$/, '$1***$2') : k === 'phone' ? `${v.slice(0, 4)} *** ${v.slice(-4)}` : v;
export async function listBans(db) {
  await ensureMatchdaySchema(db);
  const today = lagosDay(Date.now());
  return (await db.prepare(`SELECT * FROM gc_banned WHERE removed_at IS NULL ORDER BY id DESC LIMIT 300`).all()).results
    .map(b => ({ id: b.id, kind: b.kind, value: mask(b.kind, b.value), name: b.name, reason: b.reason, until: b.until, expired: !!b.until && b.until < today, by: b.added_by, at: b.added_at }));
}
/** The ban that applies to this ticket (its number, or the buyer's email / phone), or null. */
export async function banFor(db, { ticketId, email, phone }) {
  await ensureMatchdaySchema(db);
  const vals = [ticketId, normEmail(email), normPhone(phone)].filter(Boolean);
  if (!vals.length) return null;
  const r = await db.prepare(`SELECT * FROM gc_banned WHERE removed_at IS NULL AND value IN (${vals.map(() => '?').join(',')}) AND (until IS NULL OR until >= ?) LIMIT 1`).bind(...vals, lagosDay(Date.now())).first();
  return r || null;
}
/** Banned fan at a gate: an open incident for the supervisors (once per ticket per day). */
export async function banIncident(db, user, ticketId, ban) {
  await ensureMatchdaySchema(db);
  if (await db.prepare(`SELECT 1 FROM gc_incidents WHERE ticket_id = ? AND category = 'ejection' AND at >= ? AND details LIKE 'BANNED%'`).bind(ticketId, dayStartIso()).first()) return;
  await db.prepare(`INSERT INTO gc_incidents (at, gate, user_id, name, code, category, details, ticket_id) VALUES (?, ?, ?, ?, ?, 'ejection', ?, ?)`)
    .bind(nowIso(), user?.gate || null, user?.id || null, user?.name || 'Lobi Gate Control', user?.code || '', `BANNED fan tried to enter${ban.name ? ` (${ban.name})` : ''}. Reason: ${ban.reason}. Refused at the gate.`, ticketId).run();
}
/** Today's ticket numbers that are banned (for the offline list on each phone). */
export async function bannedTicketsFor(db, matchId) {
  await ensureMatchdaySchema(db);
  const today = lagosDay(Date.now());
  const rows = (await db.prepare(`SELECT DISTINCT t.id FROM tickets t JOIN orders o ON o.id = t.order_id JOIN gc_banned b ON b.removed_at IS NULL AND (b.until IS NULL OR b.until >= ?)
      AND ((b.kind = 'ticket' AND b.value = t.id) OR (b.kind = 'email' AND b.value = LOWER(o.buyer_email)))
    WHERE t.event_id = ?`).bind(today, matchId).all().catch(() => ({ results: [] }))).results.map(r => r.id);
  // Phone numbers are stored in several formats: compare in code.
  const phones = (await db.prepare(`SELECT value FROM gc_banned WHERE kind = 'phone' AND removed_at IS NULL AND (until IS NULL OR until >= ?)`).bind(today).all()).results.map(r => r.value);
  if (phones.length) {
    const t = (await db.prepare(`SELECT t.id, o.buyer_phone FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.event_id = ?`).bind(matchId).all()).results;
    for (const r of t) if (phones.includes(normPhone(r.buyer_phone))) rows.push(r.id);
  }
  const season = (await db.prepare(`SELECT value FROM gc_banned WHERE kind = 'ticket' AND value LIKE 'LS-SZN-%' AND removed_at IS NULL`).all()).results.map(r => r.value);
  return [...new Set([...rows, ...season])];
}

// ── Staff and media passes ──
export const PASS_CATEGORIES = {
  guest: { label: "Player's guest", colour: '#7C3AED' }, staff: { label: 'Club staff', colour: '#0E2A55' }, official: { label: 'Match official', colour: '#111827' },
  steward: { label: 'Steward', colour: '#F59E0B' }, security: { label: 'Security', colour: '#B91C1C' }, medical: { label: 'Medical', colour: '#059669' },
  vip: { label: 'VIP guest', colour: '#B8860B' }, contractor: { label: 'Contractor / supplier', colour: '#6B7280' }, media: { label: 'Media (club)', colour: '#2563EB' },
};
export const DEFAULT_ZONES = ['All stands', 'VIP lounge', 'Pitch side', 'Dressing rooms', 'Press box', 'Media centre'];
export async function passZones(db) {
  await ensureMatchdaySchema(db);
  const z = await getSetting(db, 'pass_zones', null);
  return Array.isArray(z) && z.length ? z : DEFAULT_ZONES;
}
export async function savePassZones(db, by, list, request) {
  const z = [...new Set((Array.isArray(list) ? list : String(list || '').split(/\n|,/)).map(x => oneLine(x, 40)).filter(Boolean))].slice(0, 20);
  if (!z.length) return { error: 'Add at least one zone.' };
  await ensureMatchdaySchema(db);
  await putSetting(db, 'pass_zones', z, by);
  await gcLog(db, { kind: 'admin', name: by, code: by }, 'Changed the pass zones', { kind: 'settings', details: z.join(', '), request });
  return { ok: true, zones: z };
}
const PASS_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function passCode() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `LS-ACC-${[...b].map(x => PASS_ALPHA[x % 32]).join('')}`;
}
const passOut = p => ({ id: p.id, name: p.name, organisation: p.organisation, category: p.category, categoryLabel: PASS_CATEGORIES[p.category]?.label || p.category, colour: PASS_CATEGORIES[p.category]?.colour || '#0E2A55',
  zones: parse(p.zones, []), phone: p.phone, notes: p.notes, from: p.valid_from, to: p.valid_to, status: p.status, createdBy: p.created_by, createdAt: p.created_at, revokedAt: p.revoked_at, lastScan: p.last_scan_at });
export async function savePass(db, by, v, request) {
  await ensureMatchdaySchema(db);
  const name = oneLine(v.name, 80), cat = PASS_CATEGORIES[v.category] ? v.category : null;
  if (name.length < 2) return { error: "Write the person's full name." };
  if (!cat) return { error: 'Choose the category.' };
  const all = await passZones(db);
  const zones = (Array.isArray(v.zones) ? v.zones : []).filter(z => all.includes(z));
  if (!zones.length) return { error: 'Tick at least one zone.' };
  const from = /^\d{4}-\d{2}-\d{2}$/.test(v.from || '') ? v.from : lagosDay(Date.now());
  const to = /^\d{4}-\d{2}-\d{2}$/.test(v.to || '') ? v.to : from;
  if (to < from) return { error: 'The last day is before the first day.' };
  const row = [name, oneLine(v.organisation, 80) || null, cat, JSON.stringify(zones), normPhone(v.phone) || null, clean(v.notes, 300) || null, from, to];
  if (v.id) {
    const p = await db.prepare(`SELECT * FROM gc_passes WHERE id = ?`).bind(String(v.id)).first();
    if (!p) return { error: 'That pass no longer exists.' };
    await db.prepare(`UPDATE gc_passes SET name = ?, organisation = ?, category = ?, zones = ?, phone = ?, notes = ?, valid_from = ?, valid_to = ? WHERE id = ?`).bind(...row, p.id).run();
    await gcLog(db, { kind: 'admin', name: by, code: by }, `Changed pass ${p.id} (${name})`, { kind: 'settings', request });
    return { ok: true, pass: passOut(await db.prepare(`SELECT * FROM gc_passes WHERE id = ?`).bind(p.id).first()) };
  }
  const id = passCode();
  await db.prepare(`INSERT INTO gc_passes (name, organisation, category, zones, phone, notes, valid_from, valid_to, id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...row, id, by, nowIso()).run();
  await gcLog(db, { kind: 'admin', name: by, code: by }, `Made pass ${id}: ${name} (${PASS_CATEGORIES[cat].label})`, { kind: 'settings', details: zones.join(', '), request });
  return { ok: true, pass: passOut(await db.prepare(`SELECT * FROM gc_passes WHERE id = ?`).bind(id).first()) };
}
export async function revokePass(db, by, id, request) {
  await ensureMatchdaySchema(db);
  const p = await db.prepare(`SELECT * FROM gc_passes WHERE id = ?`).bind(String(id)).first();
  if (!p) return { error: 'That pass no longer exists.' };
  await db.prepare(`UPDATE gc_passes SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?`).bind(nowIso(), by, p.id).run();
  await gcLog(db, { kind: 'admin', name: by, code: by }, `Withdrew pass ${p.id} (${p.name})`, { kind: 'settings', request });
  return { ok: true };
}
export async function listPasses(db) {
  await ensureMatchdaySchema(db);
  return (await db.prepare(`SELECT * FROM gc_passes ORDER BY status = 'active' DESC, valid_to DESC, created_at DESC LIMIT 500`).all()).results.map(passOut);
}
/** A pass scanned at a gate (LS-ACC-…). */
export async function passCheck(db, id, { dry = false } = {}) {
  await ensureMatchdaySchema(db);
  const p = await db.prepare(`SELECT * FROM gc_passes WHERE id = ?`).bind(id).first();
  if (!p) return { code: 'fake', fake: true, title: 'FAKE PASS', reason: `No Lobi Stars pass has the number ${id}. Do not let this person in.`, record: 'fake' };
  const o = passOut(p), today = lagosDay(Date.now());
  const pass = { kind: 'pass', id: o.id, buyer: o.name, stand: o.categoryLabel, type: 'Pass', organisation: o.organisation, zones: o.zones, from: o.from, to: o.to, colour: o.colour, lastScan: o.lastScan };
  if (p.status !== 'active') return { code: 'pass_bad', title: 'PASS WITHDRAWN', reason: 'This pass has been withdrawn by the club. Do not let this person in; call a supervisor.', ticket: pass, record: 'pass_bad' };
  if (today < p.valid_from || today > p.valid_to) return { code: 'pass_bad', title: 'PASS NOT VALID TODAY', reason: `This pass is for ${p.valid_from === p.valid_to ? p.valid_from : `${p.valid_from} to ${p.valid_to}`}. Do not let this person in today.`, ticket: pass, record: 'pass_bad' };
  if (!dry) await db.prepare(`UPDATE gc_passes SET last_scan_at = ? WHERE id = ?`).bind(nowIso(), p.id).run();
  return { code: 'pass_ok', title: 'VALID PASS', reason: `Allowed in: ${o.zones.join(', ')}. Check the person matches the name.`, ticket: pass, record: 'pass_ok' };
}
/** A Media Centre accreditation card scanned at a gate (its QR code is the /media/verify/… link). */
export async function mediaPassCheck(db, token) {
  const { verifyView } = await import('./mediaAccreditation.js');
  const { ZONES } = await import('./accreditationCards.js');
  const v = await verifyView(db, token).catch(() => null);
  if (!v || v.status?.key === 'notfound') return { code: 'fake', fake: true, title: 'FAKE MEDIA CARD', reason: 'This media accreditation card is not recognised. Do not let this person in.', record: 'fake' };
  const zones = (v.zones || []).map(n => ZONES.find(z => z.n === Number(n))?.name).filter(Boolean);
  const pass = { kind: 'pass', id: v.number || 'Media card', buyer: v.fullName, stand: `Media: ${v.role}`, type: 'Pass', organisation: v.organisation, zones, colour: '#2563EB', match: v.match };
  if (v.status.key !== 'approved') return { code: 'pass_bad', title: v.status.label, reason: v.status.text, ticket: pass, record: 'pass_bad' };
  return { code: 'pass_ok', title: 'VALID MEDIA CARD', reason: `${v.match ? `${v.match}. ` : ''}Allowed in: ${zones.join(', ') || 'see the card'}. Check the photo on the card matches the person.`, ticket: pass, record: 'pass_ok' };
}
/** Passes valid today and today's approved media cards (for the offline list). */
export async function passesForOffline(db, match) {
  await ensureMatchdaySchema(db);
  const today = lagosDay(Date.now());
  const own = (await db.prepare(`SELECT * FROM gc_passes WHERE status = 'active' AND valid_from <= ? AND valid_to >= ?`).bind(today, today).all()).results
    .map(p => [p.id, p.name, PASS_CATEGORIES[p.category]?.label || p.category, parse(p.zones, []).join(', ')]);
  let media = [];
  if (match) {
    try {
      const { ZONES, zonesOf, roleInfo } = await import('./accreditationCards.js');
      media = (await db.prepare(`SELECT verify_token, full_name, role, zones, number FROM mc_accreditations WHERE event_id = ? AND status = 'approved' AND verify_token IS NOT NULL`).bind(match.id).all()).results
        .map(r => [`MEDIA:${r.verify_token}`, r.full_name, `Media: ${roleInfo(r.role).name}`, zonesOf(r).map(n => ZONES.find(z => z.n === n)?.name).filter(Boolean).join(', ')]);
    } catch { media = []; }
  }
  return own.concat(media);
}

// ── Practice tickets (Practice mode only; never in the database) ──
// Ticket numbers use only these letters and numbers (no O, I, 0, 1), so they can be typed too.
export const PRACTICE = {
  'LS-TIX-TEST2ADULT22': { result: 'admitted', label: 'Adult, Popular Stand: ADMIT', tier: 'Regular', type: 'Adult' },
  'LS-TIX-TEST3CHLD333': { result: 'admitted', label: 'Child, Popular Stand: ADMIT CHILD', tier: 'Regular', type: 'Child' },
  'LS-TIX-TEST4USED444': { result: 'used', label: 'Already used', tier: 'Regular', type: 'Adult' },
  'LS-TIX-TEST5FAKE555': { result: 'fake', label: 'Fake ticket', tier: null, type: '' },
  'LS-TIX-TEST6MATCH66': { result: 'wrong_match', label: 'Another match', tier: 'Premium', type: 'Adult' },
  'LS-TIX-TEST7STAND77': { result: 'wrong_gate', label: 'Wrong gate (VIP ticket)', tier: 'VIP', type: 'Adult' },
  'LS-TIX-TEST8BANNED8': { result: 'banned', label: 'Banned fan', tier: 'Regular', type: 'Adult' },
};
export function practiceResult(id) {
  const p = PRACTICE[id];
  if (!p) return null;
  const ticket = p.tier ? { kind: 'match', id, stand: TIER_LABELS[p.tier], tier: p.tier, type: p.type, buyer: 'Practice Fan', match: 'Practice match', pricePaidKobo: 0, payment: 'Practice', status: p.result === 'used' ? 'used' : 'valid' } : null;
  const R = {
    admitted: { title: p.type === 'Child' ? 'ADMIT CHILD' : 'ADMIT', reason: p.type === 'Child' ? 'Child ticket: check the age if unsure.' : 'Genuine ticket, checked in now.' },
    used: { title: 'ALREADY USED', reason: 'Already checked in earlier at Main Gate. Do not admit again.' },
    fake: { title: 'FAKE TICKET', reason: `No Lobi Stars ticket has the number ${id}. Do not admit.`, fake: true },
    wrong_match: { title: 'WRONG MATCH', reason: 'Genuine ticket, but for another match. Do not admit today.' },
    wrong_gate: { title: 'WRONG GATE', reason: 'This ticket is for the VIP Sitting. Send the fan to VIP Gate. Not checked in.', canOverride: true },
    banned: { title: 'DO NOT ADMIT', reason: "This fan is on the club's banned list. Do not admit. A supervisor is alerted." },
  }[p.result];
  return { code: p.result, ...R, ticket, practice: true };
}

// ── Scanner readiness (each phone reports it) ──
export async function saveReadiness(db, deviceId, v) {
  if (!deviceId) return;
  await ensureMatchdaySchema(db);
  const bat = v?.battery && typeof v.battery.level === 'number' ? { level: Math.max(0, Math.min(1, v.battery.level)), charging: !!v.battery.charging } : null;
  const r = {
    camera: ['ok', 'blocked', 'untested', 'none'].includes(v?.camera) ? v.camera : 'untested', scanner: !!v?.scanner,
    pack: v?.pack ? { n: Number(v.pack.n) || 0, at: String(v.pack.at || '').slice(0, 30), match: String(v.pack.match || '').slice(0, 40) || null } : null,
    battery: bat, wake: v?.wake === true ? true : v?.wake === false ? false : null, installed: !!v?.installed, online: v?.online !== false,
    queue: Math.max(0, Number(v?.queue) || 0), practice: Math.max(0, Number(v?.practice) || 0),
  };
  await db.prepare(`UPDATE gc_devices SET readiness = ?, readiness_at = ? WHERE id = ?`).bind(JSON.stringify(r), nowIso(), deviceId).run();
}
/** Ready / not ready, with what to fix, from what the phone last reported. */
export function readinessOf(d, match) {
  const r = parse(d.readiness, null);
  const checks = [];
  const add = (key, ok, label, fix) => checks.push({ key, ok, label, fix: ok ? '' : fix });
  const seen = d.status === 'active' && d.last_seen && Date.now() - Date.parse(d.last_seen) < 90e3;
  add('online', !!seen, 'Switched on and connected', d.status === 'waiting' ? 'Switch it on with its passcode' : 'Open Lobi Gate Control on the phone');
  add('gate', d.role === 'supervisor' || !!(d.gate || d.gate_now), 'Gate set', 'Set the gate here, or the steward taps their gate');
  add('camera', !!r && (r.camera === 'ok' || r.scanner), 'Camera (or scanner) works', r?.camera === 'blocked' ? 'The camera is blocked: allow it in the phone settings' : 'Press Scan ticket once on the phone to test the camera');
  const packOk = !match || (!!r?.pack && r.pack.match === match.id && Date.now() - Date.parse(r.pack.at) < 3 * 3600e3);
  add('offline', packOk, 'Offline ticket list downloaded', 'Open the app with a signal so it downloads today’s list');
  const b = r?.battery;
  add('battery', !b || b.charging || b.level >= 0.3, b ? `Battery ${Math.round(b.level * 100)}%${b.charging ? ' (charging)' : ''}` : 'Battery (not shown on iPhone)', 'Charge the phone or swap it (below 30%)');
  add('awake', r?.wake !== false, 'Screen kept awake', 'Tap the screen once; if it still dims, turn off battery saver');
  return { ready: checks.every(c => c.ok), checks, battery: b ? Math.round(b.level * 100) : null, charging: !!b?.charging, reportedAt: d.readiness_at, practice: r?.practice || 0, queue: r?.queue || 0, installed: !!r?.installed };
}

// ── The match-day report (emailed to management after the gates close) ──
const REFUSAL = { used: 'Already used', fake: 'Fake ticket', not_lobi: 'Not a Lobi Stars ticket', wrong_match: 'Wrong match', void: 'Cancelled / refunded', unpaid: 'Not paid', banned: 'Banned fan', gates_closed: 'Gates not open', stand_full: 'Stand full', wrong_gate: 'Sent to another gate' };
export async function reportRecipients(db, env) {
  await ensureMatchdaySchema(db);
  const saved = await getSetting(db, 'report_emails', null);
  if (Array.isArray(saved) && saved.length) return saved;
  return [...new Set(String(env.SUPER_ADMIN_EMAILS || '').split(/[\s,;]+/).map(normEmail).filter(Boolean))];
}
export async function saveReportSettings(db, by, { emails, delay }, request) {
  const list = [...new Set(String(Array.isArray(emails) ? emails.join(',') : emails || '').split(/[\s,;]+/).map(normEmail).filter(Boolean))].slice(0, 20);
  if (!list.length) return { error: 'Add at least one email address.' };
  await ensureMatchdaySchema(db);
  await putSetting(db, 'report_emails', list, by);
  if (delay !== undefined) await putSetting(db, 'report_delay', Math.max(15, Math.min(240, Number(delay) || 60)), by);
  await gcLog(db, { kind: 'admin', name: by, code: by }, 'Changed who gets the match-day report', { kind: 'settings', details: list.join(', '), request });
  return { ok: true, emails: list };
}
export async function reportDelay(db) { return Number(await getSetting(db, 'report_delay', 60)) || 60; }

/** Everything in the report for a match day (Lagos date, default today). */
export async function buildReport(env, match = null) {
  const db = env.DB;
  await ensureMatchdaySchema(db);
  if (!match) match = await todaysHomeMatch(db).catch(() => null);
  const from = dayStartIso(match ? Date.parse(match.event_date) : Date.now()), to = new Date(Date.parse(from) + 24 * 3600e3).toISOString();
  const counts = Object.fromEntries((await db.prepare(`SELECT result, COUNT(*) AS n FROM gc_scans WHERE at >= ? AND at < ? GROUP BY result`).bind(from, to).all()).results.map(r => [r.result, r.n]));
  const byGate = (await db.prepare(`SELECT COALESCE(gate, 'No gate') AS gate, COUNT(*) AS n FROM gc_scans WHERE at >= ? AND at < ? AND result = 'admitted' GROUP BY 1 ORDER BY n DESC`).bind(from, to).all()).results;
  const byScanner = (await db.prepare(`SELECT MAX(staff_name) AS name, MAX(staff_code) AS code, SUM(result = 'admitted') AS admitted, SUM(result IN ('used','fake','not_lobi','wrong_match','void','unpaid','banned')) AS refused
    FROM gc_scans WHERE at >= ? AND at < ? AND staff_user_id IS NOT NULL GROUP BY staff_user_id ORDER BY admitted DESC`).bind(from, to).all()).results;
  const times = (await db.prepare(`SELECT at FROM gc_scans WHERE at >= ? AND at < ? AND result = 'admitted' ORDER BY at`).bind(from, to).all()).results.map(r => Date.parse(r.at));
  const STEP = 15 * 60e3, b = new Map();
  for (const t of times) { const k = Math.floor(t / STEP) * STEP; b.set(k, (b.get(k) || 0) + 1); }
  const peak = [...b.entries()].sort((x, y) => y[1] - x[1])[0] || null;
  let stands = [];
  if (match) {
    const sold = Object.fromEntries((await db.prepare(`SELECT t.tier, COUNT(*) AS n, SUM(t.status = 'used') AS inn FROM tickets t JOIN orders o ON o.id = t.order_id
      WHERE t.event_id = ? AND o.payment_status = 'paid' AND o.refunded_at IS NULL AND t.status != 'void' GROUP BY t.tier`).bind(match.id).all()).results.map(r => [r.tier, r]));
    const caps = await capacitySettings(db);
    const scanned = Object.fromEntries((await db.prepare(`SELECT tier, COUNT(*) AS n FROM gc_scans WHERE at >= ? AND at < ? AND result = 'admitted' GROUP BY tier`).bind(from, to).all()).results.map(r => [r.tier, r.n]));
    stands = TIERS.map(t => ({ label: TIER_LABELS[t], sold: sold[t]?.n || 0, in: sold[t]?.inn || 0, noShow: Math.max(0, (sold[t]?.n || 0) - (sold[t]?.inn || 0)), allIn: scanned[t] || 0, capacity: caps[t] }));
  }
  const readmits = (await db.prepare(`SELECT at, ticket_id, staff_name, gate, note FROM gc_scans WHERE at >= ? AND at < ? AND result = 'readmitted' ORDER BY at`).bind(from, to).all()).results;
  const doubles = (await db.prepare(`SELECT at, ticket_id, gate, staff_name FROM gc_scans WHERE at >= ? AND at < ? AND how = 'offline' AND result = 'used' ORDER BY at`).bind(from, to).all()).results;
  const offline = (await db.prepare(`SELECT COUNT(*) AS n FROM gc_scans WHERE at >= ? AND at < ? AND how = 'offline' AND result = 'admitted'`).bind(from, to).first())?.n || 0;
  const incidents = (await db.prepare(`SELECT * FROM gc_incidents WHERE at >= ? AND at < ? ORDER BY at`).bind(from, to).all()).results;
  const gates = await gatesStatus(db, match);
  const refusals = Object.entries(REFUSAL).map(([k, label]) => ({ label, n: counts[k] || 0 })).filter(x => x.n);
  return {
    match: match ? { id: match.id, name: `${match.home_team} vs ${match.away_team}`, date: match.event_date, venue: match.venue } : null, day: lagosDay(Date.parse(from) + 3600e3),
    admitted: counts.admitted || 0, readmitted: counts.readmitted || 0, refusedTotal: refusals.filter(r => r.label !== 'Sent to another gate').reduce((s, r) => s + r.n, 0), refusals,
    fake: (counts.fake || 0) + (counts.not_lobi || 0), passes: counts.pass_ok || 0, passesRefused: counts.pass_bad || 0,
    byGate, byScanner, stands, first: times[0] ? new Date(times[0]).toISOString() : null, last: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    peak: peak ? { at: new Date(peak[0]).toISOString(), n: peak[1] } : null, readmits, doubles, offline, incidents, gates,
  };
}
export function reportHtml(r) {
  const th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid #0E2A55;font-size:12px;text-transform:uppercase;color:#0E2A55"';
  const td = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:14px"';
  const table = (head, rows) => rows.length ? `<table style="border-collapse:collapse;width:100%;margin:6px 0 18px">${`<tr>${head.map(h => `<th ${th}>${esc(h)}</th>`).join('')}</tr>`}${rows.map(row => `<tr>${row.map(c => `<td ${td}>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : '<p style="color:#6b7280;margin:4px 0 18px">None.</p>';
  const h = t => `<h2 style="font:700 18px Arial,sans-serif;color:#0E2A55;margin:22px 0 4px">${esc(t)}</h2>`;
  const big = (n, label, colour) => `<td style="padding:10px;text-align:center;border:1px solid #e5e7eb;border-radius:8px"><div style="font:700 30px Arial,sans-serif;color:${colour}">${esc(n)}</div><div style="font-size:12px;color:#6b7280">${esc(label)}</div></td>`;
  const sold = r.stands.reduce((s, x) => s + x.sold, 0), noShow = r.stands.reduce((s, x) => s + x.noShow, 0);
  return `<div style="font-family:Arial,sans-serif;color:#111827;max-width:720px;margin:0 auto">
    <div style="background:#0E2A55;color:#fff;padding:18px 20px;border-bottom:4px solid #F5C11A"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#F5C11A">Lobi Gate Control · Match-day report</div>
    <div style="font:700 24px Arial,sans-serif;margin-top:4px">${esc(r.match ? r.match.name : `Gate report ${r.day}`)}</div>
    <div style="font-size:14px;opacity:.9">${r.match ? esc(new Date(r.match.date).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })) + (r.match.venue ? ` · ${esc(r.match.venue)}` : '') : ''}</div></div>
    <table style="width:100%;border-collapse:separate;border-spacing:6px;margin:12px 0"><tr>${big(r.admitted.toLocaleString('en-GB'), 'fans checked in', '#0B7A2E')}${big(sold ? `${Math.round((r.stands.reduce((s, x) => s + x.in, 0) / sold) * 100)}%` : '–', 'of tickets used', '#0E2A55')}${big(noShow.toLocaleString('en-GB'), 'no-shows', '#B45309')}${big(r.fake, 'fake tickets', '#C11A1F')}</tr></table>
    <p style="font-size:14px;margin:0 0 4px">First check-in ${esc(hmLagos(r.first) || '–')}, last ${esc(hmLagos(r.last) || '–')}.${r.peak ? ` Busiest 15 minutes: <b>${esc(hmLagos(r.peak.at))}</b> with <b>${r.peak.n}</b> fans.` : ''} Gates: ${esc(r.gates.label)}.</p>
    ${h('By stand')}${table(['Stand', 'Tickets', 'Used', 'No-shows', 'Checked in (all)', 'Stand size'], r.stands.map(s => [s.label, s.sold, s.in, s.noShow, s.allIn, s.capacity ? `${s.capacity} (${Math.round((s.allIn / s.capacity) * 100)}% full)` : '–']))}
    ${h('By gate')}${table(['Gate', 'Fans checked in'], r.byGate.map(g => [g.gate, g.n]))}
    ${h('Refused at the gates')}${table(['Reason', 'Times'], r.refusals.map(x => [x.label, x.n]))}
    ${h('Scanners')}${table(['Scanner', 'Checked in', 'Refused'], r.byScanner.map(s => [`${s.name || ''}${s.code ? ` (${s.code})` : ''}`, s.admitted || 0, s.refused || 0]))}
    ${h('Incidents')}${table(['Time', 'Gate', 'What', 'Status'], r.incidents.map(i => [hmLagos(i.at), i.gate || '', `${i.category}: ${i.details || ''}`, i.status === 'open' ? 'Open' : `Closed${i.close_note ? `: ${i.close_note}` : ''}`]))}
    ${h('Re-admitted (supervisors)')}${table(['Time', 'Ticket', 'By', 'Reason'], r.readmits.map(x => [hmLagos(x.at), x.ticket_id, x.staff_name, x.note || '']))}
    ${h('Double entries (offline)')}${table(['Time', 'Ticket', 'Gate', 'By'], r.doubles.map(x => [hmLagos(x.at), x.ticket_id, x.gate || '', x.staff_name || '']))}
    <p style="font-size:14px">${r.offline} fans were checked in offline (no signal). ${r.passes} staff / media passes were scanned${r.passesRefused ? `, ${r.passesRefused} refused` : ''}. Every scan is in the attached CSV.</p>
    <p style="font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:10px">Sent automatically by Lobi Gate Control (lobistarsfc.com). Live figures: Admin › Commerce › Lobi Gate Control.</p></div>`;
}
/** Email the report now (by hand or on the timer). */
export async function sendReport(env, { match = null, by = 'Automatic', force = false } = {}) {
  const db = env.DB;
  const { reportCsv } = await import('./gateExtras.js');
  const r = await buildReport(env, match);
  const to = await reportRecipients(db, env);
  if (!to.length) return { error: 'Nobody to send it to: add the email addresses first.' };
  const key = `report_sent_${r.match?.id || r.day}`;
  if (!force && await getSetting(db, key, null)) return { skipped: 'already sent' };
  const csv = await reportCsv(db, r.day);
  const b64 = btoa(unescape(encodeURIComponent(csv)));
  await sendEmail(env, { to, subject: `Match-day gate report: ${r.match ? r.match.name : r.day} (${r.admitted.toLocaleString('en-GB')} fans)`, html: reportHtml(r),
    attachments: [{ filename: `gate-report-${r.day}.csv`, content: b64 }] });
  await putSetting(db, key, { at: nowIso(), by, to }, by);
  await gcLog(db, { kind: by === 'Automatic' ? 'system' : 'admin', name: by, code: by }, 'Sent the match-day gate report', { kind: 'settings', details: to.join(', ') });
  return { ok: true, to };
}
/** Every minute (timer): send the report once, a set time after the gates close (or 4 hours after kick-off). */
export async function gateReportTick(env) {
  const db = env.DB;
  const match = await todaysHomeMatch(db).catch(() => null);
  if (!match) return { idle: 'no home match today' };
  await ensureMatchdaySchema(db);
  if (await getSetting(db, `report_sent_${match.id}`, null)) return { idle: 'sent' };
  const g = await gatesStatus(db, match), delay = await reportDelay(db);
  const due = (g.closed && Date.now() >= Date.parse(g.closedAt) + delay * 60e3) || Date.now() >= Date.parse(match.event_date) + 4 * 3600e3;
  if (!due) return { idle: 'not yet' };
  const anyScans = await db.prepare(`SELECT 1 FROM gc_scans WHERE at >= ? LIMIT 1`).bind(dayStartIso()).first();
  if (!anyScans) { await putSetting(db, `report_sent_${match.id}`, { at: nowIso(), skipped: 'no scans' }, 'Automatic'); return { idle: 'no scans' }; }
  return sendReport(env, { match });
}
