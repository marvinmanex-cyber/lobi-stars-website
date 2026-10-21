import { scoresGuard, json } from '../../_lib/scores/api.js';
import { listSubmitters, createSubmitter, renewSubmitter, revokeSubmitter } from '../../_lib/scores/submitters.js';
import { loadTeams } from '../../_lib/scores/model.js';

// Admin › Matchday › Club Network Submitters (Website & Data Officer, Super Admins).
// GET                                   -- submitters with submissions, accuracy, recent reports; the teams
// POST { action: 'add', name, club, teamId, phone, email, note }  -- returns their link and PIN ONCE
// POST { action: 'renew', id }          -- new link and PIN (old ones stop working)
// POST { action: 'revoke', id }
export async function onRequestGet({ request, env }) {
  const { denied } = await scoresGuard(request, env);
  if (denied) return denied;
  const teams = (await loadTeams(env)).map(t => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name));
  return json({ submitters: await listSubmitters(env), teams });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await scoresGuard(request, env, { write: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  let r;
  if (b.action === 'add') r = await createSubmitter(env, admin, b);
  else if (b.action === 'renew') r = await renewSubmitter(env, admin, b.id);
  else if (b.action === 'revoke') r = await revokeSubmitter(env, admin, b.id);
  else return json({ error: 'Unknown action' }, 400);
  if (r.error) return json(r, 400);
  if (r.token) r.link = `${String(env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, '')}/scores/submit/?t=${r.token}`;
  return json(r);
}
