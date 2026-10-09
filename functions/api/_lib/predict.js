// Predict & Win (Lobi Stars HOME games only). All times use the server clock.
//
// - Predictions open PREDICTION_OPENS_HOURS_BEFORE hours before the
//   scheduled kick-off and close at kick-off (see predictSettings.js).
// - One prediction per fan per match (UNIQUE (event_id, member_id)); it can't
//   be edited. The exact server time is saved to the millisecond.
// - When staff enter the final score, the winner is the fan with the exact
//   score and the EARLIEST submission. Disqualified entries and accounts
//   flagged as club staff/players can't win. No exact score = no winner.
import { LIVE_STATUSES } from './matchCentre.js';
import { PREDICTION_OPENS_HOURS_BEFORE, PREDICTION_CLOSES_AT, MAX_GOALS, PRIZE_AMOUNT } from './predictSettings.js';
import { maskPhone, sendPrizeWinnerEmail } from './fans.js';

let ready = false;
export async function ensurePredictSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      member_id TEXT NOT NULL,          -- becomes 'deleted-<id>' if the fan asks to be erased
      home_goals INTEGER NOT NULL,
      away_goals INTEGER NOT NULL,
      created_at TEXT NOT NULL,         -- server time, ISO with milliseconds
      is_winner INTEGER NOT NULL DEFAULT 0,
      disqualified INTEGER NOT NULL DEFAULT 0,
      dq_reason TEXT,
      dq_by TEXT,
      dq_at TEXT,
      UNIQUE (event_id, member_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_predictions_event ON predictions(event_id, created_at)`),
    // One row per match once the result is calculated; tracks the prize payment.
    db.prepare(`CREATE TABLE IF NOT EXISTS prediction_results (
      event_id TEXT PRIMARY KEY,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      winner_prediction_id INTEGER,
      winner_member_id TEXT,
      correct_count INTEGER NOT NULL DEFAULT 0,
      total_count INTEGER NOT NULL DEFAULT 0,
      prize_amount INTEGER NOT NULL,
      calculated_at TEXT NOT NULL,
      emailed_member_id TEXT,
      prize_paid INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      paid_by TEXT
    )`),
  ]);
  ready = true;
}

/** Opening and closing times (ms) for a match. */
export function predictionWindow(match) {
  const scheduled = new Date(match.event_date).getTime();
  const opensAt = scheduled - PREDICTION_OPENS_HOURS_BEFORE * 3600_000;
  // Staff pressing Start Match early closes predictions at that moment.
  const kicked = match.kickoff_at ? new Date(match.kickoff_at).getTime() : Infinity;
  const closesAt = PREDICTION_CLOSES_AT === 'fulltime' ? Infinity : Math.min(scheduled, kicked);
  return { opensAt, closesAt };
}

/** 'off' | 'notyet' | 'open' | 'closed' | 'result' for a match at server time `now`. */
export function predictState(match, hasResult, now = Date.now()) {
  if (match.status === 'postponed' || match.status === 'cancelled') return 'off';
  if (match.status === 'full-time') return hasResult ? 'result' : 'closed';
  const { opensAt, closesAt } = predictionWindow(match);
  if (PREDICTION_CLOSES_AT !== 'fulltime' && (LIVE_STATUSES.includes(match.status) || now >= closesAt)) return 'closed';
  if (now < opensAt) return 'notyet';
  return 'open';
}

export function parseGoals(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= 0 && n <= MAX_GOALS ? n : null;
}

export async function countPredictions(db, eventId) {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM predictions WHERE event_id = ?`).bind(eventId).first()).n || 0;
}

/** Public winner label: "Terna A. – 0803****21". Never a full email or phone. */
export function publicName(member) {
  if (!member) return null;
  const name = [member.first_name, member.last_name ? `${String(member.last_name).trim().charAt(0)}.` : ''].filter(Boolean).join(' ');
  const phone = maskPhone(member.phone_e164 || '');
  return phone ? `${name} – ${phone}` : name;
}

/**
 * Works out (or re-works out) the winner for a match from its final score.
 * Safe to run again (e.g. after a disqualification or score correction).
 * Returns { winner (prediction row + member) | null, correct, total, changed }.
 */
export async function calculateWinner(db, eventId, home, away) {
  await ensurePredictSchema(db);
  const prev = await db.prepare(`SELECT * FROM prediction_results WHERE event_id = ?`).bind(eventId).first();
  const { results } = await db.prepare(
    `SELECT p.*, m.first_name, m.last_name, m.email, m.phone_e164, COALESCE(m.is_staff, 0) AS is_staff, m.id AS mid
     FROM predictions p LEFT JOIN members m ON m.id = p.member_id
     WHERE p.event_id = ? ORDER BY p.created_at ASC, p.id ASC`
  ).bind(eventId).all();
  const correct = results.filter(p => !p.disqualified && p.home_goals === home && p.away_goals === away);
  // Club staff/players and erased accounts can't win.
  const winner = correct.find(p => !p.is_staff && p.mid) || null;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE predictions SET is_winner = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE event_id = ?`).bind(winner?.id ?? -1, eventId),
    db.prepare(
      `INSERT INTO prediction_results (event_id, home_score, away_score, winner_prediction_id, winner_member_id, correct_count, total_count, prize_amount, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (event_id) DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score,
         winner_prediction_id = excluded.winner_prediction_id, winner_member_id = excluded.winner_member_id,
         correct_count = excluded.correct_count, total_count = excluded.total_count, calculated_at = excluded.calculated_at,
         prize_paid = CASE WHEN prediction_results.winner_member_id IS excluded.winner_member_id THEN prediction_results.prize_paid ELSE 0 END,
         paid_at = CASE WHEN prediction_results.winner_member_id IS excluded.winner_member_id THEN prediction_results.paid_at ELSE NULL END,
         paid_by = CASE WHEN prediction_results.winner_member_id IS excluded.winner_member_id THEN prediction_results.paid_by ELSE NULL END`
    ).bind(eventId, home, away, winner?.id ?? null, winner?.member_id ?? null, correct.length, results.length, prev?.prize_amount ?? PRIZE_AMOUNT, now),
  ]);
  return { winner, correct: correct.length, total: results.length, emailedMemberId: prev?.emailed_member_id || null };
}

export async function markWinnerEmailed(db, eventId, memberId) {
  await db.prepare(`UPDATE prediction_results SET emailed_member_id = ? WHERE event_id = ?`).bind(memberId, eventId).run();
}

/**
 * Called whenever staff enter or change a home game's final score (and after
 * a disqualification): recalculates the winner and emails a NEW winner once.
 */
export async function settlePredictions(env, match) {
  if (match.home_score === null || match.home_score === undefined || match.away_score === null || match.away_score === undefined) return null;
  const r = await calculateWinner(env.DB, match.id, match.home_score, match.away_score);
  // Only recorded as emailed when an email service is configured (RESEND_API_KEY).
  if (r.winner && env.RESEND_API_KEY && r.emailedMemberId !== r.winner.member_id && r.winner.email) {
    try {
      await sendPrizeWinnerEmail(env, r.winner, match, r.winner);
      await markWinnerEmailed(env.DB, match.id, r.winner.member_id);
    } catch (err) { console.error('[predict] winner email failed', err); }
  }
  return r;
}
