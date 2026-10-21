import { scoresGuard, json } from '../../_lib/scores/api.js';
import { listSources, getSource, SOURCE_TYPES, assertAdapterMayRun } from '../../_lib/scores/model.js';
import { logAdminAction } from '../../_lib/adminSession.js';

// Admin › League › Score Sources.
// GET                         -- every source: on/off, priority, description, licence, last data
// PUT { type, enabled, priority, description, licenceConfirmed, licenceNote }
//                             -- licence settings: Super Admins only
// POST { action: 'coverage_test', type: 'LICENSED_API' }
//                             -- do our conference fixtures exist in the licensed API? (needs the key)
export async function onRequestGet({ request, env }) {
  const { denied, superAdmin } = await scoresGuard(request, env);
  if (denied) return denied;
  const sources = await listSources(env);
  return json({ sources, me: { superAdmin }, keys: { LICENSED_API: !!env.LICENSED_API_KEY } });
}

export async function onRequestPut({ request, env }) {
  const { admin, superAdmin, denied } = await scoresGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const def = SOURCE_TYPES[b.type];
  if (!def) return json({ error: 'Unknown source.' }, 400);
  const cur = await getSource(env, b.type);
  const next = {
    enabled: b.enabled === undefined ? !!cur.enabled : !!b.enabled,
    priority: b.priority === undefined ? cur.priority : Number(b.priority),
    description: b.description === undefined ? cur.description : String(b.description || '').trim().slice(0, 500),
    licence_confirmed: b.licenceConfirmed === undefined ? !!cur.licence_confirmed : !!b.licenceConfirmed,
    licence_note: b.licenceNote === undefined ? cur.licence_note : String(b.licenceNote || '').trim().slice(0, 1000),
  };
  if (!Number.isInteger(next.priority) || next.priority < 0 || next.priority > 100) return json({ error: 'Priority: a whole number from 0 to 100.' }, 400);
  const licenceChanged = next.licence_confirmed !== !!cur.licence_confirmed || (next.licence_note || '') !== (cur.licence_note || '');
  if (licenceChanged && !superAdmin) return json({ error: 'Only Super Admins can confirm a licence or permission.' }, 403);
  if (next.licence_confirmed && (next.licence_note || '').length < 10) return json({ error: 'Write down the licence or written permission (who gave it, when, reference) before confirming it.' }, 400);
  if (next.enabled && def.needsLicence) {
    try { assertAdapterMayRun({ type: b.type, ...next }); } catch (err) { return json({ error: err.message }, 400); }
  }
  await env.DB.prepare(`UPDATE score_sources SET enabled = ?, priority = ?, description = ?, licence_confirmed = ?, licence_note = ?, updated_at = ?, updated_by = ? WHERE type = ?`)
    .bind(next.enabled ? 1 : 0, next.priority, next.description, next.licence_confirmed ? 1 : 0, next.licence_note || null, new Date().toISOString(), admin.name, b.type).run();
  await logAdminAction(env.DB, admin, 'score_source', `${def.label}: ${next.enabled ? 'on' : 'off'}, priority ${next.priority}${licenceChanged ? `, licence ${next.licence_confirmed ? 'confirmed' : 'not confirmed'}` : ''}`);
  return json({ ok: true, sources: await listSources(env) });
}

export async function onRequestPost({ request, env }) {
  const { denied } = await scoresGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  if (b.action !== 'coverage_test' || b.type !== 'LICENSED_API') return json({ error: 'Unknown action' }, 400);
  const src = await getSource(env, 'LICENSED_API');
  try { assertAdapterMayRun(src); } catch (err) { return json({ ok: false, result: err.message }); }
  if (!env.LICENSED_API_KEY) return json({ ok: false, result: 'The API key is not set yet (LICENSED_API_KEY in Cloudflare). See HANDOVER-TODO.md.' });
  const { results } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM league_fixtures f JOIN league_competitions c ON c.id = f.competition_id WHERE c.is_current = 1`).all();
  // The provider-specific check is added with the provider (Phase 6) once one is chosen.
  return json({ ok: false, result: `Key found. ${results[0]?.n || 0} conference fixtures to look for. The provider (API-Football or Sportmonks) still has to be chosen; the coverage check is added with it.` });
}
