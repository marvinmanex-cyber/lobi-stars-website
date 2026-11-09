// Scores Update Centre (/scores-centre): the page for updating NNL Conference D scores during games,
// week by week. Separate from the website admin (like the Media Centre, the IT Centre and MatchDay
// Kitchen): one shared access code (the Cloudflare secret SCORES_CENTRE_CODE, never in the code, as the
// repository is public) plus the person's name, so every update says who made it. Signed in until
// 2 hours without activity (owner's request, 9 Nov 2026), at most 14 hours.
//
// Each update is a staff-verified score (scores/matchday.js verifiedResult): it goes through score
// verification like League › Results and Other Games, so the league table, the live table, League
// History and the Activity Log all update by themselves. Only the newest update from the centre for a
// match stays active (older ones are kept, switched off). "Clear" withdraws it.
import { rateLimit, ensureFanSchema } from './fans.js';
import { verifiedResult, withdrawDecision, matchdayView, ensureDecisions } from './scores/matchday.js';
import { loadLeague, logLeague } from './leagueDb.js';
import { tablePayload } from './leagueApi.js';

export const SC_COOKIE = 'ls_sc';
export const IDLE_MS = 2 * 3600e3;
const MAX_MS = 14 * 3600e3;
const FAILS_PER_IP = 5;          // wrong codes from one connection per 15 minutes
const FAILS_ALL = 60;            // wrong codes from everywhere per 15 minutes (stops guessing from many connections)
export const STATUSES = ['SCHEDULED', 'LIVE', 'HALF_TIME', 'FULL_TIME', 'POSTPONED', 'ABANDONED', 'CANCELLED'];
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
const cleanName = s => String(s || '').replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
/** Who made a change, as League History and the Activity Log record it. */
export const actorOf = s => ({ id: 'scores-centre', name: `${s.name} ${TAG}`, email: `scores-centre: ${s.name}` });

let ready = false;
export async function ensureCentreSchema(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS sc_sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, csrf TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, ended_at TEXT, ended_why TEXT, ip TEXT, user_agent TEXT)`).run();
  ready = true;
}

/** Constant-time comparison of the typed code with the secret. */
async function codeMatches(env, typed) {
  const want = String(env.SCORES_CENTRE_CODE || '').trim();
  if (!want) return false;
  const [a, b] = await Promise.all([sha256Hex(`sc:${typed}`), sha256Hex(`sc:${want}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function failures(db, key) {
  const now = Math.floor(Date.now() / 1000), start = now - (now % 900);
  const row = await db.prepare(`SELECT window_start, count FROM rate_limits WHERE key = ?`).bind(key).first().catch(() => null);
  return row && row.window_start === start ? row.count : 0;
}

export async function signIn(env, request, { code, name }) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureCentreSchema(db);
  if (!env.SCORES_CENTRE_CODE) return { error: 'The Scores Update Centre is not set up yet. Ask a Super Admin.', status: 503 };
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const who = cleanName(name);
  if (who.length < 2) return { error: 'Type your name, so updates show who made them.', status: 400 };
  const typed = String(code || '').replace(/\s/g, '');
  if (!/^\d{4,12}$/.test(typed)) return { error: 'Type the access code (numbers only).', status: 400 };
  const ipKey = `sc-fail:${ip}`, allKey = 'sc-fail:all';
  if ((await failures(db, ipKey)) >= FAILS_PER_IP || (await failures(db, allKey)) >= FAILS_ALL) return { error: 'Too many wrong codes. Please wait 15 minutes and try again.', status: 429 };
  if (!(await codeMatches(env, typed))) {
    await rateLimit(db, ipKey, 1e6, 900); await rateLimit(db, allKey, 1e6, 900);
    await logLeague(db, { id: 'scores-centre', name: `${who} ${TAG}`, email: `scores-centre: ${who}` }, 'scores-centre.refused', 'session', null, null, { result: `Wrong access code typed by "${who}" (${ip})` }).catch(() => {});
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
}
/** Changes must come from the centre's own page with the session's token. */
export function csrfProblem(request, s) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return 'This change must be made from the Scores Update Centre.';
  if (request.headers.get('X-CSRF-Token') !== s.csrf) return 'Please reload the page and try again.';
  return null;
}

/** One week (matchday): its matches with the score that counts now, the weeks list and the live table. */
export async function weekView(env, round) {
  await ensureDecisions(env);
  const v = await matchdayView(env, { round });
  if (v.error) return v;
  const ids = v.cards.map(c => c.id);
  const mine = ids.length ? (await env.DB.prepare(`SELECT id, fixture_id, created_by, created_at FROM score_decisions WHERE active = 1 AND kind = 'VERIFIED' AND created_by LIKE ? AND fixture_id IN (${ids.map(() => '?').join(',')})`).bind(`%${TAG}`, ...ids).all()).results : [];
  const STATUS_OF = { scheduled: 'SCHEDULED', live: 'LIVE', half_time: 'HALF_TIME', full_time: 'FULL_TIME', postponed: 'POSTPONED', abandoned: 'ABANDONED', cancelled: 'CANCELLED', awarded: 'FULL_TIME' };
  const matches = v.cards.map(c => {
    const m = mine.filter(d => d.fixture_id === c.id).sort((a, b) => b.id - a.id)[0];
    const [lh, la] = c.leagueScore ? c.leagueScore.split('-').map(Number) : [null, null];
    return {
      id: c.id, matchNo: c.matchNo, kickoff: c.kickoff, venue: c.venue, home: c.home, away: c.away,
      homeGoals: c.confirmed?.home_goals ?? lh, awayGoals: c.confirmed?.away_goals ?? la,
      status: c.confirmed?.status || STATUS_OF[c.leagueStatus] || 'SCHEDULED',
      counted: !!c.confirmed, stateLabel: c.stateLabel || 'No score yet',
      updatedBy: m ? m.created_by.replace(` ${TAG}`, '') : null, updatedAt: m?.created_at || null, centreDecision: m?.id || null,
    };
  });
  const league = await loadLeague(env, { publishedOnly: true });
  let table = null;
  if (league) {
    // The centre always shows the live table: matches in play count as they stand.
    const t = tablePayload({ ...league, competition: { ...league.competition, include_live: 1 } });
    table = { rows: t.rows.map(r => ({ pos: r.pos, name: r.team.name, short: r.team.shortName, crest: r.team.crest, isLobi: r.team.isLobi, p: r.played, w: r.won, d: r.drawn, l: r.lost, gf: r.gf, ga: r.ga, gd: r.gd, pts: r.points, move: r.movement })), live: t.live, publicCountsLive: !!league.competition.include_live };
  }
  const { results: recent } = await env.DB.prepare(`SELECT after_json, created_at FROM league_audit_log WHERE staff_email LIKE 'scores-centre:%' AND action IN ('score.verified', 'score.withdrawn') ORDER BY id DESC LIMIT 15`).all().catch(() => ({ results: [] }));
  return {
    competition: v.competition.name, weeks: v.rounds, week: v.round, matches, table,
    recent: recent.map(r => { let a = {}; try { a = JSON.parse(r.after_json || '{}'); } catch { /* skip */ } return { text: tidy(a.result), at: r.created_at }; }),
  };
}

/** League History's wording, shortened for the "Recent updates" list. */
function tidy(s) {
  const x = String(s || '').replace(` ${TAG}`, '');
  let m = x.match(/^Verified result (.+?) set by (.+?): Entered in the Scores Update Centre/);
  if (m) return `${m[1]} · ${m[2]}`;
  m = x.match(/^Verified result for (.+?) withdrawn by (.+?): Cleared/);
  if (m) return `Cleared: ${m[1]} · ${m[2]}`;
  return x;
}
/** Saves a score from the centre. */
export async function updateScore(env, s, b) {
  const status = String(b.status || '').toUpperCase();
  if (!STATUSES.includes(status)) return { error: 'Choose the match status.' };
  const blank = v => v === '' || v === null || v === undefined;
  const needsScore = ['LIVE', 'HALF_TIME', 'FULL_TIME'].includes(status);
  const hg = needsScore || !blank(b.homeGoals) ? b.homeGoals : '', ag = needsScore || !blank(b.awayGoals) ? b.awayGoals : '';
  const r = await verifiedResult(env, actorOf(s), { fixtureId: b.fixtureId, homeGoals: status === 'SCHEDULED' ? '' : hg, awayGoals: status === 'SCHEDULED' ? '' : ag, status, reason: `Entered in the Scores Update Centre by ${s.name}` });
  if (r.error) return r;
  // Only the newest centre update for this match stays active (the rest are kept, switched off).
  await env.DB.prepare(`UPDATE score_decisions SET active = 0 WHERE fixture_id = ? AND kind = 'VERIFIED' AND active = 1 AND created_by LIKE ? AND id < (SELECT MAX(id) FROM score_decisions WHERE fixture_id = ? AND kind = 'VERIFIED' AND created_by LIKE ?)`)
    .bind(Number(b.fixtureId), `%${TAG}`, Number(b.fixtureId), `%${TAG}`).run();
  return r;
}
/** "Clear": withdraws the centre's score for this match (the match then follows its other sources). */
export async function clearScore(env, s, fixtureId) {
  const d = await env.DB.prepare(`SELECT id FROM score_decisions WHERE fixture_id = ? AND kind = 'VERIFIED' AND active = 1 AND created_by LIKE ? ORDER BY id DESC LIMIT 1`).bind(Number(fixtureId), `%${TAG}`).first();
  if (!d) return { error: 'There is no score from the Scores Update Centre on this match.' };
  return withdrawDecision(env, actorOf(s), d.id, `Cleared in the Scores Update Centre by ${s.name}`);
}
