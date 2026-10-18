// /admin/news-approvals.json -- built with the site; served only to signed-in
// staff who can approve (the admin login protects /admin). Lists the articles that
// need a Super Admin's approval before they appear (Settings › Approvals).
import { getAllNews, newsApprovals, needsApproval, isApproved, articleHash } from '../../lib/news';

export async function GET() {
  const ap = await newsApprovals();
  const articles = (await getAllNews()).filter(a => a.data.status !== 'draft' && needsApproval(a, ap)).map(a => ({
    slug: a.id, title: a.data.title, summary: a.data.summary || '', author: a.data.author || '', official: !!a.data.official,
    publishedAt: a.data.publishedAt.toISOString(), hash: articleHash(a), needsApproval: true, approvedInBuild: isApproved(a, ap),
  }));
  return new Response(JSON.stringify({ builtAt: new Date().toISOString(), enforce: ap.enforce, articles }), { headers: { 'Content-Type': 'application/json' } });
}
