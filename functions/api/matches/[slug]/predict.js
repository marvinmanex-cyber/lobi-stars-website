import { findHomeMatch, currentFan } from '../../_lib/matchdayFan.js';
import { rateLimit, tooMany, clientIp } from '../../_lib/fans.js';
import { ensurePredictSchema, predictState, predictionWindow, parseGoals, countPredictions, publicName } from '../../_lib/predict.js';
import { PRIZE_AMOUNT, MAX_GOALS, CLAIM_INSTRUCTIONS } from '../../_lib/predictSettings.js';
import { recordServerEvent } from '../../_lib/analytics.js';

const noStore = { 'Cache-Control': 'no-store' };
const notHome = () => Response.json({ error: 'Predict & Win is only for Lobi Stars home games.' }, { status: 404 });

// GET /api/matches/:slug/predict -- window, the fan's own prediction, how
// many fans have predicted and (after full time) the result. Other fans'
// predictions are never shown.
export async function onRequestGet({ request, env, params }) {
  const match = await findHomeMatch(env, params.slug);
  if (!match) return notHome();
  await ensurePredictSchema(env.DB);
  const result = await env.DB.prepare(`SELECT * FROM prediction_results WHERE event_id = ?`).bind(match.id).first();
  const state = predictState(match, !!result);
  const { opensAt, closesAt } = predictionWindow(match);
  const fan = await currentFan(request, env);
  const mine = fan ? await env.DB.prepare(`SELECT * FROM predictions WHERE event_id = ? AND member_id = ?`).bind(match.id, fan.id).first() : null;

  let outcome = null;
  if (state === 'result') {
    const w = result.winner_member_id
      ? await env.DB.prepare(`SELECT first_name, last_name, phone_e164 FROM members WHERE id = ?`).bind(result.winner_member_id).first()
      : null;
    outcome = {
      home: result.home_score, away: result.away_score,
      winner: w ? publicName(w) : null,
      correct: result.correct_count, total: result.total_count, prize: result.prize_amount,
      youWon: !!(mine && mine.is_winner),
      claim: mine && mine.is_winner ? CLAIM_INSTRUCTIONS : null,
    };
  }
  return Response.json({
    state, prize: PRIZE_AMOUNT, maxGoals: MAX_GOALS,
    opensAt: new Date(opensAt).toISOString(),
    closesAt: Number.isFinite(closesAt) ? new Date(closesAt).toISOString() : null,
    count: await countPredictions(env.DB, match.id),
    fan: fan ? { firstName: fan.first_name, verified: !!fan.email_verified } : null,
    mine: mine ? { home: mine.home_goals, away: mine.away_goals, at: mine.created_at, disqualified: !!mine.disqualified } : null,
    result: outcome,
    serverTime: new Date().toISOString(),
  }, { headers: noStore });
}

// POST /api/matches/:slug/predict { home, away } -- the fan's one prediction.
export async function onRequestPost({ request, env, params }) {
  const match = await findHomeMatch(env, params.slug);
  if (!match) return notHome();
  const fan = await currentFan(request, env);
  if (!fan) return Response.json({ error: 'Please log in to play Predict & Win.', code: 'login' }, { status: 401 });
  if (!fan.email_verified) return Response.json({ error: 'Please confirm your email address before predicting.', code: 'unverified' }, { status: 403 });
  if (!(await rateLimit(env.DB, `predict:${fan.id}:${clientIp(request)}`, 20, 600))) return tooMany();

  await ensurePredictSchema(env.DB);
  // Server clock only: the time is taken here, before anything else.
  const now = Date.now();
  const state = predictState(match, false, now);
  if (state === 'notyet') return Response.json({ error: 'Predictions for this match are not open yet.', code: 'notyet', opensAt: new Date(predictionWindow(match).opensAt).toISOString() }, { status: 409 });
  if (state !== 'open') return Response.json({ error: 'Predictions for this match have closed.', code: 'closed' }, { status: 409 });

  let b;
  try { b = await request.json(); } catch { b = {}; }
  const home = parseGoals(b.home), away = parseGoals(b.away);
  if (home === null || away === null) return Response.json({ error: `Please enter a score from 0 to ${MAX_GOALS} for both teams.` }, { status: 400 });

  const at = new Date(now).toISOString();
  // UNIQUE (event_id, member_id) makes sure there is only ever one entry per fan.
  const res = await env.DB.prepare(
    `INSERT INTO predictions (event_id, member_id, home_goals, away_goals, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (event_id, member_id) DO NOTHING`
  ).bind(match.id, fan.id, home, away, at).run();
  if (!res.meta?.changes) {
    const mine = await env.DB.prepare(`SELECT home_goals, away_goals FROM predictions WHERE event_id = ? AND member_id = ?`).bind(match.id, fan.id).first();
    return Response.json({ error: `You have already predicted ${mine.home_goals} – ${mine.away_goals} for this match. Predictions can't be changed.`, code: 'predicted' }, { status: 409 });
  }
  await recordServerEvent(env, 'prediction_submit', match.slug, request);
  return Response.json({ ok: true, mine: { home, away, at }, count: await countPredictions(env.DB, match.id) }, { headers: noStore });
}
