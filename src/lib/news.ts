import { getCollection, type CollectionEntry } from 'astro:content';
import { createHash } from 'node:crypto';

export * from './newsUtils';

export type Article = CollectionEntry<'news'>;

/** Published news, newest first. Drafts are never shown on the public site, and
 *  official statements (or every article, if the club switches that on) only once a
 *  Super Admin has approved that exact wording. */
export async function getSortedNews(): Promise<Article[]> {
  const ap = await newsApprovals();
  return (await getAllNews()).filter(a => a.data.status !== 'draft' && (!needsApproval(a, ap) || isApproved(a, ap)));
}

// ── Approvals (Admin › Settings › Approvals) ──

type Approvals = { enforce: { official: boolean; all: boolean }; approved: { slug: string; hash: string }[] };
let approvalsPromise: Promise<Approvals> | null = null;
/** Read once per build from the live site. If it can't be reached, official statements stay hidden (safe). */
export function newsApprovals(): Promise<Approvals> {
  if (!approvalsPromise) approvalsPromise = (async () => {
    const fallback: Approvals = { enforce: { official: true, all: false }, approved: [] };
    if (process.env.NEWS_APPROVALS === 'off') return { enforce: { official: false, all: false }, approved: [] };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(process.env.NEWS_APPROVALS_URL || 'https://lobistarsfc.com/api/news-approvals', { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const d = await res.json();
      return { enforce: { official: d.enforce?.official !== false, all: !!d.enforce?.all }, approved: Array.isArray(d.approved) ? d.approved : [] };
    } catch (err) {
      console.warn(`[news] approvals could not be read (${(err as Error).message}); official statements stay hidden`);
      return fallback;
    }
  })();
  return approvalsPromise;
}
/** A fingerprint of the wording: an edit after approval needs approving again. */
export const articleHash = (a: Article) => createHash('sha256').update(`${a.data.title}\n${a.data.summary || ''}\n${a.body || ''}`).digest('hex').slice(0, 20);
export const needsApproval = (a: Article, ap: Approvals) => ap.enforce.all || (!!a.data.official && ap.enforce.official);
export const isApproved = (a: Article, ap: Approvals) => ap.approved.some(x => x.slug === a.id && x.hash === articleHash(a));

/** Every story including drafts, newest first (admin only). */
export async function getAllNews(): Promise<Article[]> {
  return (await getCollection('news')).sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf()
  );
}
