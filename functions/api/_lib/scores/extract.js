// Score verification, Phase 3: reading score messages (emails to the scores
// address, WhatsApp messages staff paste in, later a WhatsApp Business hook).
//
// The raw message is always kept (score_messages). Common formats are read by
// simple rules ("Kada Warriors 2-1 Wikki FT", "HT: ABS 0 Sokoto 0", "Wikki v
// Kada postponed"); only a message the rules can't read goes to Claude. Each
// match found becomes an ordinary score report from the sender's source.
// Claude never decides anything: it only reads, and anything it is not sure
// about (or from an unknown sender) is "Needs review" for the Data Officer.
import { ensureScoreSchema, addReport, loadTeams, findTeamByName, namesOf } from './model.js';
import { callClaude, aiReady, extractJson, scrubPersonal } from '../claude.js';
import { logLeague } from '../leagueDb.js';
import { scoreAlert } from './alerts.js';

export const CHANNELS = { EMAIL: 'Email', WHATSAPP: 'WhatsApp', PASTE: 'Pasted message' };
// Below this the report waits for a person (Needs review) instead of counting.
export const MIN_CONFIDENCE = 0.8;
// needs_review values on score_reports: 0 counts, 1 waiting, 2 approved (replaced by a new report), 3 rejected.
export const REVIEW = { COUNTS: 0, WAITING: 1, APPROVED: 2, REJECTED: 3 };

let ready = false;
export async function ensureMessageSchema(env) {
  await ensureScoreSchema(env);
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS score_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, sender TEXT, sender_name TEXT,
      subject TEXT, body TEXT NOT NULL, received_at TEXT NOT NULL, source_type TEXT, source_identity TEXT, method TEXT, status TEXT NOT NULL DEFAULT 'new',
      result_json TEXT, error TEXT, entered_by TEXT)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_score_messages_received ON score_messages (received_at)`),
  ]);
  ready = true;
}

// ── Reading by rules ──
const STATUS_WORDS = [
  [/\b(?:ft|f\/t|full[\s-]*time|final(?:\s+score)?|ended)\b/i, 'FULL_TIME'],
  [/\b(?:ht|h\/t|half[\s-]*time)\b/i, 'HALF_TIME'],
  [/\b(?:postponed|ppd|p-p|called off)\b/i, 'POSTPONED'],
  [/\b(?:abandoned|aban)\b/i, 'ABANDONED'],
  [/\b(?:k\.?o\.?|kick[\s-]*off|kicked off|started|live)\b/i, 'LIVE'],
];
const MINUTE = /(?:^|\s|\()(\d{1,3}(?:\s*\+\s*\d{1,2})?)\s*(?:'|’|′|mins?\b|minutes?\b)/i;
const NOISE = /^\s*(?:[*_~#>•\-–]+\s*)?(?:result|results|score|scores|update|latest|live|ncd|nnl|conference d|matchday\s*\d+|md\s*\d+)\s*[:\-–]\s*/i;

function cleanLine(line) {
  return String(line || '')
    .replace(/[*_~]/g, ' ')                                  // WhatsApp bold / italic / strike
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ') // emojis
    .replace(NOISE, '')
    .replace(/\s+/g, ' ').trim();
}
const tidyName = s => String(s || '').replace(/^[\s:,.\-–|()]+|[\s:,.\-–|()]+$/g, '').replace(/\s+/g, ' ').trim();

/** One line → { home, away, homeGoals, awayGoals, status, minute, explicitStatus } or null. */
export function parseLine(raw) {
  let line = cleanLine(raw);
  if (line.length < 5 || line.length > 160) return null;
  let status = null;
  for (const [re, st] of STATUS_WORDS) if (re.test(line)) { status = st; line = line.replace(re, ' '); break; }
  let minute = null;
  const mm = line.match(MINUTE);
  if (mm) { minute = mm[1].replace(/\s+/g, ''); line = line.replace(mm[0], ' '); if (!status) status = 'LIVE'; }
  line = line.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const explicitStatus = !!status;
  let m;
  // "Home 2-1 Away", "Home 2 : 1 Away"
  if ((m = line.match(/^(.+?)\s+(\d{1,2})\s*[-–:]\s*(\d{1,2})\s+(.+)$/))) return pack(m[1], m[4], m[2], m[3]);
  // "Home vs Away 2-1", "Home v Away: 2-1"
  if ((m = line.match(/^(.+?)\s+(?:vs?\.?|versus)\s+(.+?)\s*[:,\-–]?\s+(\d{1,2})\s*[-–:]\s*(\d{1,2})$/i))) return pack(m[1], m[2], m[3], m[4]);
  // "Home 2 Away 1", "Home 2, Away 1"
  if ((m = line.match(/^(.+?)\s+(\d{1,2})\s*,?\s+(.+?)\s+(\d{1,2})$/))) return pack(m[1], m[3], m[2], m[4]);
  // "Home vs Away postponed" (no score)
  if (status === 'POSTPONED' && (m = line.match(/^(.+?)\s+(?:vs?\.?|versus|-)\s+(.+)$/i))) return pack(m[1], m[2], null, null);
  return null;
  function pack(h, a, hg, ag) {
    const home = tidyName(h), away = tidyName(a);
    if (home.length < 2 || away.length < 2 || /^\d+$/.test(home) || /^\d+$/.test(away)) return null;
    return { home, away, homeGoals: hg === null ? null : Number(hg), awayGoals: ag === null ? null : Number(ag), status: status || 'LIVE', minute, explicitStatus };
  }
}

/**
 * Reads a whole message by rules. A status written on its own line ("FT" as a
 * heading) applies to the lines under it. Returns { matches, unreadLines }.
 */
export function parseByRules(text, teams) {
  const matches = [], unread = [];
  let heading = null;
  for (const raw of String(text || '').split(/\r?\n|;/)) {
    const line = cleanLine(raw);
    if (!line) continue;
    const only = STATUS_WORDS.find(([re]) => re.test(line) && line.replace(re, '').replace(/[\s:.\-–]/g, '').length === 0);
    if (only) { heading = only[1]; continue; }
    const p = parseLine(line);
    if (!p) { if (/\d/.test(line)) unread.push(line); continue; }
    if (!p.explicitStatus && heading) { p.status = heading; p.explicitStatus = true; }
    const h = findTeamByName(teams, p.home), a = findTeamByName(teams, p.away);
    // Confidence: both teams known and a status written down → sure; otherwise a person checks.
    p.confidence = h && a ? (p.explicitStatus ? 0.95 : 0.6) : 0.4;
    p.notes = [!h && `"${p.home}" not recognised`, !a && `"${p.away}" not recognised`, !p.explicitStatus && 'no status written (FT, HT, minute…)'].filter(Boolean).join('; ') || 'Read by rules';
    matches.push(p);
  }
  return { matches, unreadLines: unread };
}

// ── Reading with Claude (only when the rules can't) ──
const AI_STATUSES = ['LIVE', 'HALF_TIME', 'FULL_TIME', 'POSTPONED', 'ABANDONED'];
export async function parseWithClaude(env, text, teams) {
  const names = teams.map(t => `${t.name}${namesOf(t).length > 1 ? ` (also: ${JSON.parse(t.aliases || '[]').slice(0, 4).join(', ')})` : ''}`).join('\n');
  const system = `You read football score messages for the Nigeria National League, Conference D. You only copy what the message says: never guess a score, a status or a team.
Teams in this conference:\n${names}
Reply with ONE JSON object only: {"matches": [{"home": "team as written", "away": "team as written", "home_goals": number or null, "away_goals": number or null, "status": "LIVE" | "HALF_TIME" | "FULL_TIME" | "POSTPONED" | "ABANDONED", "minute": "67" or null, "confidence": number 0 to 1, "notes": "short reason if unsure"}]}.
Use confidence below 0.8 when anything is unclear (which team is home, whether it is the final score, a name you can't place). If the message has no score, reply {"matches": []}.`;
  const r = await callClaude(env, { feature: 'score_extract', system, prompt: `Message:\n"""\n${scrubPersonal(text).slice(0, 4000)}\n"""`, maxTokens: 700 });
  if (!r.ok) return { ok: false, error: r.error };
  const d = extractJson(r.text);
  if (!d || !Array.isArray(d.matches)) return { ok: false, error: r.mock ? 'Claude is in test mode (CLAUDE_MOCK): no real reading.' : 'Claude\'s answer could not be read.' };
  const num = v => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 99 ? Number(v) : NaN);
  const matches = [];
  for (const x of d.matches.slice(0, 20)) {
    const status = String(x?.status || '').toUpperCase(), hg = num(x?.home_goals), ag = num(x?.away_goals);
    if (!AI_STATUSES.includes(status) || Number.isNaN(hg) || Number.isNaN(ag) || !x.home || !x.away) continue;
    const conf = Math.max(0, Math.min(1, Number(x.confidence) || 0));
    const known = findTeamByName(teams, x.home) && findTeamByName(teams, x.away);
    matches.push({ home: tidyName(x.home).slice(0, 80), away: tidyName(x.away).slice(0, 80), homeGoals: hg, awayGoals: ag, status,
      minute: x.minute ? String(x.minute).slice(0, 8) : null, confidence: known ? conf : Math.min(conf, 0.5), notes: `Read by Claude${x.notes ? `: ${String(x.notes).slice(0, 200)}` : ''}` });
  }
  return { ok: true, matches, model: r.model, cost: r.cost };
}

// ── Who sent it ──
const digits = s => String(s || '').replace(/\D/g, '').slice(-10);
const emailOf = s => (String(s || '').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [''])[0].toLowerCase();

/**
 * The source a message counts as: an approved club submitter (by email or
 * phone), the commentary partner (COMMENTARY_SCORE_EMAILS), a staff member
 * (by email), or "unknown" (everything from it waits for review).
 */
export async function identifySender(env, { email, phone, as }) {
  const db = env.DB;
  if (as?.submitterId) {
    const s = await db.prepare(`SELECT id, name, club FROM score_submitters WHERE id = ? AND active = 1`).bind(Number(as.submitterId)).first();
    if (s) return { sourceType: 'CLUB_NETWORK', identity: `submitter:${s.id}`, label: `Club network – ${s.club} (${s.name})`, known: true };
  }
  if (as?.commentary) return { sourceType: 'COMMENTARY_ASSIST', identity: 'commentary', label: 'Commentary Assist', known: true };
  const e = emailOf(email), p = digits(phone);
  if (e && String(env.COMMENTARY_SCORE_EMAILS || '').toLowerCase().split(/[\s,;]+/).includes(e)) return { sourceType: 'COMMENTARY_ASSIST', identity: 'commentary', label: 'Commentary Assist (email)', known: true };
  const subs = (await db.prepare(`SELECT id, name, club, email, phone FROM score_submitters WHERE active = 1`).all()).results;
  const s = subs.find(x => (e && String(x.email || '').toLowerCase() === e) || (p.length >= 9 && digits(x.phone) === p));
  if (s) return { sourceType: 'CLUB_NETWORK', identity: `submitter:${s.id}`, label: `Club network – ${s.club} (${s.name})`, known: true };
  if (e) {
    const staff = await db.prepare(`SELECT id, name FROM admin_users WHERE active = 1 AND lower(email) = ?`).bind(e).first().catch(() => null);
    if (staff) return { sourceType: 'STAFF_MANUAL', identity: `staff:${staff.id}`, label: staff.name, known: true };
  }
  const who = e || (p ? `+…${p.slice(-4)}` : as?.name || 'unknown');
  return { sourceType: 'CLUB_NETWORK', identity: `unknown:${e || p || String(as?.name || 'unknown').toLowerCase().slice(0, 60)}`, label: `Unknown sender (${who})`, known: false };
}

/**
 * Keeps the message, reads it (rules first, Claude if needed) and adds one
 * report per match. Returns { ok, messageId, reports: [...], status, method }.
 */
export async function ingestMessage(env, { channel, from = '', fromName = '', phone = '', subject = '', text = '', as = null, enteredBy = null, receivedAt = null }) {
  await ensureMessageSchema(env);
  const db = env.DB;
  if (!CHANNELS[channel]) return { error: 'Unknown channel.' };
  const body = String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, 10000);
  if (body.length < 3 && String(subject || '').length < 3) return { error: 'The message is empty.' };
  const at = receivedAt || new Date().toISOString();
  const sender = await identifySender(env, { email: from, phone, as });
  const msg = await db.prepare(`INSERT INTO score_messages (channel, sender, sender_name, subject, body, received_at, source_type, source_identity, entered_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(channel, String(from || phone || '').slice(0, 160) || null, String(fromName || as?.name || '').slice(0, 120) || null, String(subject || '').slice(0, 200) || null, body, at,
      sender.sourceType, sender.identity, enteredBy).first();
  const teams = await loadTeams(env);
  const full = [subject, body].filter(Boolean).join('\n');
  let { matches, unreadLines } = parseByRules(full, teams), method = 'rules', aiError = null;
  const allSure = matches.length && matches.every(m => m.confidence >= MIN_CONFIDENCE);
  if (!allSure && (unreadLines.length || !matches.length || matches.some(m => m.confidence < MIN_CONFIDENCE)) && aiReady(env)) {
    const ai = await parseWithClaude(env, full, teams);
    if (ai.ok && ai.matches.length) { matches = ai.matches; method = 'claude'; }
    else if (!ai.ok) aiError = ai.error;
  }
  const reports = [];
  for (const m of matches) {
    const unsure = m.confidence < MIN_CONFIDENCE;
    const why = !sender.known ? `Sent by someone who is not an approved submitter (${sender.label})` : unsure ? `Not sure: ${m.notes}` : null;
    const r = await addReport(env, { sourceType: sender.sourceType, identity: sender.identity, label: sender.label, homeName: m.home, awayName: m.away,
      homeGoals: m.homeGoals, awayGoals: m.awayGoals, status: m.status, minute: m.minute, receivedAt: at,
      raw: { messageId: msg.id, channel, line: `${m.home} ${m.homeGoals ?? ''}-${m.awayGoals ?? ''} ${m.away}` }, confidence: m.confidence, confidenceNotes: m.notes,
      needsReview: !!why, reviewReason: why, createdBy: enteredBy || `${CHANNELS[channel]} reader` });
    reports.push(r.error ? { error: r.error, home: m.home, away: m.away } : { id: r.id, fixtureId: r.fixtureId, needsReview: r.needsReview, reason: r.reason, home: m.home, away: m.away,
      homeGoals: m.homeGoals, awayGoals: m.awayGoals, status: m.status, confidence: m.confidence });
  }
  const status = !reports.length ? 'needs_review' : reports.some(r => r.error || r.needsReview) ? 'needs_review' : 'read';
  const error = !reports.length ? (aiError || 'No score found in this message.') : reports.find(r => r.error)?.error || null;
  await db.prepare(`UPDATE score_messages SET method = ?, status = ?, result_json = ?, error = ? WHERE id = ?`).bind(method, status, JSON.stringify(reports), error, msg.id).run();
  if (status === 'needs_review') {
    await scoreAlert(env, { key: `msg:${msg.id}`, subject: 'A score message needs checking', link: '/admin/scores/messages/', lines: [
      `A ${CHANNELS[channel].toLowerCase()} from ${sender.label} could not be accepted automatically.`,
      error || reports.filter(r => r.needsReview || r.error).map(r => `${r.home} v ${r.away}: ${r.reason || r.error}`).join(' · '),
      'Please open Matchday › Score Messages and approve or reject it. Nothing counts until you do.'] });
  }
  return { ok: true, messageId: msg.id, reports, status, method, sender: sender.label, known: sender.known, error };
}

/**
 * Data Officer approves a report that was waiting: a new report is added with
 * the same source (and the match chosen, if the names weren't recognised), the
 * old one is marked approved. A person decides; the AI never does.
 */
export async function approveReport(env, admin, { reportId, fixtureId = null }) {
  const db = env.DB;
  const r = await db.prepare(`SELECT * FROM score_reports WHERE id = ?`).bind(Number(reportId)).first();
  if (!r) return { error: 'Report not found.' };
  if (r.needs_review !== REVIEW.WAITING) return { error: 'This report is not waiting for review.' };
  const fid = fixtureId ? Number(fixtureId) : r.fixture_id;
  if (!fid) return { error: 'Choose the match this report is about.' };
  const f = await db.prepare(`SELECT f.id, h.name AS home, a.name AS away FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id WHERE f.id = ?`).bind(fid).first();
  if (!f) return { error: 'Match not found.' };
  const n = await addReport(env, { sourceType: r.source_type, identity: r.source_identity, label: r.source_label, fixtureId: fid, homeGoals: r.home_goals, awayGoals: r.away_goals,
    status: r.status, minute: r.minute, receivedAt: r.received_at, raw: { approvedFrom: r.id, by: admin.name }, confidence: 1, confidenceNotes: `Checked and approved by ${admin.name}`, createdBy: admin.name });
  if (n.error) return n;
  await db.prepare(`UPDATE score_reports SET needs_review = ?, review_reason = ? WHERE id = ?`).bind(REVIEW.APPROVED, `${r.review_reason || ''} → approved by ${admin.name} (report ${n.id})`.slice(0, 500), r.id).run();
  await logLeague(db, admin, 'score.review.approve', 'fixture', fid, null, { result: `${admin.name} approved a report from ${r.source_label}: ${f.home} ${r.home_goals ?? '–'}-${r.away_goals ?? '–'} ${f.away} (${r.status})` });
  return { ok: true, id: n.id };
}

export async function rejectReport(env, admin, { reportId, reason }) {
  const db = env.DB;
  const why = String(reason || '').replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, 200);
  if (why.length < 3) return { error: 'Say why (e.g. "wrong match", "old score").' };
  const r = await db.prepare(`SELECT * FROM score_reports WHERE id = ?`).bind(Number(reportId)).first();
  if (!r) return { error: 'Report not found.' };
  if (r.needs_review !== REVIEW.WAITING) return { error: 'This report is not waiting for review.' };
  await db.prepare(`UPDATE score_reports SET needs_review = ?, review_reason = ? WHERE id = ?`).bind(REVIEW.REJECTED, `${r.review_reason || ''} → rejected by ${admin.name}: ${why}`.slice(0, 500), r.id).run();
  await logLeague(db, admin, 'score.review.reject', 'fixture', r.fixture_id, null, { result: `${admin.name} rejected a report from ${r.source_label} (${r.home_name || '?'} ${r.home_goals ?? '–'}-${r.away_goals ?? '–'} ${r.away_name || '?'}): ${why}` });
  return { ok: true };
}

/** Marks a message with no usable score as dealt with. */
export async function closeMessage(env, admin, { messageId, note }) {
  const db = env.DB;
  const m = await db.prepare(`SELECT id, status FROM score_messages WHERE id = ?`).bind(Number(messageId)).first();
  if (!m) return { error: 'Message not found.' };
  await db.prepare(`UPDATE score_messages SET status = 'closed', error = COALESCE(error, '') || ? WHERE id = ?`).bind(` · closed by ${admin.name}${note ? `: ${String(note).slice(0, 120)}` : ''}`, m.id).run();
  return { ok: true };
}

export async function listMessages(env, { limit = 60 } = {}) {
  await ensureMessageSchema(env);
  const db = env.DB;
  const msgs = (await db.prepare(`SELECT * FROM score_messages ORDER BY id DESC LIMIT ?`).bind(limit).all()).results;
  const waiting = (await db.prepare(`SELECT r.*, h.name AS fx_home, a.name AS fx_away, f.kickoff_at FROM score_reports r LEFT JOIN league_fixtures f ON f.id = r.fixture_id
    LEFT JOIN league_teams h ON h.id = f.home_team_id LEFT JOIN league_teams a ON a.id = f.away_team_id WHERE r.needs_review = 1 ORDER BY r.received_at DESC LIMIT 100`).all()).results;
  return { messages: msgs.map(m => ({ ...m, result: JSON.parse(m.result_json || '[]') })), waiting };
}

/** Number of things waiting for the Data Officer (bell). */
export async function reviewCount(env) {
  await ensureMessageSchema(env);
  const r = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM score_reports WHERE needs_review = 1) AS reports,
    (SELECT COUNT(*) FROM score_messages WHERE status = 'needs_review' AND result_json = '[]') AS messages`).first();
  return { reports: r.reports || 0, messages: r.messages || 0, total: (r.reports || 0) + (r.messages || 0) };
}
