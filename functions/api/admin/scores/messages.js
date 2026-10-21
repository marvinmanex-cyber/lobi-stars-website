import { scoresGuard, json } from '../../_lib/scores/api.js';
import { ingestMessage, listMessages, approveReport, rejectReport, closeMessage } from '../../_lib/scores/extract.js';

// Admin › Matchday › Score Messages (Website & Data Officer, Super Admins).
// GET                                              -- recent messages, reports waiting for review, the matches and submitters
// POST { action: 'paste', text, from: 'submitter:<id>' | 'commentary' | 'other', fromName }  -- a WhatsApp message staff copy in
// POST { action: 'approve', reportId, fixtureId? } -- a person decides; the report then counts
// POST { action: 'reject', reportId, reason }
// POST { action: 'close', messageId, note }        -- a message with no usable score
export async function onRequestGet({ request, env }) {
  const { denied } = await scoresGuard(request, env);
  if (denied) return denied;
  const db = env.DB;
  const data = await listMessages(env);
  const fixtures = (await db.prepare(`SELECT f.id, f.matchday, f.kickoff_at, h.name AS home, a.name AS away FROM league_fixtures f JOIN league_teams h ON h.id = f.home_team_id
    JOIN league_teams a ON a.id = f.away_team_id JOIN league_competitions c ON c.id = f.competition_id WHERE c.is_current = 1 ORDER BY f.kickoff_at, f.match_no`).all()).results;
  const submitters = (await db.prepare(`SELECT id, name, club FROM score_submitters WHERE active = 1 ORDER BY club, name`).all()).results;
  return json({ ...data, fixtures, submitters });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await scoresGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  let r;
  try {
    if (b.action === 'paste') {
      const from = String(b.from || '');
      const as = from.startsWith('submitter:') ? { submitterId: Number(from.slice(10)) } : from === 'commentary' ? { commentary: true } : { name: String(b.fromName || '').trim().slice(0, 80) || 'someone else' };
      r = await ingestMessage(env, { channel: 'WHATSAPP', text: b.text, fromName: as.name || '', as, enteredBy: admin.name });
    } else if (b.action === 'approve') r = await approveReport(env, admin, b);
    else if (b.action === 'reject') r = await rejectReport(env, admin, b);
    else if (b.action === 'close') r = await closeMessage(env, admin, b);
    else return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[scores] messages', err);
    return json({ error: 'Something went wrong; nothing was saved.' }, 500);
  }
  return r.error ? json(r, 400) : json(r);
}
