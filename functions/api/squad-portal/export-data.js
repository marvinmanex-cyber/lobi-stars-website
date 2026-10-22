import { requirePortal, portalJson, portalActor } from '../_lib/squadPortal.js';
import { exportData } from '../_lib/squadExportData.js';
import { logExport, logProfile } from '../_lib/squadProfiles.js';

// GET  /api/squad-portal/export-data?which=verified|submitted|players|staff&season=current|all
//      -- the profiles for a download (Public and Media fields only; private details never leave the server)
// POST /api/squad-portal/export-data { format, which, season, profiles, ok, note }  -- the export log
export async function onRequestGet({ request, env }) {
  const { denied } = await requirePortal(request, env);
  if (denied) return denied;
  const u = new URL(request.url);
  return portalJson(await exportData(env, { which: u.searchParams.get('which') || 'verified', season: u.searchParams.get('season') || 'current' }));
}
export async function onRequestPost({ request, env }) {
  const { session, denied } = await requirePortal(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const actor = portalActor(session);
  const format = String(b.format || '').slice(0, 20);
  await logExport(env.DB, { by: actor.name, place: 'portal', format, filters: { which: b.which, season: b.season }, profiles: b.profiles, ok: b.ok !== false, note: b.note ? String(b.note).slice(0, 300) : null });
  if (b.ok !== false) await logProfile(env.DB, actor, 'squad_export', `${actor.name} downloaded ${format === 'zip' ? 'the Media Partner Data Package' : `a ${format.toUpperCase()} export`} of ${Number(b.profiles) || 0} profile${Number(b.profiles) === 1 ? '' : 's'} (${b.which || 'verified'}, ${b.season === 'all' ? 'all seasons' : 'current season'})`);
  return portalJson({ ok: true });
}
