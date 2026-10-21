import { scoresGuard, json } from '../../_lib/scores/api.js';
import { addReport, reportsFor, latestPerSource, independenceKey, ensureScoreSchema } from '../../_lib/scores/model.js';
import { logAdminAction } from '../../_lib/adminSession.js';

// Score reports (Phase 1: the model; the matchday screen comes in Phase 2).
// GET ?fixture=<id>      -- every report for a match (newest first) and the latest per independent source
// GET ?review=1          -- reports waiting for review (unclear, name not recognised)
// POST { fixtureId | homeName + awayName, homeGoals, awayGoals, status, minute, official, note }
//                        -- a staff report (STAFF_MANUAL, or OFFICIAL_NNL with a required note)
export async function onRequestGet({ request, env }) {
  const { denied } = await scoresGuard(request, env);
  if (denied) return denied;
  const u = new URL(request.url);
  if (u.searchParams.get('review')) {
    await ensureScoreSchema(env);
    const { results } = await env.DB.prepare(`SELECT * FROM score_reports WHERE needs_review = 1 ORDER BY received_at DESC LIMIT 100`).all();
    return json({ reports: results });
  }
  const id = Number(u.searchParams.get('fixture'));
  if (!id) return json({ error: 'Choose a match.' }, 400);
  const reports = await reportsFor(env, id);
  const latest = latestPerSource(reports.filter(r => !r.needs_review));
  return json({ reports, latest: latest.map(r => ({ ...r, independent_as: independenceKey(r) })), independentSources: latest.length });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await scoresGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const official = b.official === true;
  const note = String(b.note || '').trim().slice(0, 300);
  if (official && note.length < 5) return json({ error: 'An official result needs a note of where it comes from (e.g. "NNL website result, 21 Oct").' }, 400);
  const r = await addReport(env, {
    sourceType: official ? 'OFFICIAL_NNL' : 'STAFF_MANUAL', identity: official ? `official:${admin.id}` : `staff:${admin.id}`, label: admin.name,
    fixtureId: b.fixtureId || null, homeName: b.homeName, awayName: b.awayName, homeGoals: b.homeGoals, awayGoals: b.awayGoals, status: b.status, minute: b.minute,
    raw: official ? { note, enteredBy: admin.name } : { enteredBy: admin.name }, confidenceNotes: official ? `Official: ${note}` : null, createdBy: admin.name,
  });
  if (r.error) return json(r, 400);
  await logAdminAction(env.DB, admin, official ? 'score_official' : 'score_report', `${official ? 'Official result' : 'Score report'} ${b.homeGoals ?? '-'}-${b.awayGoals ?? '-'} (${b.status}) for match ${r.fixtureId || '?'}${r.needsReview ? ` (needs review: ${r.reason})` : ''}`);
  return json(r);
}
