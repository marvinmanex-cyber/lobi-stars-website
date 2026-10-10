import { getCollection, type CollectionEntry } from 'astro:content';

export * from './newsUtils';

export type Article = CollectionEntry<'news'>;

/** All articles, newest first. */
/**
 * All news, newest first. Sample stories (isSample) are only shown until the
 * first real story is published; after that they disappear everywhere
 * automatically (their pages are no longer built).
 */
export async function getSortedNews(): Promise<Article[]> {
  const all = await getCollection('news');
  const real = all.filter(a => !a.data.isSample);
  return (real.length ? real : all).sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf()
  );
}
