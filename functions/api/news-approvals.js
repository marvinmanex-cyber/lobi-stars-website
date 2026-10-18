import { approvedStatements, approvalSwitches, ensureApprovalsSchema } from './_lib/approvals.js';

// GET /api/news-approvals -- read by the website build: which official statements
// (article + exact wording) a Super Admin has approved, and whether official
// statements / all articles need approval. Only approved articles are listed
// (their titles are public anyway once published).
export async function onRequestGet({ env }) {
  await ensureApprovalsSchema(env.DB);
  const sw = await approvalSwitches(env.DB);
  const approved = (await approvedStatements(env.DB)).map(a => ({ slug: a.slug, hash: a.hash }));
  return Response.json({ enforce: { official: sw.approvals_official, all: sw.approvals_all_news }, approved }, { headers: { 'Cache-Control': 'no-store' } });
}
