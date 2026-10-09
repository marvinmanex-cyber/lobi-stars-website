import { requireAdmin } from '../../_lib/adminEvents.js';
import { parseStreams } from '../../_lib/streams.js';
import { settlePredictions } from '../../_lib/predict.js';
import { notifyFans } from '../../_lib/notify.js';
import { loadMatch, toPublic, parseCentrePayload, parseSquad, scoreInt, isHomeGame, LIVE_STATUSES } from '../../_lib/matchCentre.js';

async function roster(request, env) {
  try {
    const res = await env.ASSETS.fetch(new URL('/data/players.json', request.url));
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

// GET /api/admin/match-centre/:id -- the match plus its Match Centre data.
export async function onRequestGet({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const m = await loadMatch(env.DB, params.id);
  if (!m) return Response.json({ error: 'Match not found' }, { status: 404 });
  return Response.json({
    match: {
      ...toPublic(m.event, m.centre), auto_closed: !!m.centre?.auto_closed,
      youtube_url: m.centre?.youtube_url || '', facebook_url: m.centre?.facebook_url || '',
    },
    serverTime: new Date().toISOString(),
  });
}

// PUT /api/admin/match-centre/:id -- save status, score, preview, line-ups,
// timeline, report, stats, gallery and the matchday squad.
export async function onRequestPut({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const m = await loadMatch(env.DB, params.id);
  if (!m) return Response.json({ error: 'Match not found' }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { value: v } = parseCentrePayload(body);
  const streams = parseStreams(body);
  if (streams.error) return Response.json({ error: streams.error }, { status: 400 });
  // Stream links only apply to home games.
  const s = isHomeGame(m.event) ? streams.value : { youtube_url: null, facebook_url: null };
  const squad = parseSquad(body.squad, await roster(request, env));

  // Keep the recorded kick-off / end times consistent with a status chosen
  // from the dropdown (the big Kick-off / Full-time buttons are preferred).
  const now = new Date().toISOString();
  const prev = m.centre || {};
  const kickoffAt = LIVE_STATUSES.includes(v.status) || v.status === 'full-time' ? (prev.kickoff_at || now) : (v.status === 'scheduled' ? null : prev.kickoff_at || null);
  const endedAt = v.status === 'full-time' ? (prev.ended_at || now) : null;

  await env.DB.prepare(
    `INSERT INTO match_centre
       (event_id, status, home_score, away_score, preview, report, lineups_json, timeline_json, stats_json, gallery_json,
        squad_json, kickoff_at, ended_at, youtube_url, facebook_url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(event_id) DO UPDATE SET
       status = excluded.status, home_score = excluded.home_score, away_score = excluded.away_score,
       preview = excluded.preview, report = excluded.report, lineups_json = excluded.lineups_json,
       timeline_json = excluded.timeline_json, stats_json = excluded.stats_json,
       gallery_json = excluded.gallery_json, squad_json = excluded.squad_json,
       kickoff_at = excluded.kickoff_at, ended_at = excluded.ended_at,
       youtube_url = excluded.youtube_url, facebook_url = excluded.facebook_url,
       auto_closed = CASE WHEN excluded.status = 'full-time' THEN match_centre.auto_closed ELSE 0 END,
       updated_at = excluded.updated_at`
  ).bind(
    params.id, v.status, v.home_score, v.away_score, v.preview, v.report,
    v.lineups_json, v.timeline_json, v.stats_json, v.gallery_json, JSON.stringify(squad), kickoffAt, endedAt, s.youtube_url, s.facebook_url
  ).run();

  // A corrected final score recalculates the Predict & Win winner.
  if (v.status === 'full-time' && isHomeGame(m.event)) await settlePredictions(env, { ...toPublic(m.event, m.centre), home_score: v.home_score, away_score: v.away_score });
  return Response.json({ ok: true, squad });
}

// POST /api/admin/match-centre/:id { action: 'kickoff' } or
// { action: 'fulltime', home_score, away_score } -- the big match-control
// buttons. Times are recorded from the server clock.
export async function onRequestPost({ request, env, params, waitUntil }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const m = await loadMatch(env.DB, params.id);
  if (!m) return Response.json({ error: 'Match not found' }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const now = new Date().toISOString();
  const status = m.centre?.status || 'scheduled';

  if (body.action === 'kickoff') {
    if (!isHomeGame(m.event)) return Response.json({ error: 'Kick-off control is only used for Lobi Stars home games.' }, { status: 400 });
    if (status === 'full-time') return Response.json({ error: 'This match has already finished.' }, { status: 409 });
    if (LIVE_STATUSES.includes(status)) return Response.json({ error: 'This match has already kicked off.' }, { status: 409 });
    await env.DB.prepare(
      `INSERT INTO match_centre (event_id, status, kickoff_at, updated_at) VALUES (?, 'live', ?, datetime('now'))
       ON CONFLICT(event_id) DO UPDATE SET status = 'live', kickoff_at = excluded.kickoff_at, ended_at = NULL,
         auto_closed = 0, updated_at = excluded.updated_at`
    ).bind(params.id, now).run();
    // "Kick-off! Vote for Man of the Match" reminder for fans who opted in.
    waitUntil(notifyFans(env, m.event, 'kickoff'));
    return Response.json({ ok: true, status: 'live', kickoff_at: now });
  }

  if (body.action === 'fulltime') {
    const home = scoreInt(body.home_score), away = scoreInt(body.away_score);
    if (home === null || away === null) return Response.json({ error: 'Please enter the final score for both teams.' }, { status: 400 });
    if (!m.centre?.kickoff_at && status === 'scheduled') {
      return Response.json({ error: 'Press "Start Match" at kick-off before ending the match.' }, { status: 409 });
    }
    // Keep the original end time if the match auto-closed; staff are just adding the score.
    const endedAt = status === 'full-time' && m.centre?.ended_at ? m.centre.ended_at : now;
    await env.DB.prepare(
      `UPDATE match_centre SET status = 'full-time', home_score = ?, away_score = ?, ended_at = ?, updated_at = datetime('now')
       WHERE event_id = ?`
    ).bind(home, away, endedAt, params.id).run();
    // Predict & Win: the winner is worked out as soon as the final score is in.
    const prediction = isHomeGame(m.event) ? await settlePredictions(env, { ...toPublic(m.event, m.centre), home_score: home, away_score: away }) : null;
    return Response.json({ ok: true, status: 'full-time', ended_at: endedAt, home_score: home, away_score: away, predictionWinner: !!prediction?.winner, correctPredictions: prediction?.correct ?? 0 });
  }

  return Response.json({ error: 'Unknown action.' }, { status: 400 });
}
