import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { revokeSessions } from '../_lib/adminSecurity.js';
import { ensureHelpersSchema, createHelper, resetHelperLogin, helperStatus, endOfMatchDay, HELPER_ROLES } from '../_lib/helpers.js';
import { ensureTable } from '../_lib/matchCentre.js';
import { qrPngBuffer } from '../_lib/qrcode.js';

const b64 = bytes => { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const withQr = async login => ({ ...login, qr: `data:image/png;base64,${b64(await qrPngBuffer(login.link, { size: 240, margin: 4 }))}` });

const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const PHONE_RE = /^\+?[0-9 ]{7,16}$/;

// Commerce › Matchday helpers (helpers.create: the Matchday Operations Manager and Super Admins).
// GET  /api/admin/helpers[?event=id]  -- upcoming and recent matches, and the helpers for them
// POST /api/admin/helpers
//   { action: 'create', name, phone, kind: gate|kitchen, eventId, endsAt? }   returns the username, PIN and link (shown once)
//   { action: 'disable', id }        switch off now (signed out at once)
//   { action: 'extend', id, endsAt } a later end time (at most 06:00 the next morning)
//   { action: 'reset', id }          a new PIN and login link
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureHelpersSchema(db); await ensureTable(db);
  // Today's and upcoming matches (a match day isn't over until 23:59).
  const since = new Date(Date.now() - 12 * 3600e3).toISOString();
  const { results: matches } = await db.prepare(`SELECT id, home_team, away_team, event_date, venue FROM events WHERE event_date >= ? ORDER BY event_date ASC LIMIT 100`).bind(since).all();
  // ?event=id: make sure that match is listed (a link straight to one match).
  const want = new URL(request.url).searchParams.get('event');
  if (want && !matches.some(m => m.id === want)) { const one = await db.prepare(`SELECT id, home_team, away_team, event_date, venue FROM events WHERE id = ?`).bind(want).first(); if (one) matches.unshift(one); }
  const { results: helpers } = await db.prepare(`SELECT h.id, h.name, h.phone, h.kind, h.event_id, h.username, h.expires_at, h.created_by, h.created_at, h.disabled_at, h.disabled_by, h.last_login_at,
      (SELECT COUNT(*) FROM tickets t WHERE t.scanned_by = h.name || ' (Gate Staff)') AS scans
    FROM matchday_helpers h WHERE h.expires_at >= ? ORDER BY h.created_at DESC LIMIT 300`).bind(Date.now() - 7 * 86400e3).all();
  return json({
    matches: matches.map(m => ({ ...m, endsAt: new Date(endOfMatchDay(m.event_date)).toISOString() })),
    helpers: helpers.map(h => ({ ...h, status: helperStatus(h), expiresAt: new Date(h.expires_at).toISOString(), roleLabel: HELPER_ROLES[h.kind]?.label })),
  });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureHelpersSchema(db); await ensureTable(db);
  const origin = new URL(request.url).origin;
  const b = await request.json().catch(() => ({}));

  if (b.action === 'create') {
    const name = String(b.name || '').trim().slice(0, 60);
    const phone = String(b.phone || '').trim();
    if (name.length < 2) return json({ error: "Please type the helper's name." }, 400);
    if (phone && !PHONE_RE.test(phone)) return json({ error: 'The phone number looks wrong (digits only, e.g. 0803 123 4567).' }, 400);
    if (!HELPER_ROLES[b.kind]) return json({ error: 'Choose Gate or Kitchen.' }, 400);
    const event = await db.prepare(`SELECT * FROM events WHERE id = ?`).bind(String(b.eventId || '')).first();
    if (!event) return json({ error: 'Choose the match.' }, 400);
    const dayEnd = endOfMatchDay(event.event_date);
    if (dayEnd < Date.now()) return json({ error: 'That match day is over.' }, 400);
    let endsAt = null;
    if (b.endsAt) {
      endsAt = Date.parse(b.endsAt);
      if (!endsAt || endsAt <= Date.now() || endsAt > dayEnd + 6.1 * 3600e3) return json({ error: 'The end time must be later today and no later than 06:00 the next morning.' }, 400);
    }
    return json({ ok: true, name, phone, kind: b.kind, ...(await withQr(await createHelper(env, origin, { name, phone, kind: b.kind, event, endsAt }, admin))) });
  }

  const h = await db.prepare(`SELECT * FROM matchday_helpers WHERE id = ?`).bind(String(b.id || '')).first();
  if (!h) return json({ error: 'Helper not found.' }, 404);
  if (b.action === 'disable') {
    await db.prepare(`UPDATE matchday_helpers SET disabled_at = datetime('now'), disabled_by = ?, link_hash = NULL WHERE id = ?`).bind(admin.name, h.id).run();
    const n = await revokeSessions(db, `helper:${h.id}`, `switched off by ${admin.name}`);
    await logAdminAction(db, admin, 'helper_disabled', `${h.name} (${h.username}); signed out of ${n} device(s)`);
    return json({ ok: true });
  }
  if (b.action === 'extend') {
    const event = await db.prepare(`SELECT event_date FROM events WHERE id = ?`).bind(h.event_id).first();
    const endsAt = Date.parse(b.endsAt);
    const max = endOfMatchDay(event?.event_date || new Date(h.expires_at).toISOString()) + 6.1 * 3600e3;
    if (!endsAt || endsAt <= Date.now() || endsAt > max) return json({ error: 'Choose a later time today, no later than 06:00 the next morning.' }, 400);
    await db.prepare(`UPDATE matchday_helpers SET expires_at = ?, disabled_at = NULL, disabled_by = NULL WHERE id = ?`).bind(endsAt, h.id).run();
    await db.prepare(`UPDATE admin_sessions SET expires_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(endsAt, `helper:${h.id}`).run();
    await logAdminAction(db, admin, 'helper_extended', `${h.name} (${h.username}) until ${new Date(endsAt).toISOString()}`);
    return json({ ok: true });
  }
  if (b.action === 'reset') {
    if (helperStatus(h) !== 'active') return json({ error: 'This helper account is not active.' }, 400);
    return json({ ok: true, name: h.name, phone: h.phone, kind: h.kind, expiresAt: new Date(h.expires_at).toISOString(), ...(await withQr(await resetHelperLogin(env, origin, h, admin))) });
  }
  return json({ error: 'Unknown action' }, 400);
}
