import { aiGuard, json } from '../../_lib/aiApi.js';
import { listHistory } from '../../_lib/aiFix.js';

// GET /api/admin/ai/history?action=&fixType=&who=&from=YYYY-MM-DD&to=YYYY-MM-DD&q=
// Fix history: every step of every AI fix (prepared, edited, applied, undone,
// verified, failed…) and every AI email.
export async function onRequestGet({ request, env }) {
  const { denied } = await aiGuard(request, env);
  if (denied) return denied;
  const u = new URL(request.url), p = k => String(u.searchParams.get(k) || '').slice(0, 100);
  return json(await listHistory(env, { action: p('action'), fixType: p('fixType'), who: p('who'), from: p('from'), to: p('to'), q: p('q') }));
}
