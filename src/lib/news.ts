import { getCollection, type CollectionEntry } from 'astro:content';

export * from './newsUtils';

export type Article = CollectionEntry<'news'>;

/** All articles, newest first. */
export async function getSortedNews(): Promise<Article[]> {
  return (await getCollection('news')).sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf()
  );
}
