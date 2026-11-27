// Statistics Center › Phase 2 (owner's brief, 27 Nov 2026): pitch positions, an automatic xG model, video clips,
// set pieces, player ratings and comparison, season analytics, scouting notes, training themes and monthly reports.
//
// Every fact still has one owner:
//  - where an event happened (pitch_x, pitch_y; 0–100, in the ACTING team's attacking direction: x = 100 is the goal
//    they attack) and its xG (xg_value, xg_source auto|manual) belong to the event (sx_events); the zone is worked out;
//  - set-piece routine and outcome belong to the corner / free kick / throw-in / penalty event (the taker is the
//    event's player, the first contact its related player);
//  - the video link and offsets belong to the match; clip times are worked out from the minute;
//  - coach ratings (and a rating note) belong to the line-up row;
//  - xA is never typed: the passer (related player) of a shot or goal is credited with that shot's xG.
// All staff only: nothing here is shown on the public website.
import { ensureStatsCentreSchema, sxSettings, setSxSetting, sxLog, statsActor, newId, oneLine, clean } from './statsCentre.js';

const nowIso = () => new Date().toISOString();
const byName = u => (u.admin ? `${u.fullName} (Super Admin)` : `${u.fullName} (${u.loginId})`);

let ready = false;
export async function ensurePhase2Schema(db) {
  await ensureStatsCentreSchema(db);
  if (ready) return;
  const add = async (table, cols) => {
    const have = new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(r => r.name));
    for (const [c, t] of cols) if (!have.has(c)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${c} ${t}`).run();
  };
  await add('sx_events', [['pitch_x', 'REAL'], ['pitch_y', 'REAL'], ['xg_value', 'REAL'], ['xg_source', 'TEXT'], ['routine_type', 'TEXT'], ['set_piece_outcome', 'TEXT']]);
  await add('sx_matches', [['video_url', 'TEXT'], ['video_offset_seconds', 'INTEGER'], ['video_second_half_offset_seconds', 'INTEGER'], ['attack_1h', 'TEXT']]);
  await add('sx_lineups', [['rating_note', 'TEXT']]);
  await add('sx_share_links', [['include_video', 'INTEGER NOT NULL DEFAULT 0']]);
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_events_type ON sx_events (match_id, side, event_type, period)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_scouting_notes (id TEXT PRIMARY KEY, team_key TEXT NOT NULL, team_name TEXT NOT NULL, season TEXT, note TEXT NOT NULL,
      created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_scout_team ON sx_scouting_notes (team_key, is_deleted)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_training_themes (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT, is_deleted INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_training_tags (id TEXT PRIMARY KEY, theme_id TEXT NOT NULL, match_id TEXT, event_id TEXT, note TEXT,
      created_by TEXT, created_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_tags_theme ON sx_training_tags (theme_id, is_deleted)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_reports (id TEXT PRIMARY KEY, type TEXT NOT NULL, period TEXT NOT NULL, title TEXT, html TEXT NOT NULL,
      generated_by TEXT, generated_at TEXT NOT NULL, emailed_at TEXT, UNIQUE (type, period))`),
  ]);
  ready = true;
}

// ── Pitch, zones and the xG model ──
// The pitch is 105 m × 68 m; x, y are 0–100 in the acting team's attacking direction (x = 100: the goal they attack).
export const PITCH = { length: 105, width: 68, goal: 7.32 };
export const XG_DEFAULTS = { intercept: 0.686, angle: 0.49, distance: -0.1553, head: -0.8, other: -0.5, freeKick: -0.4, counter: 0.3, penalty: 0.76 };
/** Distance to the goal centre (m) and the angle the goal mouth makes (radians) from a point. */
export function shotGeometry(x, y) {
  const dx = Math.max(0.1, (100 - x) * PITCH.length / 100), dy = Math.abs(y - 50) * PITCH.width / 100, half = PITCH.goal / 2;
  let a = Math.atan2(PITCH.goal * dx, dx * dx + dy * dy - half * half);
  if (a < 0) a += Math.PI;
  return { distance: Math.sqrt(dx * dx + dy * dy), angle: a };
}
/**
 * A simple, transparent xG model (a logistic formula, not a black box):
 *   xG = 1 / (1 + e^-(intercept + angle·θ + distance·d + adjustments))
 * θ = the angle of the goal mouth from the shot (radians), d = the distance to the goal centre (metres);
 * adjustments: header, other body part, direct free kick, counter-attack. A penalty is a fixed value (0.76 by default).
 * With the defaults: 5.5 m central ≈ 0.60, penalty spot (open play, foot) ≈ 0.33, 25 m central ≈ 0.05.
 */
export function xgFor(e, params = XG_DEFAULTS) {
  const p = { ...XG_DEFAULTS, ...params };
  if (e.detail === 'penalty' || e.type === 'penalty') return Math.round(p.penalty * 1000) / 1000;
  if (e.pitch_x === null || e.pitch_x === undefined || e.pitch_y === null || e.pitch_y === undefined) return null;
  const { distance, angle } = shotGeometry(Number(e.pitch_x), Number(e.pitch_y));
  let z = p.intercept + p.angle * angle + p.distance * distance;
  if (e.body_part === 'head') z += p.head; else if (e.body_part === 'other') z += p.other;
  if (e.detail === 'free_kick') z += p.freeKick;
  if (e.detail === 'counter') z += p.counter;
  return Math.round((1 / (1 + Math.exp(-z))) * 1000) / 1000;
}
/** "A-C" style zone: third (D defensive, M middle, A attacking) and channel (L, C, R), from x, y. */
export function zoneOf(x, y) {
  if (x === null || x === undefined || y === null || y === undefined) return null;
  return `${x < 33.34 ? 'D' : x < 66.67 ? 'M' : 'A'}-${y < 33.34 ? 'L' : y < 66.67 ? 'C' : 'R'}`;
}
export async function xgParams(db) {
  const s = await sxSettings(db);
  try { return { ...XG_DEFAULTS, ...JSON.parse(s.xg_params || '{}') }; } catch { return { ...XG_DEFAULTS }; }
}
export async function saveXgParams(db, user, b, { request = null } = {}) {
  const p = {};
  for (const k of Object.keys(XG_DEFAULTS)) {
    if (b[k] === undefined || b[k] === '') continue;
    const v = Number(b[k]);
    if (!Number.isFinite(v) || Math.abs(v) > 10) return { error: `Check the value for ${k}.` };
    if (k === 'penalty' && !(v > 0 && v < 1)) return { error: 'The penalty value must be between 0 and 1.' };
    p[k] = v;
  }
  await setSxSetting(db, 'xg_params', JSON.stringify(p), user.fullName);
  await sxLog(db, statsActor(user), 'xg_params', { after: p, request });
  return { ok: true, params: { ...XG_DEFAULTS, ...p } };
}
const SHOTS = new Set(['shot', 'goal']);
/** Works out xG for every shot and goal of a match (or a season) that has a position (or is a penalty) and was not typed by hand. Safe to run again. */
export async function recalcXg(db, user, { matchId = '', season = '' } = {}, { request = null } = {}) {
  await ensurePhase2Schema(db);
  const params = await xgParams(db);
  const where = ['e.is_deleted = 0', "e.event_type IN ('shot', 'goal')", "IFNULL(e.xg_source, 'auto') <> 'manual'"], args = [];
  if (matchId) { where.push('e.match_id = ?'); args.push(matchId); }
  if (season) { where.push('m.season = ?'); args.push(season); }
  const { results } = await db.prepare(`SELECT e.* FROM sx_events e JOIN sx_matches m ON m.id = e.match_id WHERE ${where.join(' AND ')}`).bind(...args).all();
  const stmts = [];
  let changed = 0;
  for (const e of results) {
    if (e.event_type === 'goal' && e.detail_type === 'own_goal') continue;
    const v = xgFor({ ...e, type: e.event_type, detail: e.detail_type }, params);
    if (v !== e.xg_value) { stmts.push(db.prepare(`UPDATE sx_events SET xg_value = ?, xg_source = ? WHERE id = ?`).bind(v, v === null ? null : 'auto', e.id)); changed++; }
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  if (user) await sxLog(db, statsActor(user), 'xg_recalc', { details: `Recalculated xG (${matchId ? 'match' : `season ${season}`}): ${changed} shots changed of ${results.length}`, request });
  return { ok: true, shots: results.length, changed };
}

// ── Video clips ──
/** The second of the video where an event is: kick-off offset + time into the half (second half: its own offset when set). */
export function clipSecond(match, e, lead = 10) {
  const first = Number(match.video_offset_seconds ?? match.videoOffset);
  if (!Number.isFinite(first)) return null;
  const second = Number(match.video_second_half_offset_seconds ?? match.videoOffset2);
  const into = (minute, start) => (Math.max(minute - start - 1, 0) + (e.stoppage || 0)) * 60;
  let t;
  if (e.period === '1H') t = first + into(e.minute, 0);
  else if (e.period === '2H') t = Number.isFinite(second) ? second + into(e.minute, 45) : first + 47 * 60 + 15 * 60 + into(e.minute, 45); // no 2nd-half offset: 45' + ~2' added + 15' break
  else return null;
  return Math.max(0, Math.round(t - lead));
}
/** A link that opens the video at the moment (YouTube and Vimeo time parameters, or a media fragment for a file). */
export function clipUrl(videoUrl, start, length = 25) {
  if (!videoUrl || start === null) return null;
  let u;
  try { u = new URL(videoUrl); } catch { return null; }
  if (/youtu\.be$|youtube\.com$/.test(u.hostname.replace(/^www\.|^m\./, ''))) {
    const id = u.hostname.endsWith('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v') || u.pathname.split('/').pop();
    return `https://www.youtube.com/embed/${encodeURIComponent(id)}?start=${start}&end=${start + length}&autoplay=1`;
  }
  if (/vimeo\.com$/.test(u.hostname.replace(/^www\./, ''))) { u.hash = `t=${Math.floor(start / 60)}m${start % 60}s`; return u.toString(); }
  u.hash = `t=${start},${start + length}`;
  return u.toString();
}
export function keyMoments(full) {
  const m = full.match;
  const keep = e => e.type === 'goal' || e.type === 'red_card' || e.type === 'yellow_card' || e.type === 'penalty' || (e.type === 'shot' && e.outcome === 'on_target');
  return full.events.filter(keep).map(e => {
    const start = clipSecond({ video_offset_seconds: m.videoOffset, video_second_half_offset_seconds: m.videoOffset2 }, e);
    return { id: e.id, minute: e.minute, stoppage: e.stoppage, period: e.period, type: e.type, side: e.side, name: e.name, xg: e.xg ?? null, clip: clipUrl(m.videoUrl, start) };
  });
}

// ── Set pieces ──
export const ROUTINES = ['short', 'near_post', 'far_post', 'driven', 'inswing', 'outswing', 'direct_shot', 'other'];
export const SP_OUTCOMES = ['shot', 'goal', 'cleared', 'won_back', 'foul', 'no_threat'];
export const SET_PIECES = new Set(['corner', 'free_kick', 'throw_in', 'penalty']);
/** Counts and success rate (a shot or a goal) by routine, taker, side of the pitch and opponent; goals from set pieces. */
export function setPieceReport(snapshots) {
  const blank = () => ({ n: 0, success: 0 });
  const by = { routine: {}, taker: {}, side: {}, opponent: {}, faced: {} };
  let goalsFor = 0, goalsAgainst = 0, total = 0;
  for (const s of snapshots) {
    const lobi = s.match.lobiHome ? 'home' : 'away', opp = s.match.lobiHome ? s.match.away : s.match.home;
    for (const e of s.events) {
      if (e.type === 'goal' && ['corner', 'free_kick', 'penalty', 'set_piece'].includes(e.detail)) { if (e.side === lobi) goalsFor++; else goalsAgainst++; }
      if (!SET_PIECES.has(e.type)) continue;
      const ok = e.setPieceOutcome === 'shot' || e.setPieceOutcome === 'goal';
      const bump = (k, key) => { const r = (by[k][key] ||= blank()); r.n++; if (ok) r.success++; };
      if (e.side !== lobi) { bump('faced', e.routine || 'not recorded'); continue; }
      total++;
      bump('routine', e.routine || 'not recorded');
      bump('taker', e.name || 'not recorded');
      bump('side', e.y === null || e.y === undefined ? 'not recorded' : e.y < 50 ? 'left' : 'right');
      bump('opponent', opp);
    }
  }
  const list = o => Object.entries(o).map(([k, v]) => ({ key: k, ...v, rate: v.n ? Math.round((v.success / v.n) * 100) : 0 })).sort((a, b) => b.n - a.n);
  return { total, goalsFor, goalsAgainst, routine: list(by.routine), taker: list(by.taker), side: list(by.side), opponent: list(by.opponent), faced: list(by.faced) };
}

// ── Ratings ──
export async function saveRatings(db, user, matchId, rows, { request = null } = {}) {
  await ensurePhase2Schema(db);
  const m = await db.prepare(`SELECT id, status, home_team, away_team FROM sx_matches WHERE id = ? AND is_deleted = 0`).bind(String(matchId || '')).first();
  if (!m) return { error: 'Match not found.' };
  const stmts = [];
  for (const r of (Array.isArray(rows) ? rows : []).slice(0, 40)) {
    const rating = r.rating === '' || r.rating === null || r.rating === undefined ? null : Math.max(1, Math.min(10, Math.round(Number(r.rating) * 2) / 2));
    if (rating !== null && !Number.isFinite(rating)) return { error: 'Ratings are from 1 to 10.' };
    stmts.push(db.prepare(`UPDATE sx_lineups SET coach_rating = ?, rating_note = ? WHERE id = ? AND match_id = ?`).bind(rating, oneLine(r.note, 300) || null, String(r.id || ''), m.id));
  }
  if (stmts.length) await db.batch(stmts);
  await sxLog(db, statsActor(user), 'ratings', { itemType: 'match', itemId: m.id, itemTitle: `${m.home_team} v ${m.away_team}`, details: `${stmts.length} players rated`, request });
  return { ok: true };
}

// ── Scouting notes ──
export async function scoutingNotes(db, teamKeyValue) {
  await ensurePhase2Schema(db);
  return (await db.prepare(`SELECT id, season, note, created_by, created_at, updated_at FROM sx_scouting_notes WHERE team_key = ? AND is_deleted = 0 ORDER BY created_at DESC`).bind(teamKeyValue).all()).results;
}
export async function addScoutingNote(db, user, { teamKey, teamName, season, note }, { request = null } = {}) {
  await ensurePhase2Schema(db);
  const text = clean(note, 5000);
  if (text.length < 3) return { error: 'Write the note first.' };
  const id = newId('scn');
  await db.prepare(`INSERT INTO sx_scouting_notes (id, team_key, team_name, season, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, String(teamKey), oneLine(teamName, 80), oneLine(season, 12) || null, text, byName(user), nowIso()).run();
  await sxLog(db, statsActor(user), 'scouting_note', { itemType: 'scouting', itemId: id, itemTitle: oneLine(teamName, 80), request });
  return { ok: true, id };
}
export async function removeScoutingNote(db, user, id, { request = null } = {}) {
  await ensurePhase2Schema(db);
  await db.prepare(`UPDATE sx_scouting_notes SET is_deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?`).bind(byName(user), nowIso(), String(id)).run();
  await sxLog(db, statsActor(user), 'scouting_note_remove', { itemType: 'scouting', itemId: id, request });
  return { ok: true };
}

// ── Training themes and tags ──
export async function themes(db) {
  await ensurePhase2Schema(db);
  return (await db.prepare(`SELECT t.id, t.name, t.description, t.is_active, (SELECT COUNT(*) FROM sx_training_tags g WHERE g.theme_id = t.id AND g.is_deleted = 0) AS tags FROM sx_training_themes t WHERE t.is_deleted = 0 ORDER BY t.is_active DESC, t.name`).all()).results
    .map(r => ({ id: r.id, name: r.name, description: r.description || '', active: !!r.is_active, tags: r.tags }));
}
export async function saveTheme(db, user, b, { request = null } = {}) {
  await ensurePhase2Schema(db);
  const name = oneLine(b.name, 60);
  if (b.id) {
    await db.prepare(`UPDATE sx_training_themes SET name = COALESCE(NULLIF(?, ''), name), description = ?, is_active = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(name, oneLine(b.description, 300) || null, b.active === false ? 0 : 1, byName(user), nowIso(), String(b.id)).run();
    await sxLog(db, statsActor(user), 'training_theme', { itemType: 'theme', itemId: b.id, itemTitle: name, request });
    return { ok: true, id: b.id };
  }
  if (name.length < 3) return { error: 'Give the theme a name (e.g. pressing triggers).' };
  const id = newId('thm');
  await db.prepare(`INSERT INTO sx_training_themes (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, name, oneLine(b.description, 300) || null, byName(user), nowIso()).run();
  await sxLog(db, statsActor(user), 'training_theme', { itemType: 'theme', itemId: id, itemTitle: name, request });
  return { ok: true, id };
}
export async function addTag(db, user, { themeId, matchId, eventId, note }, { request = null } = {}) {
  await ensurePhase2Schema(db);
  if (!(await db.prepare(`SELECT id FROM sx_training_themes WHERE id = ? AND is_deleted = 0`).bind(String(themeId || '')).first())) return { error: 'Choose a training theme.' };
  if (!matchId && !eventId) return { error: 'Tag a match or an event.' };
  let mid = matchId ? String(matchId) : null;
  if (eventId) { const e = await db.prepare(`SELECT match_id FROM sx_events WHERE id = ?`).bind(String(eventId)).first(); if (!e) return { error: 'Event not found.' }; mid = e.match_id; }
  const dup = await db.prepare(`SELECT id FROM sx_training_tags WHERE theme_id = ? AND IFNULL(event_id, '') = ? AND IFNULL(match_id, '') = ? AND is_deleted = 0`).bind(String(themeId), String(eventId || ''), String(mid || '')).first();
  if (dup) return { ok: true, id: dup.id };
  const id = newId('tag');
  await db.prepare(`INSERT INTO sx_training_tags (id, theme_id, match_id, event_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, String(themeId), mid, eventId ? String(eventId) : null, oneLine(note, 300) || null, byName(user), nowIso()).run();
  await sxLog(db, statsActor(user), 'training_tag', { itemType: 'tag', itemId: id, request });
  return { ok: true, id };
}
export async function removeTag(db, user, id, { request = null } = {}) {
  await ensurePhase2Schema(db);
  await db.prepare(`UPDATE sx_training_tags SET is_deleted = 1 WHERE id = ?`).bind(String(id)).run();
  await sxLog(db, statsActor(user), 'training_tag_remove', { itemType: 'tag', itemId: id, request });
  return { ok: true };
}
/** How events tagged to a theme went, month by month (count, goals for and against, shots, success of set pieces). */
export async function themeReport(db, themeId) {
  await ensurePhase2Schema(db);
  const { results } = await db.prepare(`SELECT g.id AS tag_id, g.note, g.match_id, g.event_id, m.match_date, m.home_team, m.away_team, m.is_lobi_home, e.event_type, e.side, e.minute, e.player_name, e.set_piece_outcome, e.outcome
    FROM sx_training_tags g LEFT JOIN sx_matches m ON m.id = g.match_id LEFT JOIN sx_events e ON e.id = g.event_id WHERE g.theme_id = ? AND g.is_deleted = 0 ORDER BY m.match_date`).bind(String(themeId)).all();
  const months = {};
  for (const r of results) {
    const k = String(r.match_date || '').slice(0, 7) || 'unknown';
    const row = (months[k] ||= { month: k, tags: 0, events: 0, goalsFor: 0, goalsAgainst: 0, shots: 0, setPieceSuccess: 0 });
    row.tags++;
    if (r.event_type) {
      row.events++;
      const lobi = r.is_lobi_home ? 'home' : 'away';
      if (r.event_type === 'goal') { if (r.side === lobi) row.goalsFor++; else row.goalsAgainst++; }
      if (r.event_type === 'shot' || r.event_type === 'goal') row.shots++;
      if (r.set_piece_outcome === 'shot' || r.set_piece_outcome === 'goal') row.setPieceSuccess++;
    }
  }
  return { months: Object.values(months), items: results.map(r => ({ id: r.tag_id, date: r.match_date, match: `${r.home_team} v ${r.away_team}`, matchId: r.match_id, eventId: r.event_id, event: r.event_type ? `${r.event_type.replace(/_/g, ' ')} ${r.minute}'${r.player_name ? ` · ${r.player_name}` : ''}` : 'whole match', note: r.note || '' })) };
}
