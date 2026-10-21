import { aiGuard, json } from '../../_lib/aiApi.js';
import { estimateProposal, createProposal, listProposals, proposalFile, emailProposal } from '../../_lib/codeProposal.js';

// AI Fix › Code proposals (Super Admins only; never changes the live website).
// GET                         -- the proposals made so far
// GET ?download=<id>          -- the proposal as a text file for a developer
// POST { action: 'estimate', recId, page }      -- which file and the estimated cost
// POST { action: 'propose', recId, page, note } -- ask Claude; saved on an ai-proposal/ branch (+ draft pull request)
// POST { action: 'email', id, to }              -- email the proposal to a developer
export async function onRequestGet({ request, env }) {
  const { denied } = await aiGuard(request, env, { superOnly: true });
  if (denied) return denied;
  const dl = new URL(request.url).searchParams.get('download');
  if (dl) {
    const f = await proposalFile(env, dl);
    if (!f) return json({ error: 'Not found' }, 404);
    return new Response(f.text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return json({ proposals: await listProposals(env) });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await aiGuard(request, env, { write: true, superOnly: true });
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const recId = String(b.recId || '').slice(0, 300), page = String(b.page || '').slice(0, 200);
  let r;
  try {
    if (b.action === 'estimate') r = await estimateProposal(env, recId, page);
    else if (b.action === 'propose') r = await createProposal(env, admin, { recId, page, note: b.note });
    else if (b.action === 'email') r = await emailProposal(env, admin, b.id, b.to);
    else return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[ai-code]', err);
    return json({ error: 'Something went wrong; nothing was changed.' }, 500);
  }
  return r.error ? json(r, 400) : json(r);
}
