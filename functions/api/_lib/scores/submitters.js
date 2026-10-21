// Score verification › Club network submitters: other clubs' media officers
// who may send scores. Each gets a secret link (and a PIN to type instead);
// only hashes are stored, so a lost link is replaced, never recovered.
// Submissions are CLUB_NETWORK reports with the submitter as identity, so two
// different officers count as two sources and one officer twice counts once.
import { ensureScoreSchema, addReport } from './model.js';
import { ensureDecisions, decidedResult, agreement } from './matchday.js';
import { latestPerSource } from './model.js';
import { logLeague } from '../leagueDb.js';

export async function sha256Hex(s) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(24)));
const newPin = () => { const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1e8; return String(n).padStart(8, '0'); };
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

/** A new submitter. Returns { id, token, pin } (shown once). */
export async function createSubmitter(env, admin, b) {
  await ensureScoreSchema(env);
  const name = clean(b.name, 80), club = clean(b.club, 80), phone = clean(b.phone, 30), email = clean(b.email, 120).toLowerCase();
  if (name.length < 2) return { error: 'Enter the person\'s name.' };
  if (club.length < 2) return { error: 'Enter their club.' };
  if (email && !EMAIL.test(email)) return { error: 'That email address doesn\'t look right.' };
  const teamId = b.teamId ? Number(b.teamId) : null;
  const token = newToken(), pin = newPin();
  const r = await env.DB.prepare(`INSERT INTO score_submitters (name, club, team_id, phone, email, token_hash, pin_hash, active, created_by, created_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) RETURNING id`)
    .bind(name, club, teamId, phone || null, email || null, await sha256Hex(token), await sha256Hex(`pin:${pin}`), admin.name, new Date().toISOString(), clean(b.note, 200) || null).first();
  await logLeague(env.DB, admin, 'score.submitter.add', 'submitter', r.id, null, { submitter: `${name} (${club}) added as a club network submitter by ${admin.name}` });
  return { ok: true, id: r.id, token, pin };
}
/** New link and PIN (the old ones stop working). */
export async function renewSubmitter(env, admin, id) {
  const s = await env.DB.prepare(`SELECT * FROM score_submitters WHERE id = ?`).bind(Number(id)).first();
  if (!s) return { error: 'Submitter not found.' };
  const token = newToken(), pin = newPin();
  await env.DB.prepare(`UPDATE score_submitters SET token_hash = ?, pin_hash = ?, active = 1, revoked_at = NULL, revoked_by = NULL WHERE id = ?`).bind(await sha256Hex(token), await sha256Hex(`pin:${pin}`), s.id).run();
  await logLeague(env.DB, admin, 'score.submitter.renew', 'submitter', s.id, null, { submitter: `New link and PIN for ${s.name} (${s.club}), by ${admin.name}` });
  return { ok: true, token, pin };
}
export async function revokeSubmitter(env, admin, id) {
  const s = await env.DB.prepare(`SELECT * FROM score_submitters WHERE id = ? AND active = 1`).bind(Number(id)).first();
  if (!s) return { error: 'Submitter not found.' };
  await env.DB.prepare(`UPDATE score_submitters SET active = 0, revoked_by = ?, revoked_at = ? WHERE id = ?`).bind(admin.name, new Date().toISOString(), s.id).run();
  await logLeague(env.DB, admin, 'score.submitter.revoke', 'submitter', s.id, null, { submitter: `${s.name} (${s.club}) removed by ${admin.name}: their link and PIN no longer work` });
  return { ok: true };
}
/** The submitter for a link token or a PIN (active only), or null. */
export async function submitterFor(env, { token, pin }) {
  await ensureScoreSchema(env);
  if (token && /^[\w-]{20,64}$/.test(token)) return env.DB.prepare(`SELECT * FROM score_submitters WHERE token_hash = ? AND active = 1`).bind(await sha256Hex(token)).first();
  if (pin && /^\d{8}$/.test(pin)) return env.DB.prepare(`SELECT * FROM score_submitters WHERE pin_hash = ? AND active = 1`).bind(await sha256Hex(`pin:${pin}`)).first();
  return null;
}

/**
 * Accuracy: of their full-time reports on matches with a final result (official,
 * verified, or two other sources agreeing), how many had the same score.
 */
export async function listSubmitters(env) {
  await ensureDecisions(env);
  const db = env.DB;
  const subs = (await db.prepare(`SELECT id, name, club, team_id, phone, email, active, created_by, created_at, revoked_at, note FROM score_submitters ORDER BY active DESC, club, name`).all()).results;
  const reports = (await db.prepare(`SELECT * FROM score_reports WHERE source_type = 'CLUB_NETWORK' ORDER BY received_at DESC`).all()).results;
  const fixtureIds = [...new Set(reports.filter(r => r.fixture_id && r.status === 'FULL_TIME').map(r => r.fixture_id))];
  const finals = new Map();
  for (const fid of fixtureIds) {
    const dec = decidedResult((await db.prepare(`SELECT * FROM score_decisions WHERE fixture_id = ?`).bind(fid).all()).results);
    if (dec) { finals.set(fid, dec); continue; }
    const all = (await db.prepare(`SELECT * FROM score_reports WHERE fixture_id = ? AND needs_review = 0 AND status = 'FULL_TIME'`).bind(fid).all()).results;
    const ag = agreement(latestPerSource(all));
    if (ag.state === 'agreed') finals.set(fid, ag.result);
  }
  return subs.map(s => {
    const mine = reports.filter(r => r.source_identity === `submitter:${s.id}`);
    const judged = mine.filter(r => r.status === 'FULL_TIME' && finals.has(r.fixture_id));
    const right = judged.filter(r => finals.get(r.fixture_id).home_goals === r.home_goals && finals.get(r.fixture_id).away_goals === r.away_goals);
    return { ...s, active: !!s.active, submissions: mine.length, lastAt: mine[0]?.received_at || null, judged: judged.length, accuracy: judged.length ? Math.round((right.length / judged.length) * 100) : null,
      recent: mine.slice(0, 10).map(r => ({ id: r.id, fixture_id: r.fixture_id, home_goals: r.home_goals, away_goals: r.away_goals, status: r.status, at: r.received_at, review: !!r.needs_review, home: r.home_name, away: r.away_name })) };
  });
}

/** Matches a submitter can report: kick-off from 18 hours ago to 6 hours ahead (today's games, Lagos). */
export async function openFixtures(env, now = Date.now()) {
  const { results } = await env.DB.prepare(`SELECT f.id, f.kickoff_at, f.matchday, h.name AS home, a.name AS away FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id
    JOIN league_teams a ON a.id = f.away_team_id WHERE f.kickoff_at BETWEEN ? AND ? ORDER BY f.kickoff_at, f.match_no`)
    .bind(new Date(now - 18 * 3600e3).toISOString(), new Date(now + 6 * 3600e3).toISOString()).all();
  return results;
}
/** A club network submission from the secure form. */
export async function submitFromForm(env, s, b, { now = Date.now() } = {}) {
  const open = await openFixtures(env, now);
  const f = open.find(x => x.id === Number(b.fixtureId));
  if (!f) return { error: 'Choose one of today\'s matches.' };
  const status = String(b.status || '').toUpperCase();
  if (!['LIVE', 'HALF_TIME', 'FULL_TIME', 'POSTPONED', 'ABANDONED'].includes(status)) return { error: 'Choose the match status.' };
  return addReport(env, { sourceType: 'CLUB_NETWORK', identity: `submitter:${s.id}`, label: `Club network – ${s.club} (${s.name})`, fixtureId: f.id,
    homeGoals: b.homeGoals, awayGoals: b.awayGoals, status, minute: b.minute ? String(b.minute).replace(/[^\d+']/g, '').slice(0, 6) : null,
    raw: { via: 'secure form', submitter: s.id }, createdBy: s.name });
}
