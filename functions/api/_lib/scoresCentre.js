// Scores Update Centre (/scores-centre): the page for updating NNL Conference D scores during games,
// week by week. Separate from the website admin (like the Media Centre, the IT Centre and MatchDay
// Kitchen): one shared access code plus the person's name, so every update says who made it. The code
// is the Cloudflare secret SCORES_CENTRE_CODE (never in the code: the repository is public), or a new
// code a Super Admin sets in Admin › Scores Update Centre (only a hash is kept). Signed in until
// 2 hours without activity (owner's request, 9 Nov 2026), at most 14 hours.
//
// Each update is a staff-verified score (scores/matchday.js verifiedResult): it goes through score
// verification like League › Results and Other Games, so the league table, the live table, League
// History and the Activity Log all update by themselves. Only the newest update from the centre for a
// match stays active (older ones are kept, switched off, for the history and "Undo last change").
//
// Also (9 Nov 2026): a version check so nobody overwrites a newer score without being asked; goals,
// red cards and a note per match (sc_events, sc_match); the match clock (kick-off and second-half
// times); who is online and who is covering each match; the "Live now" view.
import { rateLimit, ensureFanSchema } from './fans.js';
import { verifiedResult, matchdayView, ensureDecisions } from './scores/matchday.js';
import { settleFixture } from './scores/consensus.js';
import { loadLeague, logLeague } from './leagueDb.js';
import { tablePayload } from './leagueApi.js';

export const SC_COOKIE = 'ls_sc';
export const IDLE_MS = 2 * 3600e3;
const MAX_MS = 14 * 3600e3;
const ONLINE_MS = 3 * 60e3;      // "online now": used the page in the last 3 minutes
const FAILS_PER_IP = 5;          // wrong codes from one connection per 15 minutes
const FAILS_ALL = 60;            // wrong codes from everywhere per 15 minutes (stops guessing from many connections)
export const STATUSES = ['SCHEDULED', 'LIVE', 'HALF_TIME', 'FULL_TIME', 'POSTPONED', 'ABANDONED', 'CANCELLED'];
export const EVENT_KINDS = { goal: 'Goal', pen: 'Penalty goal', og: 'Own goal', red: 'Red card' };
const TAG = '(Scores Update Centre)';

const nowIso = () => new Date().toISOString();
const enc = new TextEncoder();
async function sha256Hex(s) {
  const b = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const token = (n = 32) => { const a = crypto.getRandomValues(new Uint8Array(n)); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const cookieOf = (request, name) => (request.headers.get('Cookie') || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1] || null;
export const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers } });
export const clearCookie = () => `${SC_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
const cleanText = (s, max) => String(s || '').replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanName = s => cleanText(s, 60);
const untag = s => String(s || '').replace(` ${TAG}`, '');
/** Who made a change, as League History and the Activity Log record it. */
export const actorOf = s => ({ id: 'scores-centre', name: `${s.name} ${TAG}`, email: `scores-centre: ${s.name}` });

let ready = false;
export async function ensureCentreSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sc_sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, csrf TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ended_at TEXT, ended_why TEXT, ip TEXT, user_agent TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sc_match (fixture_id INTEGER PRIMARY KEY, kicked_off_at TEXT, second_half_at TEXT, cover_name TEXT, cover_session TEXT, cover_at TEXT, note TEXT, note_by TEXT, note_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sc_events (id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER NOT NULL, kind TEXT NOT NULL, side TEXT NOT NULL, player TEXT, minute TEXT, created_by TEXT, created_at TEXT NOT NULL, removed_by TEXT, removed_at TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sc_events_fixture ON sc_events (fixture_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sc_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
  ]);
  ready = true;
}
const setting = async (db, key) => (await db.prepare(`SELECT value, updated_at, updated_by FROM sc_settings WHERE key = ?`).bind(key).first().catch(() => null)) || null;

// ── The access code ──
const codeHash = (env, code) => sha256Hex(`sc-code:${env.SESSION_SECRET || 'lobi'}:${code}`);
/** Constant-time check of the typed code against the code a Super Admin set, or else the Cloudflare secret. */
async function codeMatches(env, typed) {
  const saved = await setting(env.DB, 'code_hash');
  const want = saved?.value || (env.SCORES_CENTRE_CODE ? await codeHash(env, String(env.SCORES_CENTRE_CODE).trim()) : '');
  if (!want) return false;
  const got = await codeHash(env, typed);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  return diff === 0 && got.length === want.length;
}
/** Why a new code is too easy, or null. */
export function weakCode(code) {
  const d = String(code || '');
  if (!/^\d{4,12}$/.test(d)) return 'The code must be 4 to 12 numbers.';
  if (new Set(d).size < 2) return 'Use at least 2 different numbers.';
  const steps = [...d].slice(1).map((c, i) => (Number(c) - Number(d[i]) + 10) % 10);
  if (steps.every(s => s === 1) || steps.every(s => s === 9)) return 'Numbers counting up or down are too easy to guess.';
  return null;
}
export async function changeCode(env, admin, code) {
  await ensureCentreSchema(env.DB);
  const why = weakCode(code);
  if (why) return { error: why };
  await env.DB.prepare(`INSERT INTO sc_settings (key, value, updated_at, updated_by) VALUES ('code_hash', ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(await codeHash(env, code), nowIso(), admin.name || admin.email).run();
  return { ok: true };
}
async function failures(db, key) {
  const now = Math.floor(Date.now() / 1000), start = now - (now % 900);
  const row = await db.prepare(`SELECT window_start, count FROM rate_limits WHERE key = ?`).bind(key).first().catch(() => null);
  return row && row.window_start === start ? row.count : 0;
}

export async function signIn(env, request, { code, name }) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureCentreSchema(db);
  if (!env.SCORES_CENTRE_CODE && !(await setting(db, 'code_hash'))) return { error: 'The Scores Update Centre is not set up yet. Ask a Super Admin.', status: 503 };
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const who = cleanName(name);
  if (who.length < 2) return { error: 'Type your name, so updates show who made them.', status: 400 };
  const typed = String(code || '').replace(/\s/g, '');
  if (!/^\d{4,12}$/.test(typed)) return { error: 'Type the access code (numbers only).', status: 400 };
  const ipKey = `sc-fail:${ip}`, allKey = 'sc-fail:all';
  if ((await failures(db, ipKey)) >= FAILS_PER_IP || (await failures(db, allKey)) >= FAILS_ALL) return { error: 'Too many wrong codes. Please wait 15 minutes and try again.', status: 429 };
  if (!(await codeMatches(env, typed))) {
    await rateLimit(db, ipKey, 1e6, 900); await rateLimit(db, allKey, 1e6, 900);
    await logLeague(db, actorOf({ name: who }), 'scores-centre.refused', 'session', null, null, { result: `Wrong access code typed by "${who}" (${ip})` }).catch(() => {});
    return { error: 'That code is not right.', status: 401 };
  }
  const t = token(), id = await sha256Hex(t), csrf = token(18), at = nowIso();
  await db.prepare(`INSERT INTO sc_sessions (id, name, csrf, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, who, csrf, at, at, ip, String(request.headers.get('User-Agent') || '').slice(0, 300)).run();
  await logLeague(db, actorOf({ name: who }), 'scores-centre.signin', 'session', null, null, { result: `${who} signed in to the Scores Update Centre` }).catch(() => {});
  return { ok: true, cookie: `${SC_COOKIE}=${t}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_MS / 1000}` };
}

/** The session for this request, or null (ends sessions idle for 2 hours or older than 14 hours). */
export async function getSession(request, env, { touch = true } = {}) {
  const t = cookieOf(request, SC_COOKIE);
  if (!t || !/^[\w-]{20,80}$/.test(t)) return null;
  const db = env.DB;
  await ensureCentreSchema(db);
  const s = await db.prepare(`SELECT * FROM sc_sessions WHERE id = ? AND ended_at IS NULL`).bind(await sha256Hex(t)).first();
  if (!s) return null;
  const now = Date.now();
  const end = why => db.prepare(`UPDATE sc_sessions SET ended_at = ?, ended_why = ? WHERE id = ?`).bind(nowIso(), why, s.id).run();
  if (now - Date.parse(s.last_seen) > IDLE_MS) { await end('2 hours without activity'); return null; }
  if (now - Date.parse(s.created_at) > MAX_MS) { await end('14 hours'); return null; }
  if (touch && now - Date.parse(s.last_seen) > 20e3) await db.prepare(`UPDATE sc_sessions SET last_seen = ? WHERE id = ?`).bind(nowIso(), s.id).run();
  return { id: s.id, name: s.name, csrf: s.csrf, lastSeen: s.last_seen };
}
export async function signOut(env, s) {
  await env.DB.prepare(`UPDATE sc_sessions SET ended_at = ?, ended_why = 'signed out' WHERE id = ? AND ended_at IS NULL`).bind(nowIso(), s.id).run();
  await env.DB.prepare(`UPDATE sc_match SET cover_name = NULL, cover_session = NULL, cover_at = NULL WHERE cover_session = ?`).bind(s.id).run().catch(() => {});
}
/** Changes must come from the centre's own page with the session's token. */
export function csrfProblem(request, s) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return 'This change must be made from the Scores Update Centre.';
  if (request.headers.get('X-CSRF-Token') !== s.csrf) return 'Please reload the page and try again.';
  return null;
}

// ── For Super Admins (Admin › Scores Update Centre) ──
export async function adminOverview(env) {
  const db = env.DB;
  await ensureCentreSchema(db);
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { results: sessions } = await db.prepare(`SELECT id, name, created_at, last_seen, ended_at, ended_why, ip, user_agent FROM sc_sessions WHERE created_at >= ? ORDER BY created_at DESC LIMIT 100`).bind(since).all();
  const { results: refused } = await db.prepare(`SELECT after_json, created_at FROM league_audit_log WHERE action = 'scores-centre.refused' ORDER BY id DESC LIMIT 40`).all().catch(() => ({ results: [] }));
  const code = await setting(db, 'code_hash');
  const now = Date.now();
  return {
    sessions: sessions.map(s => ({ id: s.id.slice(0, 12), name: s.name, since: s.created_at, lastSeen: s.last_seen, open: !s.ended_at && now - Date.parse(s.last_seen) <= IDLE_MS, online: !s.ended_at && now - Date.parse(s.last_seen) <= ONLINE_MS, ended: s.ended_at, endedWhy: s.ended_why, ip: s.ip, device: deviceOf(s.user_agent) })),
    refused: refused.map(r => { let a = {}; try { a = JSON.parse(r.after_json || '{}'); } catch { /* skip */ } return { text: a.result || '', at: r.created_at }; }),
    code: code ? { source: 'admin', changedAt: code.updated_at, changedBy: code.updated_by } : { source: env.SCORES_CENTRE_CODE ? 'secret' : 'none' },
  };
}
const deviceOf = ua => { const u = String(ua || ''); return /iPhone|iPad/.test(u) ? 'iPhone / iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'Mac' : 'Other'; };
export async function signOutSessions(env, idPrefix = null) {
  await ensureCentreSchema(env.DB);
  const r = idPrefix
    ? await env.DB.prepare(`UPDATE sc_sessions SET ended_at = ?, ended_why = 'signed out by a Super Admin' WHERE ended_at IS NULL AND substr(id, 1, 12) = ?`).bind(nowIso(), String(idPrefix).slice(0, 12)).run()
    : await env.DB.prepare(`UPDATE sc_sessions SET ended_at = ?, ended_why = 'signed out by a Super Admin' WHERE ended_at IS NULL`).bind(nowIso()).run();
  await env.DB.prepare(`UPDATE sc_match SET cover_name = NULL, cover_session = NULL, cover_at = NULL WHERE cover_session IS NOT NULL AND cover_session NOT IN (SELECT id FROM sc_sessions WHERE ended_at IS NULL)`).run().catch(() => {});
  return { ok: true, ended: r.meta?.changes || 0 };
}

// ── The week ──
const STATUS_OF = { scheduled: 'SCHEDULED', live: 'LIVE', half_time: 'HALF_TIME', full_time: 'FULL_TIME', postponed: 'POSTPONED', abandoned: 'ABANDONED', cancelled: 'CANCELLED', awarded: 'FULL_TIME' };
const lagosDay = ms => new Date(ms + 3600e3).toISOString().slice(0, 10);
/** What a match is at now, to notice a newer change by someone else. */
const versionOf = (latestDecision, f) => `${latestDecision || 0}:${f.home_goals ?? ''}:${f.away_goals ?? ''}:${f.status || ''}`;
async function currentVersion(db, fixtureId) {
  const f = await db.prepare(`SELECT home_goals, away_goals, status FROM league_fixtures WHERE id = ?`).bind(Number(fixtureId)).first();
  if (!f) return null;
  const d = await db.prepare(`SELECT MAX(id) AS id FROM score_decisions WHERE fixture_id = ?`).bind(Number(fixtureId)).first();
  return versionOf(d?.id, f);
}

/**
 * One week (matchday), or "live" (today's matches, live ones first): the matches with the score that
 * counts now, goals, red cards, notes, the clock, who is covering them; the weeks; the live table;
 * recent updates; who is online.
 */
export async function weekView(env, round, session = null, now = Date.now()) {
  await ensureDecisions(env); await ensureCentreSchema(env.DB);
  const db = env.DB;
  const wantLive = round === 'live';
  let v = await matchdayView(env, { round: wantLive ? null : round, now });
  if (v.error) return v;
  const today = lagosDay(now);
  const isToday = c => c.kickoff && lagosDay(Date.parse(c.kickoff)) === today;
  // No week chosen: open "Live now" when there are matches today.
  const live = wantLive || (round == null && v.cards.some(isToday));
  const ids = v.cards.map(c => c.id);
  const q = ids.map(() => '?').join(',') || 'NULL';
  const [mine, latest, extra, events] = ids.length ? await Promise.all([
    db.prepare(`SELECT id, fixture_id, created_by, created_at FROM score_decisions WHERE active = 1 AND kind = 'VERIFIED' AND created_by LIKE ? AND fixture_id IN (${q})`).bind(`%${TAG}`, ...ids).all().then(r => r.results),
    db.prepare(`SELECT fixture_id, MAX(id) AS id FROM score_decisions WHERE fixture_id IN (${q}) GROUP BY fixture_id`).bind(...ids).all().then(r => r.results),
    db.prepare(`SELECT * FROM sc_match WHERE fixture_id IN (${q})`).bind(...ids).all().then(r => r.results),
    db.prepare(`SELECT id, fixture_id, kind, side, player, minute, created_by FROM sc_events WHERE removed_at IS NULL AND fixture_id IN (${q}) ORDER BY CAST(minute AS INTEGER), id`).bind(...ids).all().then(r => r.results),
  ]) : [[], [], [], []];
  const online = (await db.prepare(`SELECT id, name, last_seen FROM sc_sessions WHERE ended_at IS NULL AND last_seen >= ? ORDER BY last_seen DESC`).bind(new Date(now - ONLINE_MS).toISOString()).all()).results;
  const onlineIds = new Set(online.map(o => o.id));
  let matches = v.cards.map(c => {
    const m = mine.filter(d => d.fixture_id === c.id).sort((a, b) => b.id - a.id)[0];
    const [lh, la] = c.leagueScore ? c.leagueScore.split('-').map(Number) : [null, null];
    const x = extra.find(e => e.fixture_id === c.id) || {};
    const covering = x.cover_session && onlineIds.has(x.cover_session) ? x.cover_name : null;
    return {
      id: c.id, round: c.round, matchNo: c.matchNo, kickoff: c.kickoff, venue: c.venue, home: c.home, away: c.away,
      homeGoals: c.confirmed?.home_goals ?? lh, awayGoals: c.confirmed?.away_goals ?? la,
      status: c.confirmed?.status || STATUS_OF[c.leagueStatus] || 'SCHEDULED',
      counted: !!c.confirmed, stateLabel: c.stateLabel || 'No score yet',
      updatedBy: m ? untag(m.created_by) : null, updatedAt: m?.created_at || null, centreDecision: m?.id || null,
      version: versionOf(latest.find(l => l.fixture_id === c.id)?.id, { home_goals: lh, away_goals: la, status: c.leagueStatus }),
      kickedOffAt: x.kicked_off_at || null, secondHalfAt: x.second_half_at || null,
      covering, coveringMe: !!(covering && session && x.cover_session === session.id),
      note: x.note || '', noteBy: x.note_by || null,
      events: events.filter(e => e.fixture_id === c.id).map(e => ({ id: e.id, kind: e.kind, side: e.side, player: e.player || '', minute: e.minute || '', by: e.created_by })),
    };
  });
  if (live) {
    const rank = s => (s === 'LIVE' || s === 'HALF_TIME' ? 0 : s === 'SCHEDULED' ? 1 : 2);
    matches = matches.filter(m => isToday(m) || ['LIVE', 'HALF_TIME'].includes(m.status)).sort((a, b) => rank(a.status) - rank(b.status) || String(a.kickoff).localeCompare(String(b.kickoff)));
  }
  const league = await loadLeague(env, { publishedOnly: true });
  let table = null;
  if (league) {
    // The centre always shows the live table: matches in play count as they stand.
    const t = tablePayload({ ...league, competition: { ...league.competition, include_live: 1 } });
    table = { rows: t.rows.map(r => ({ pos: r.pos, name: r.team.name, short: r.team.shortName, crest: r.team.crest, isLobi: r.team.isLobi, p: r.played, w: r.won, d: r.drawn, l: r.lost, gf: r.gf, ga: r.ga, gd: r.gd, pts: r.points, move: r.movement })), live: t.live, publicCountsLive: !!league.competition.include_live };
  }
  const { results: recent } = await db.prepare(`SELECT after_json, created_at FROM league_audit_log WHERE staff_email LIKE 'scores-centre:%' AND action IN ('score.verified', 'score.withdrawn', 'score.undo', 'scores-centre.event') ORDER BY id DESC LIMIT 15`).all().catch(() => ({ results: [] }));
  return {
    competition: v.competition.name, weeks: v.rounds, week: live ? 'live' : v.round, liveRound: v.round, matches, table, serverTime: new Date(now).toISOString(),
    online: [...new Set(online.map(o => o.name))],
    recent: recent.map(r => { let a = {}; try { a = JSON.parse(r.after_json || '{}'); } catch { /* skip */ } return { text: tidy(a.result), at: r.created_at }; }),
  };
}
/** League History's wording, shortened for the "Recent updates" list. */
function tidy(s) {
  const x = untag(s);
  let m = x.match(/^Verified result (.+?) set by (.+?): Entered in the Scores Update Centre/);
  if (m) return `${m[1]} · ${m[2]}`;
  m = x.match(/^Verified result for (.+?) withdrawn by (.+?): Cleared/);
  if (m) return `Cleared: ${m[1]} · ${m[2]}`;
  return x;
}

async function fixtureLabel(db, id) {
  return db.prepare(`SELECT f.id, f.kickoff_at, h.name AS home, a.name AS away FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id WHERE f.id = ?`).bind(Number(id)).first();
}

/**
 * Saves a score from the centre. Without force, a match that changed since the page loaded it
 * (b.version) is not overwritten: { conflict, current } comes back so the person can decide.
 */
export async function updateScore(env, s, b) {
  const db = env.DB;
  const status = String(b.status || '').toUpperCase();
  if (!STATUSES.includes(status)) return { error: 'Choose the match status.' };
  if (b.version && b.force !== true) {
    const cur = await currentVersion(db, b.fixtureId);
    if (cur && cur !== b.version) {
      const f = await db.prepare(`SELECT home_goals, away_goals, status, updated_by FROM league_fixtures WHERE id = ?`).bind(Number(b.fixtureId)).first();
      const d = await db.prepare(`SELECT created_by, created_at FROM score_decisions WHERE fixture_id = ? ORDER BY id DESC LIMIT 1`).bind(Number(b.fixtureId)).first();
      return { conflict: true, error: 'Someone changed this match after you opened it.', current: { homeGoals: f?.home_goals ?? null, awayGoals: f?.away_goals ?? null, status: STATUS_OF[f?.status] || 'SCHEDULED', by: d ? untag(d.created_by) : 'another score source', at: d?.created_at || null } };
    }
  }
  const blank = v => v === '' || v === null || v === undefined;
  const needsScore = ['LIVE', 'HALF_TIME', 'FULL_TIME'].includes(status);
  const hg = needsScore || !blank(b.homeGoals) ? b.homeGoals : '', ag = needsScore || !blank(b.awayGoals) ? b.awayGoals : '';
  const r = await verifiedResult(env, actorOf(s), { fixtureId: b.fixtureId, homeGoals: status === 'SCHEDULED' ? '' : hg, awayGoals: status === 'SCHEDULED' ? '' : ag, status, reason: `Entered in the Scores Update Centre by ${s.name}` });
  if (r.error) return r;
  // Only the newest centre update for this match stays active (the rest are kept, switched off).
  await db.prepare(`UPDATE score_decisions SET active = 0 WHERE fixture_id = ? AND kind = 'VERIFIED' AND active = 1 AND created_by LIKE ? AND id < (SELECT MAX(id) FROM score_decisions WHERE fixture_id = ? AND kind = 'VERIFIED' AND created_by LIKE ?)`)
    .bind(Number(b.fixtureId), `%${TAG}`, Number(b.fixtureId), `%${TAG}`).run();
  return { ...r, version: await currentVersion(db, b.fixtureId) };
}

/** A match's history: every score decision (newest first), goals and red cards, including removed ones. */
export async function history(env, fixtureId) {
  const db = env.DB;
  await ensureDecisions(env); await ensureCentreSchema(db);
  const f = await fixtureLabel(db, fixtureId);
  if (!f) return { error: 'Match not found.' };
  const { results: ds } = await db.prepare(`SELECT id, kind, home_goals, away_goals, status, reason, created_by, created_at, active FROM score_decisions WHERE fixture_id = ? ORDER BY id DESC LIMIT 40`).bind(f.id).all();
  const { results: ev } = await db.prepare(`SELECT * FROM sc_events WHERE fixture_id = ? ORDER BY id DESC LIMIT 40`).bind(f.id).all();
  const mine = ds.filter(d => d.kind === 'VERIFIED' && String(d.created_by).endsWith(TAG));
  return {
    match: `${f.home} v ${f.away}`,
    changes: ds.map(d => ({ id: d.id, kind: d.kind, home: d.home_goals, away: d.away_goals, status: d.status, by: untag(d.created_by), at: d.created_at, active: !!d.active, centre: String(d.created_by).endsWith(TAG), reason: d.reason })),
    events: ev.map(e => ({ id: e.id, kind: e.kind, side: e.side, player: e.player, minute: e.minute, by: e.created_by, at: e.created_at, removedBy: e.removed_by, removedAt: e.removed_at })),
    canUndo: mine.some(d => d.active),
  };
}

/** "Undo last change": switches off the newest centre score and brings back the one before it (if any). */
export async function undoLast(env, s, fixtureId) {
  const db = env.DB;
  await ensureDecisions(env);
  const f = await fixtureLabel(db, fixtureId);
  if (!f) return { error: 'Match not found.' };
  const { results } = await db.prepare(`SELECT id, home_goals, away_goals, status, active FROM score_decisions WHERE fixture_id = ? AND kind = 'VERIFIED' AND created_by LIKE ? ORDER BY id DESC LIMIT 2`).bind(f.id, `%${TAG}`).all();
  const [last, before] = results;
  if (!last || !last.active) return { error: 'There is no change from the Scores Update Centre to undo on this match.' };
  await db.prepare(`UPDATE score_decisions SET active = 0 WHERE id = ?`).bind(last.id).run();
  if (before) await db.prepare(`UPDATE score_decisions SET active = 1 WHERE id = ?`).bind(before.id).run();
  const words = d => (d.home_goals == null ? String(d.status).replace('_', ' ').toLowerCase() : `${d.home_goals}–${d.away_goals} (${String(d.status).replace('_', ' ').toLowerCase()})`);
  await logLeague(db, actorOf(s), 'score.undo', 'fixture', f.id, null, { result: `${f.home} v ${f.away}: ${s.name} undid ${words(last)}${before ? `, back to ${words(before)}` : '; the match follows its other score sources'}` });
  const settled = await settleFixture(env, f.id);
  return { ok: true, state: settled?.state };
}
/** "Clear": withdraws every active centre score for this match (it then follows its other sources). */
export async function clearScore(env, s, fixtureId) {
  const db = env.DB;
  const f = await fixtureLabel(db, fixtureId);
  if (!f) return { error: 'Match not found.' };
  const r = await db.prepare(`UPDATE score_decisions SET active = 0 WHERE fixture_id = ? AND kind = 'VERIFIED' AND active = 1 AND created_by LIKE ?`).bind(f.id, `%${TAG}`).run();
  if (!r.meta?.changes) return { error: 'There is no score from the Scores Update Centre on this match.' };
  await logLeague(db, actorOf(s), 'score.withdrawn', 'fixture', f.id, null, { result: `Verified result for ${f.home} v ${f.away} withdrawn by ${s.name}: Cleared in the Scores Update Centre` });
  const settled = await settleFixture(env, f.id);
  return { ok: true, state: settled?.state };
}

// ── Goals, red cards, notes, the clock, covering ──
async function upsertMatch(db, fixtureId, cols) {
  await db.prepare(`INSERT INTO sc_match (fixture_id) VALUES (?) ON CONFLICT (fixture_id) DO NOTHING`).bind(Number(fixtureId)).run();
  const keys = Object.keys(cols);
  await db.prepare(`UPDATE sc_match SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE fixture_id = ?`).bind(...keys.map(k => cols[k]), Number(fixtureId)).run();
}
export async function addEvent(env, s, b) {
  const db = env.DB;
  await ensureCentreSchema(db);
  const f = await fixtureLabel(db, b.fixtureId);
  if (!f) return { error: 'Match not found.' };
  if (!EVENT_KINDS[b.kind]) return { error: 'Choose goal, penalty, own goal or red card.' };
  if (!['home', 'away'].includes(b.side)) return { error: 'Choose the team.' };
  const minute = cleanText(b.minute, 8);
  if (minute && !/^\d{1,3}(\+\d{1,2})?$/.test(minute)) return { error: 'The minute is a number, e.g. 67 or 90+2.' };
  const player = cleanText(b.player, 60);
  const r = await db.prepare(`INSERT INTO sc_events (fixture_id, kind, side, player, minute, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(f.id, b.kind, b.side, player || null, minute || null, s.name, nowIso()).run();
  const team = b.side === 'home' ? f.home : f.away;
  await logLeague(db, actorOf(s), 'scores-centre.event', 'fixture', f.id, null, { result: `${EVENT_KINDS[b.kind]}${minute ? ` ${minute}'` : ''}: ${player || 'player not named'} (${team}), ${f.home} v ${f.away} · ${s.name}` });
  return { ok: true, id: r.meta?.last_row_id };
}
export async function removeEvent(env, s, id) {
  const db = env.DB;
  await ensureCentreSchema(db);
  const e = await db.prepare(`SELECT * FROM sc_events WHERE id = ? AND removed_at IS NULL`).bind(Number(id)).first();
  if (!e) return { error: 'That entry is no longer there.' };
  await db.prepare(`UPDATE sc_events SET removed_by = ?, removed_at = ? WHERE id = ?`).bind(s.name, nowIso(), e.id).run();
  const f = await fixtureLabel(db, e.fixture_id);
  await logLeague(db, actorOf(s), 'scores-centre.event', 'fixture', e.fixture_id, e, { result: `Removed: ${EVENT_KINDS[e.kind]}${e.minute ? ` ${e.minute}'` : ''} ${e.player || ''} (${f?.home} v ${f?.away}) · ${s.name}` });
  return { ok: true };
}
export async function saveNote(env, s, b) {
  const db = env.DB;
  await ensureCentreSchema(db);
  const f = await fixtureLabel(db, b.fixtureId);
  if (!f) return { error: 'Match not found.' };
  const note = cleanText(b.note, 200);
  await upsertMatch(db, f.id, { note: note || null, note_by: note ? s.name : null, note_at: note ? nowIso() : null });
  await logLeague(db, actorOf(s), 'scores-centre.event', 'fixture', f.id, null, { result: `${note ? `Note: "${note}"` : 'Note removed'} (${f.home} v ${f.away}) · ${s.name}` });
  return { ok: true };
}
/** The clock: 'kickoff' (it kicked off now), 'second-half' (the second half started now) or 'reset'. */
export async function setClock(env, s, b) {
  const db = env.DB;
  await ensureCentreSchema(db);
  const f = await fixtureLabel(db, b.fixtureId);
  if (!f) return { error: 'Match not found.' };
  const at = nowIso();
  if (b.action === 'kickoff') await upsertMatch(db, f.id, { kicked_off_at: at, second_half_at: null });
  else if (b.action === 'second-half') await upsertMatch(db, f.id, { second_half_at: at });
  else if (b.action === 'reset') await upsertMatch(db, f.id, { kicked_off_at: null, second_half_at: null });
  else return { error: 'Unknown clock action.' };
  return { ok: true, at };
}
export async function setCover(env, s, b) {
  const db = env.DB;
  await ensureCentreSchema(db);
  const f = await fixtureLabel(db, b.fixtureId);
  if (!f) return { error: 'Match not found.' };
  if (b.on) await upsertMatch(db, f.id, { cover_name: s.name, cover_session: s.id, cover_at: nowIso() });
  else await db.prepare(`UPDATE sc_match SET cover_name = NULL, cover_session = NULL, cover_at = NULL WHERE fixture_id = ? AND cover_session = ?`).bind(f.id, s.id).run();
  return { ok: true };
}
