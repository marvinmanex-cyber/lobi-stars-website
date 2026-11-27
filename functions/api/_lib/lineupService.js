// One line-up, one owner (owner's brief, 27 Nov 2026): the ONLY code that reads or writes line-ups for the Media
// Centre's Matchday Desk and the Statistics Center (Match Setup, live entry, BST).
//
//  - The rows live in sx_lineups (both teams; Lobi Stars by squad slug, opponents by name and number).
//  - A sheet header per match and team (sx_lineup_sheets, UNIQUE match + side): status draft | confirmed | locked,
//    formations, a version number that goes up with every change, who confirmed and when, when it was last
//    published (team news, graphics, match page).
//  - Every change is a revision (sx_lineup_revisions) with the full line-up and the players it touched.
//  - Edits are small changes ("put player X on the bench", "number 9 for Y", "formation 4-4-2") sent with the version
//    the person last saw. Same version: applied. Older: merged automatically when the changes touch other players and
//    the result is still valid; otherwise refused (HTTP 409) with the current line-up and what changed, so nothing is
//    overwritten silently.
//  - The Media Centre and the Statistics Center point at the same match: the fixture (events.id) is the link; a
//    Statistics Center match is created for a fixture the first time its line-up is edited (UNIQUE event_id: never two).
//  - Presence (who is editing, heartbeats every 15 s, gone after 45 s) and an optional 5-minute "pen".
import { ensureStatsCentreSchema, sxLog, newId, sxSettings, setSxSetting } from './statsCentre.js';
import { getMatchRow, createMatch, teamKey, upsertOpponentPlayer } from './statsCentreData.js';

const nowIso = () => new Date().toISOString();
const FORM_RE = /^[1-5](-[1-5]){1,4}$/;
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
export const actorName = a => (a.kind === 'admin' ? `${a.fullName} (Super Admin)` : a.kind === 'media' ? `${a.fullName} (Media Centre)` : `${a.fullName} (Statistics Center)`);
const logActor = a => ({ kind: a.kind === 'media' ? 'media' : a.kind === 'admin' ? 'admin' : 'stats', id: a.id, name: actorName(a) });

let ready = false;
export async function ensureLineupSchema(db) {
  await ensureStatsCentreSchema(db);
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_lineup_sheets (
      id TEXT PRIMARY KEY, match_id TEXT NOT NULL, side TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      formation TEXT, formation_finish TEXT, version INTEGER NOT NULL DEFAULT 0,
      confirmed_by TEXT, confirmed_at TEXT, locked_at TEXT, last_edited_by TEXT, last_edited_at TEXT,
      published_at TEXT, published_version INTEGER, pen_holder TEXT, pen_name TEXT, pen_until TEXT, created_at TEXT NOT NULL,
      UNIQUE (match_id, side))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_lineup_revisions (
      id TEXT PRIMARY KEY, sheet_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, keys_json TEXT,
      changed_by TEXT, change_summary TEXT, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_lineup_rev_sheet ON sx_lineup_revisions (sheet_id, version)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_lineup_presence (sheet_id TEXT NOT NULL, user_key TEXT NOT NULL, name TEXT, page TEXT, editing_since TEXT, last_heartbeat TEXT NOT NULL, PRIMARY KEY (sheet_id, user_key))`),
  ]);
  ready = true;
}

// ── The match behind a fixture (one record for both pages) ──
export async function matchForEvent(db, actor, eventId, { startMonth = 8 } = {}) {
  await ensureLineupSchema(db);
  const had = await db.prepare(`SELECT id FROM sx_matches WHERE event_id = ? AND is_deleted = 0`).bind(String(eventId || '')).first();
  if (had) return had.id;
  const r = await createMatch(db, { id: actor.id, loginId: actor.loginId || actor.kind, fullName: actor.fullName, admin: actor.kind === 'admin' }, { eventId }, { startMonth });
  if (r.error && r.id) return r.id; // created at the same moment by someone else
  if (r.error) throw new Error(r.error);
  return r.id;
}

// ── Reading ──
const rowKey = r => (r.player_slug ? `s:${r.player_slug}` : `o:${String(r.player_name || '').toLowerCase()}#${r.shirt_number ?? ''}`);
async function sheetRow(db, matchId, side, create = true) {
  await ensureLineupSchema(db);
  let s = await db.prepare(`SELECT * FROM sx_lineup_sheets WHERE match_id = ? AND side = ?`).bind(matchId, side).first();
  if (!s && create) {
    const m = await getMatchRow(db, matchId);
    const fStart = side === 'home' ? m?.formation_home : m?.formation_away, fEnd = side === 'home' ? m?.formation_home_finish : m?.formation_away_finish;
    await db.prepare(`INSERT OR IGNORE INTO sx_lineup_sheets (id, match_id, side, formation, formation_finish, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(newId('lus'), matchId, side, fStart || null, fEnd || null, nowIso()).run();
    s = await db.prepare(`SELECT * FROM sx_lineup_sheets WHERE match_id = ? AND side = ?`).bind(matchId, side).first();
  }
  return s;
}
/** Locks the sheet by itself once the match has kicked off (the clock started, or the kick-off time passed). */
async function autoLock(db, s) {
  if (s.status === 'locked') return s;
  const m = await getMatchRow(db, s.match_id);
  if (!m) return s;
  const clock = parse(m.clock_json, null);
  let ko = Date.parse(m.match_date);
  if (/^\d{2}:\d{2}$/.test(m.kickoff_time || '')) { const d = String(m.match_date).slice(0, 10); ko = Date.parse(`${d}T${m.kickoff_time}:00+01:00`); }
  const s2 = await sxSettings(db);
  const byTime = s2.lineup_autolock_time !== '0' && Number.isFinite(ko) && Date.now() >= ko;
  if ((clock && clock.period) || byTime) {
    await db.prepare(`UPDATE sx_lineup_sheets SET status = 'locked', locked_at = ? WHERE id = ? AND status <> 'locked'`).bind(nowIso(), s.id).run();
    return { ...s, status: 'locked', locked_at: nowIso() };
  }
  return s;
}
async function rowsOf(db, matchId, side) {
  return (await db.prepare(`SELECT * FROM sx_lineups WHERE match_id = ? AND side = ? ORDER BY is_starter DESC, sort`).bind(matchId, side).all()).results;
}
const view = r => ({ key: rowKey(r), slug: r.player_slug || null, name: r.player_name, number: r.shirt_number, position: r.position || '', role: r.is_starter ? 'starter' : 'sub' });
/** The sheet, its rows, version and status (and who else is editing). */
export async function getSheet(db, matchId, side, actor = null) {
  let s = await sheetRow(db, matchId, side);
  s = await autoLock(db, s);
  const rows = (await rowsOf(db, matchId, side)).map(view);
  const others = actor ? (await db.prepare(`SELECT name, page FROM sx_lineup_presence WHERE sheet_id = ? AND user_key <> ? AND last_heartbeat > ?`).bind(s.id, userKey(actor), new Date(Date.now() - 45e3).toISOString()).all()).results : [];
  const pen = s.pen_until && Date.parse(s.pen_until) > Date.now() ? { holder: s.pen_holder, name: s.pen_name, until: s.pen_until } : null;
  return { sheetId: s.id, matchId, side, status: s.status, version: s.version, formation: s.formation || '', formationFinish: s.formation_finish || '', rows,
    confirmedBy: s.confirmed_by, confirmedAt: s.confirmed_at, lockedAt: s.locked_at, lastEditedBy: s.last_edited_by, lastEditedAt: s.last_edited_at,
    publishedAt: s.published_at, changedSincePublished: !!s.published_at && s.published_version !== null && s.version > s.published_version, others, pen };
}
export async function sheetVersion(db, matchId, side) {
  await ensureLineupSchema(db);
  const s = await db.prepare(`SELECT version, status, last_edited_by FROM sx_lineup_sheets WHERE match_id = ? AND side = ?`).bind(matchId, side).first();
  return s ? { version: s.version, status: s.status, by: s.last_edited_by } : { version: 0, status: 'draft', by: null };
}
const userKey = a => `${a.kind}:${a.id}`;

// ── Changing ──
/**
 * changes: [{ op: 'set', key?, slug?, name?, number?, position?, role: 'starter' | 'sub' | 'none' } | { op: 'number', key, number } |
 *           { op: 'position', key, position } | { op: 'formation', value } | { op: 'formation_finish', value }]
 * Returns { ok, sheet, merged } or { conflict: true, status: 409, conflicts, changedSince, sheet } or { error }.
 */
export async function applyChanges(db, actor, matchId, side, baseVersion, changes, roster, { reason = '', request = null } = {}) {
  await ensureLineupSchema(db);
  const m = await getMatchRow(db, matchId);
  if (!m) return { error: 'Match not found.' };
  const lobiSide = m.is_lobi_home ? 'home' : 'away';
  for (let attempt = 0; attempt < 3; attempt++) {
    let s = await autoLock(db, await sheetRow(db, matchId, side));
    if (s.pen_until && Date.parse(s.pen_until) > Date.now() && s.pen_holder !== userKey(actor) && actor.kind !== 'admin') return { error: `${s.pen_name} has the pen until ${s.pen_until.slice(11, 16)} UTC: the line-up is read only for everyone else.`, status: 423 };
    if (s.status === 'confirmed') return { error: `The line-up was confirmed by ${s.confirmed_by} at ${String(s.confirmed_at).slice(11, 16)} UTC. Reopen it to continue (your changes stay on screen).`, status: 409, confirmed: true, sheet: await getSheet(db, matchId, side, actor) };
    if (s.status === 'locked') {
      if (!(actor.kind === 'admin' || actor.kind === 'stats') || String(reason || '').trim().length < 3) return { error: 'The match has kicked off: the line-up is locked. Changes during the match are substitutions. A statistician or Super Admin can correct it with a reason.', status: 423, locked: true };
    }
    const cur = await rowsOf(db, matchId, side);
    const state = new Map(cur.map(r => [rowKey(r), { ...r }]));
    let formation = s.formation || '', formationFinish = s.formation_finish || '';
    const base = Number(baseVersion);
    // What changed since the version this person saw.
    let changedSince = [], touchedSince = new Set();
    if (Number.isFinite(base) && base < s.version) {
      const revs = (await db.prepare(`SELECT version, keys_json, changed_by, change_summary FROM sx_lineup_revisions WHERE sheet_id = ? AND version > ? ORDER BY version`).bind(s.id, base).all()).results;
      for (const r of revs) { for (const k of parse(r.keys_json, [])) touchedSince.add(k); changedSince.push({ version: r.version, by: r.changed_by, what: r.change_summary }); }
    }
    const bySlug = new Map((roster || []).map(p => [p.slug, p]));
    const touched = new Set(), conflicts = [], summary = [];
    for (const c of (Array.isArray(changes) ? changes : []).slice(0, 60)) {
      if (c?.op === 'formation' || c?.op === 'formation_finish') {
        const v = String(c.value || '').trim();
        if (v && !FORM_RE.test(v)) return { error: `"${v}" is not a formation (write it like 4-4-2).` };
        const k = c.op;
        if (touchedSince.has(k)) conflicts.push({ key: k, label: c.op === 'formation' ? 'Starting formation' : 'Finishing formation', theirs: c.op === 'formation' ? formation : formationFinish, mine: v });
        if (c.op === 'formation') formation = v; else formationFinish = v;
        touched.add(k); summary.push(`${c.op === 'formation' ? 'formation' : 'finishing formation'} ${v || '—'}`);
        continue;
      }
      // the player
      let key = c?.key, row;
      if (side === lobiSide) {
        const slug = c?.slug || (String(key || '').startsWith('s:') ? key.slice(2) : null);
        const p = bySlug.get(String(slug || ''));
        if (!p) return { error: `${c?.name || 'That player'} is not in the Lobi Stars squad list.` };
        key = `s:${p.slug}`;
        row = state.get(key) || { player_slug: p.slug, player_name: p.name, shirt_number: p.number ?? null, position: p.position || null, is_starter: 0, _new: true };
      } else {
        const name = String(c?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!key) { if (!name) return { error: 'Type the player\'s name.' }; key = `o:${name.toLowerCase()}#${c?.number ?? ''}`; }
        row = state.get(key) || { player_slug: null, player_name: name, shirt_number: c?.number === '' || c?.number === undefined ? null : Number(c.number), position: null, is_starter: 0, _new: true };
      }
      if (touchedSince.has(key)) { const t = state.get(key); conflicts.push({ key, label: row.player_name, theirs: t ? (t.is_starter ? 'starting' : 'substitute') + (t.shirt_number !== null ? ` (No. ${t.shirt_number})` : '') : 'not in the line-up', mine: c.op === 'set' ? c.role : `${c.op} ${c.number ?? c.position ?? ''}` }); }
      touched.add(key);
      if (c.op === 'set') {
        if (c.role === 'none') { state.delete(key); summary.push(`${row.player_name} out`); continue; }
        if (c.role !== 'starter' && c.role !== 'sub') return { error: 'Choose starting, substitute or not in the line-up.' };
        row.is_starter = c.role === 'starter' ? 1 : 0;
        if (c.number !== undefined && c.number !== '') row.shirt_number = Number(c.number);
        if (c.position !== undefined) row.position = String(c.position || '').slice(0, 8) || null;
        state.set(key, row); summary.push(`${row.player_name} ${c.role === 'starter' ? 'starting' : 'on the bench'}`);
      } else if (c.op === 'number') {
        if (!state.has(key)) return { error: `${row.player_name} is not in the line-up.` };
        const n = c.number === '' || c.number === null || c.number === undefined ? null : Math.round(Number(c.number));
        if (n !== null && !(n >= 0 && n <= 99)) return { error: 'Shirt numbers are 0 to 99.' };
        state.get(key).shirt_number = n; summary.push(`${row.player_name} No. ${n ?? '—'}`);
      } else if (c.op === 'position') {
        if (!state.has(key)) return { error: `${row.player_name} is not in the line-up.` };
        state.get(key).position = String(c.position || '').slice(0, 8) || null; summary.push(`${row.player_name} ${c.position || ''}`);
      } else return { error: 'Unknown change.' };
    }
    // Validation of the result (always on the server).
    const rows = [...state.values()];
    const problems = [];
    const starters = rows.filter(r => r.is_starter).length;
    if (starters > 11) problems.push(`${starters} starters: only 11 can start.`);
    const nums = new Map();
    for (const r of rows) if (r.shirt_number !== null && r.shirt_number !== undefined) { if (nums.has(r.shirt_number)) problems.push(`Shirt number ${r.shirt_number} is used by ${nums.get(r.shirt_number)} and ${r.player_name}.`); else nums.set(r.shirt_number, r.player_name); }
    if (side !== lobiSide) { const names = new Set(); for (const r of rows) { const k = String(r.player_name).toLowerCase(); if (names.has(k)) problems.push(`${r.player_name} appears twice.`); names.add(k); } }
    if (conflicts.length || (problems.length && changedSince.length)) {
      return { conflict: true, status: 409, conflicts, problems, changedSince, sheet: await getSheet(db, matchId, side, actor), message: conflicts.length ? `${changedSince.map(c => c.by).filter((v, i, a) => a.indexOf(v) === i).join(', ')} changed the same player${conflicts.length > 1 ? 's' : ''} while you were editing.` : `Your change no longer fits after other changes: ${problems.join(' ')}` };
    }
    if (problems.length) return { error: problems.join(' ') };
    // Claim the next version (only one writer gets it); then write the rows and the revision.
    const claim = await db.prepare(`UPDATE sx_lineup_sheets SET version = version + 1, formation = ?, formation_finish = ?, last_edited_by = ?, last_edited_at = ? WHERE id = ? AND version = ?`)
      .bind(formation || null, formationFinish || null, actorName(actor), nowIso(), s.id, s.version).run();
    if (!claim.meta?.changes) continue; // someone else saved at the same moment: merge again
    const version = s.version + 1;
    const oppTeam = side === 'home' ? m.home_team : m.away_team;
    const ordered = rows.sort((a, b) => (b.is_starter - a.is_starter) || ((a.sort ?? 99) - (b.sort ?? 99)));
    for (const r of ordered) if (side !== lobiSide && !r.opponent_player_id) r.opponent_player_id = await upsertOpponentPlayer(db, { fullName: actor.fullName, loginId: actor.loginId || actor.kind, admin: actor.kind === 'admin' }, oppTeam, { name: r.player_name, number: r.shirt_number, position: r.position }, matchId);
    const snapshot = { formation, formationFinish, rows: ordered.map(r => view(r)) };
    await db.batch([
      db.prepare(`DELETE FROM sx_lineups WHERE match_id = ? AND side = ?`).bind(matchId, side),
      ...ordered.map((r, i) => db.prepare(`INSERT INTO sx_lineups (id, match_id, side, player_slug, player_name, shirt_number, position, is_starter, minutes_override, coach_rating, is_motm, sort, opponent_player_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id && !r._new ? r.id : newId('sxl'), matchId, side, r.player_slug || null, r.player_name, r.shirt_number ?? null, r.position || null, r.is_starter ? 1 : 0, r.minutes_override ?? null, r.coach_rating ?? null, r.is_motm ? 1 : 0, i, r.opponent_player_id || null)),
      db.prepare(`INSERT INTO sx_lineup_revisions (id, sheet_id, version, snapshot_json, keys_json, changed_by, change_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(newId('lur'), s.id, version, JSON.stringify(snapshot), JSON.stringify([...touched]), actorName(actor), (reason ? `Correction (${String(reason).slice(0, 200)}): ` : '') + summary.join(', ').slice(0, 500), nowIso()),
      // the Statistics Center keeps formations on the match too (one value, the sheet is its owner)
      db.prepare(`UPDATE sx_matches SET ${side === 'home' ? 'formation_home = ?, formation_home_finish = ?' : 'formation_away = ?, formation_away_finish = ?'}, updated_at = ? WHERE id = ?`).bind(formation || null, formationFinish || null, nowIso(), matchId),
    ]);
    await sxLog(db, logActor(actor), s.status === 'locked' ? 'lineup_correction' : 'lineup_change', { itemType: 'lineup', itemId: s.id, itemTitle: `${m.home_team} v ${m.away_team} (${side})`, details: (reason ? `Reason: ${reason}. ` : '') + summary.join(', '), request });
    return { ok: true, merged: changedSince.length > 0, sheet: await getSheet(db, matchId, side, actor) };
  }
  return { error: 'Several people are saving at the same moment. Please try again.', status: 409 };
}

// ── Lifecycle ──
export async function confirmSheet(db, actor, matchId, side, { request = null } = {}) {
  const s = await autoLock(db, await sheetRow(db, matchId, side));
  if (s.status === 'locked') return { error: 'The match has kicked off: the line-up is locked.' };
  const starters = (await rowsOf(db, matchId, side)).filter(r => r.is_starter).length;
  const m = await getMatchRow(db, matchId);
  if (side === (m.is_lobi_home ? 'home' : 'away') && starters !== 11) return { error: `Pick 11 starters before confirming (now ${starters}).` };
  await db.prepare(`UPDATE sx_lineup_sheets SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?, version = version + 1 WHERE id = ?`).bind(actorName(actor), nowIso(), s.id).run();
  await snapshotRevision(db, s.id, actor, 'Confirmed');
  await sxLog(db, logActor(actor), 'lineup_confirm', { itemType: 'lineup', itemId: s.id, request });
  return { ok: true, sheet: await getSheet(db, matchId, side, actor) };
}
export async function reopenSheet(db, actor, matchId, side, { request = null } = {}) {
  const s = await autoLock(db, await sheetRow(db, matchId, side));
  if (s.status === 'locked') return { error: 'The match has kicked off: the line-up is locked.' };
  if (s.status !== 'confirmed') return { ok: true, sheet: await getSheet(db, matchId, side, actor) };
  await db.prepare(`UPDATE sx_lineup_sheets SET status = 'draft', version = version + 1 WHERE id = ?`).bind(s.id).run();
  await snapshotRevision(db, s.id, actor, 'Reopened');
  await sxLog(db, logActor(actor), 'lineup_reopen', { itemType: 'lineup', itemId: s.id, details: s.published_at ? 'Reopened after publication: team news or graphics may be out of date' : '', request });
  return { ok: true, warning: s.published_at ? 'Team news or graphics were already published from this line-up: check them after your changes.' : null, sheet: await getSheet(db, matchId, side, actor) };
}
export async function lockSheets(db, matchId) {
  await ensureLineupSchema(db);
  await db.prepare(`UPDATE sx_lineup_sheets SET status = 'locked', locked_at = ? WHERE match_id = ? AND status <> 'locked'`).bind(nowIso(), matchId).run();
}
async function snapshotRevision(db, sheetId, actor, what) {
  const s = await db.prepare(`SELECT * FROM sx_lineup_sheets WHERE id = ?`).bind(sheetId).first();
  const rows = (await rowsOf(db, s.match_id, s.side)).map(view);
  await db.prepare(`INSERT INTO sx_lineup_revisions (id, sheet_id, version, snapshot_json, keys_json, changed_by, change_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId('lur'), sheetId, s.version, JSON.stringify({ formation: s.formation || '', formationFinish: s.formation_finish || '', rows }), '[]', actorName(actor), what, nowIso()).run();
}
export async function revisions(db, matchId, side) {
  const s = await sheetRow(db, matchId, side, false);
  if (!s) return [];
  return (await db.prepare(`SELECT id, version, changed_by, change_summary, created_at, snapshot_json FROM sx_lineup_revisions WHERE sheet_id = ? ORDER BY version DESC LIMIT 100`).bind(s.id).all()).results
    .map(r => ({ id: r.id, version: r.version, by: r.changed_by, what: r.change_summary, at: r.created_at, snapshot: parse(r.snapshot_json, null) }));
}
/** Puts an older version back as a NEW version (history is never deleted). */
export async function restoreRevision(db, actor, matchId, side, revisionId, roster, { reason = '', request = null } = {}) {
  const s = await sheetRow(db, matchId, side, false);
  if (!s) return { error: 'No line-up yet.' };
  const r = await db.prepare(`SELECT * FROM sx_lineup_revisions WHERE id = ? AND sheet_id = ?`).bind(String(revisionId), s.id).first();
  if (!r) return { error: 'Version not found.' };
  const snap = parse(r.snapshot_json, null);
  const cur = (await rowsOf(db, matchId, side)).map(view);
  const keep = new Set(snap.rows.map(x => x.key));
  const changes = [
    ...cur.filter(x => !keep.has(x.key)).map(x => ({ op: 'set', key: x.key, slug: x.slug, name: x.name, number: x.number, role: 'none' })),
    ...snap.rows.map(x => ({ op: 'set', key: x.key, slug: x.slug, name: x.name, number: x.number, position: x.position, role: x.role })),
    { op: 'formation', value: snap.formation || '' }, { op: 'formation_finish', value: snap.formationFinish || '' },
  ];
  const out = await applyChanges(db, actor, matchId, side, s.version, changes, roster, { reason: reason || `restored version ${r.version}`, request });
  if (out.ok) await sxLog(db, logActor(actor), 'lineup_restore', { itemType: 'lineup', itemId: s.id, details: `Version ${r.version} put back`, request });
  return out;
}

// ── Presence and the pen ──
export async function heartbeat(db, actor, matchId, side, page) {
  const s = await sheetRow(db, matchId, side);
  const at = nowIso();
  await db.prepare(`INSERT INTO sx_lineup_presence (sheet_id, user_key, name, page, editing_since, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (sheet_id, user_key) DO UPDATE SET last_heartbeat = excluded.last_heartbeat, page = excluded.page, name = excluded.name`).bind(s.id, userKey(actor), actorName(actor), String(page || '').slice(0, 20), at, at).run();
  // presence older than 7 days is never needed
  await db.prepare(`DELETE FROM sx_lineup_presence WHERE last_heartbeat < ?`).bind(new Date(Date.now() - 7 * 864e5).toISOString()).run();
  return sheetVersion(db, matchId, side).then(async v => ({ ...v, others: (await db.prepare(`SELECT name, page FROM sx_lineup_presence WHERE sheet_id = ? AND user_key <> ? AND last_heartbeat > ?`).bind(s.id, userKey(actor), new Date(Date.now() - 45e3).toISOString()).all()).results }));
}
export async function takePen(db, actor, matchId, side, { release = false, override = false } = {}) {
  const s = await sheetRow(db, matchId, side);
  if (release) { await db.prepare(`UPDATE sx_lineup_sheets SET pen_holder = NULL, pen_name = NULL, pen_until = NULL WHERE id = ? AND (pen_holder = ? OR ?)`).bind(s.id, userKey(actor), actor.kind === 'admin' ? 1 : 0).run(); return { ok: true }; }
  if (s.pen_until && Date.parse(s.pen_until) > Date.now() && s.pen_holder !== userKey(actor) && !(override && actor.kind === 'admin')) return { error: `${s.pen_name} has the pen until ${s.pen_until.slice(11, 16)} UTC.` };
  const until = new Date(Date.now() + 5 * 60e3).toISOString();
  await db.prepare(`UPDATE sx_lineup_sheets SET pen_holder = ?, pen_name = ?, pen_until = ? WHERE id = ?`).bind(userKey(actor), actorName(actor), until, s.id).run();
  return { ok: true, until };
}

// ── Published content (team news, graphics, the match page) ──
export async function markPublished(db, matchId, side) {
  await ensureLineupSchema(db);
  await db.prepare(`UPDATE sx_lineup_sheets SET published_at = ?, published_version = version WHERE match_id = ? AND side = ?`).bind(nowIso(), matchId, side).run();
}

// ── One-time copy of the Media Centre's own line-ups into the shared line-up (safe to run again) ──
export async function migrateMediaLineups(db, roster, { force = false } = {}) {
  await ensureLineupSchema(db);
  const st = await sxSettings(db);
  if (st.lineup_migration && !force) return parse(st.lineup_migration, { done: true });
  const report = { at: nowIso(), items: 0, migrated: 0, skippedHasLineup: 0, unmatched: [] };
  let items = [];
  try { items = (await db.prepare(`SELECT id, status, data_json, live_json, ref FROM mc_items WHERE kind = 'lineup' AND status NOT IN ('rejected') ORDER BY updated_at DESC`).all()).results; } catch { items = []; }
  const seen = new Set();
  const bySlug = new Map((roster || []).map(p => [p.slug, p])), byName = new Map((roster || []).map(p => [String(p.name).toLowerCase(), p]));
  const actor = { kind: 'admin', id: 'migration', fullName: 'Line-up migration', loginId: 'system' };
  for (const it of items) {
    report.items++;
    const v = parse(it.status === 'published' && it.live_json ? it.live_json : it.data_json, {});
    const eventId = v.eventId || it.ref;
    if (!eventId || seen.has(eventId)) continue;
    seen.add(eventId);
    if (!(await db.prepare(`SELECT id FROM events WHERE id = ?`).bind(eventId).first())) { report.unmatched.push({ item: it.id, reason: 'fixture no longer exists' }); continue; }
    const matchId = await matchForEvent(db, actor, eventId);
    const m = await getMatchRow(db, matchId);
    const lobiSide = m.is_lobi_home ? 'home' : 'away';
    if ((await rowsOf(db, matchId, lobiSide)).length) { report.skippedHasLineup++; continue; }
    const changes = [];
    for (const [list, role] of [[v.starting, 'starter'], [v.subs, 'sub']]) for (const p of Array.isArray(list) ? list : []) {
      const sq = (p.slug && bySlug.get(p.slug)) || byName.get(String(p.name || '').toLowerCase());
      if (!sq) { report.unmatched.push({ item: it.id, reason: `${p.name || p.slug} is not in the squad list` }); continue; }
      changes.push({ op: 'set', slug: sq.slug, number: p.number ?? sq.number, role });
    }
    if (v.formation && FORM_RE.test(v.formation)) changes.push({ op: 'formation', value: v.formation });
    const r = await applyChanges(db, actor, matchId, lobiSide, 0, changes, roster, { reason: 'copied from the Media Centre' });
    if (!r.ok) { report.unmatched.push({ item: it.id, reason: r.error || 'could not be copied' }); continue; }
    if (it.status === 'published') {
      const s = await sheetRow(db, matchId, lobiSide);
      await db.prepare(`UPDATE sx_lineup_sheets SET status = 'confirmed', confirmed_by = 'Line-up migration', confirmed_at = ?, published_at = ?, published_version = version WHERE id = ?`).bind(nowIso(), nowIso(), s.id).run();
    }
    report.migrated++;
  }
  await setSxSetting(db, 'lineup_migration', JSON.stringify(report), 'system');
  return report;
}
