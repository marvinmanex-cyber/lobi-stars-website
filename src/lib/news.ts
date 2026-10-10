import { getCollection, type CollectionEntry } from 'astro:content';

export * from './newsUtils';

export type Article = CollectionEntry<'news'>;

/** All articles, newest first. */
/** Published news, newest first. Drafts are never shown on the public site. */
export async function getSortedNews(): Promise<Article[]> {
  return (await getAllNews()).filter(a => a.data.status !== 'draft');
}

/** Every story including drafts, newest first (admin only). */
export async function getAllNews(): Promise<Article[]> {
  return (await getCollection('news')).sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf()
  );
}
