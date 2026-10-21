import { scoresGuard, json } from '../../_lib/scores/api.js';
import { matchdayView, staffEntry, officialResult, verifiedResult, withdrawDecision } from '../../_lib/scores/matchday.js';

// Admin › Matchday › Other Games (Website & Data Officer, Super Admins).
// GET ?round=<n>                                         -- every match of the round as a card
// POST { action: 'entry', fixtureId, homeGoals, awayGoals, status, minute }   -- quick staff report
// POST { action: 'official', fixtureId, homeGoals, awayGoals, status, note }  -- official NNL result
// POST { action: 'verify', fixtureId, homeGoals, awayGoals, status, reason }  -- verified result (overrides all sources)
// POST { action: 'withdraw', decisionId, reason }
export async function onRequestGet({ request, env }) {
  const { denied } = await scoresGuard(request, env);
  if (denied) return denied;
  const r = await matchdayView(env, { round: new URL(request.url).searchParams.get('round') });
  return r.error ? json(r, 404) : json(r);
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await scoresGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  let r;
  try {
    if (b.action === 'entry') r = await staffEntry(env, admin, b);
    else if (b.action === 'official') r = await officialResult(env, admin, b);
    else if (b.action === 'verify') r = await verifiedResult(env, admin, b);
    else if (b.action === 'withdraw') r = await withdrawDecision(env, admin, b.decisionId, b.reason);
    else return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[scores] matchday', err);
    return json({ error: 'Something went wrong; nothing was saved.' }, 500);
  }
  return r.error ? json(r, 400) : json(r);
}
