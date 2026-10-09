import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { loadMatch, toPublic } from '../../_lib/matchCentre.js';
import { ensureFanSchema } from '../../_lib/fans.js';
import { ensurePredictSchema, predictState, predictionWindow, settlePredictions } from '../../_lib/predict.js';
import { maskEmail, maskPhone, watTime } from '../../_lib/fanQuery.js';
import { buildCsv } from '../../_lib/xlsx.js';

async function load(env, id) {
  const m = await loadMatch(env.DB, id);
  if (!m) return null;
  await ensureFanSchema(env.DB);
  await ensurePredictSchema(env.DB);
  return toPublic(m.event, m.centre);
}

async function entries(env, eventId) {
  const { results } = await env.DB.prepare(
    `SELECT p.*, m.first_name, m.last_name, m.email, m.phone_e164, COALESCE(m.is_staff, 0) AS is_staff
     FROM predictions p LEFT JOIN members m ON m.id = p.member_id
     WHERE p.event_id = ? ORDER BY p.created_at ASC, p.id ASC`
  ).bind(eventId).all();
  return results;
}

// GET /api/admin/predictions/:eventId[?format=csv] -- every prediction for a
// home game (earliest first), the result and the prize-paid status.
export async function onRequestGet({ request, env, params }) {
  const csv = new URL(request.url).searchParams.get('format') === 'csv';
  const { admin, denied } = await requireAdminUser(request, env, { needExport: csv });
  if (denied) return denied;
  const match = await load(env, params.id);
  if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
  const rows = await entries(env, match.id);
  const result = await env.DB.prepare(`SELECT * FROM prediction_results WHERE event_id = ?`).bind(match.id).first();
  const correct = p => result && p.home_goals === result.home_score && p.away_goals === result.away_score;
  const name = p => [p.first_name, p.last_name].filter(Boolean).join(' ') || '(deleted account)';

  if (csv) {
    await logAdminAction(env.DB, admin, 'export_predictions_csv', `${match.home_team} vs ${match.away_team}`);
    const body = buildCsv(
      ['Submitted (WAT to the millisecond)', 'Name', 'Email', 'Phone', 'Prediction', 'Correct', 'Winner', 'Club staff/player', 'Disqualified', 'Reason'],
      rows.map(p => [`${watTime(p.created_at)}:${p.created_at.slice(17, 23)}`, name(p), p.email || '', p.phone_e164 || '', `${p.home_goals}-${p.away_goals}`,
        correct(p) ? 'Y' : 'N', p.is_winner ? 'Y' : 'N', p.is_staff ? 'Y' : 'N', p.disqualified ? 'Y' : 'N', p.dq_reason || '']));
    return new Response(body, { headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="predictions-${match.slug}.csv"`,
    } });
  }

  const winner = rows.find(p => p.is_winner);
  const { opensAt, closesAt } = predictionWindow(match);
  return Response.json({
    match: { id: match.id, slug: match.slug, home_team: match.home_team, away_team: match.away_team, event_date: match.event_date, status: match.status, is_home: match.is_home },
    state: predictState(match, !!result),
    opensAt: new Date(opensAt).toISOString(), closesAt: Number.isFinite(closesAt) ? new Date(closesAt).toISOString() : null,
    canExport: admin.canExport,
    result: result ? {
      home: result.home_score, away: result.away_score, correct: result.correct_count, total: result.total_count, prize: result.prize_amount,
      paid: !!result.prize_paid, paidAt: result.paid_at, paidBy: result.paid_by, emailed: !!result.emailed_member_id && result.emailed_member_id === result.winner_member_id,
      // Staff need the winner's details to arrange the prize.
      winner: winner ? { predictionId: winner.id, name: name(winner), email: winner.email, phone: winner.phone_e164, at: winner.created_at, prediction: `${winner.home_goals}-${winner.away_goals}` } : null,
    } : null,
    entries: rows.map(p => ({
      id: p.id, memberId: p.member_id, name: name(p),
      email: admin.canExport ? p.email || '' : maskEmail(p.email), phone: admin.canExport ? p.phone_e164 || '' : maskPhone(p.phone_e164),
      home: p.home_goals, away: p.away_goals, at: p.created_at, correct: !!correct(p), winner: !!p.is_winner,
      staff: !!p.is_staff, disqualified: !!p.disqualified, reason: p.dq_reason || '', dqBy: p.dq_by || '',
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST /api/admin/predictions/:eventId
//   { action: 'disqualify', predictionId, reason } / { action: 'reinstate', predictionId }
//   { action: 'paid', paid: true|false } / { action: 'staff', memberId, isStaff: true|false }
// Disqualifying, reinstating or flagging staff recalculates the winner.
export async function onRequestPost({ request, env, params }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const match = await load(env, params.id);
  if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const db = env.DB;
  const label = `${match.home_team} vs ${match.away_team}`;
  const now = new Date().toISOString();
  const entry = async () => db.prepare(`SELECT * FROM predictions WHERE id = ? AND event_id = ?`).bind(Number(b.predictionId) || 0, match.id).first();

  if (b.action === 'disqualify') {
    const p = await entry();
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
    if (!p) return Response.json({ error: 'Prediction not found' }, { status: 404 });
    if (!reason) return Response.json({ error: 'Please give a reason for the disqualification.' }, { status: 400 });
    await db.prepare(`UPDATE predictions SET disqualified = 1, dq_reason = ?, dq_by = ?, dq_at = ? WHERE id = ?`).bind(reason, admin.name, now, p.id).run();
    await logAdminAction(db, admin, 'prediction_disqualified', `${label}: entry ${p.id} (${reason})`);
  } else if (b.action === 'reinstate') {
    const p = await entry();
    if (!p) return Response.json({ error: 'Prediction not found' }, { status: 404 });
    await db.prepare(`UPDATE predictions SET disqualified = 0, dq_reason = NULL, dq_by = NULL, dq_at = NULL WHERE id = ?`).bind(p.id).run();
    await logAdminAction(db, admin, 'prediction_reinstated', `${label}: entry ${p.id}`);
  } else if (b.action === 'staff') {
    const memberId = String(b.memberId || '');
    const ok = await db.prepare(`SELECT 1 FROM predictions WHERE event_id = ? AND member_id = ?`).bind(match.id, memberId).first();
    if (!ok) return Response.json({ error: 'Account not found in this match.' }, { status: 404 });
    await db.prepare(`UPDATE members SET is_staff = ? WHERE id = ?`).bind(b.isStaff ? 1 : 0, memberId).run();
    await logAdminAction(db, admin, 'member_staff_flag', `${memberId} -> ${b.isStaff ? 'club staff/player' : 'fan'}`);
  } else if (b.action === 'paid') {
    const r = await db.prepare(`SELECT * FROM prediction_results WHERE event_id = ?`).bind(match.id).first();
    if (!r?.winner_member_id) return Response.json({ error: 'There is no winner for this match.' }, { status: 409 });
    await db.prepare(`UPDATE prediction_results SET prize_paid = ?, paid_at = ?, paid_by = ? WHERE event_id = ?`)
      .bind(b.paid ? 1 : 0, b.paid ? now : null, b.paid ? admin.name : null, match.id).run();
    await logAdminAction(db, admin, b.paid ? 'prize_paid' : 'prize_unpaid', label);
    return Response.json({ ok: true });
  } else {
    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  }

  const settled = match.status === 'full-time' ? await settlePredictions(env, match) : null;
  return Response.json({ ok: true, winnerChanged: !!settled });
}
