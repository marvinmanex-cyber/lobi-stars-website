import { getCollection, type CollectionEntry } from 'astro:content';

export type Player = CollectionEntry<'players'>;

/**
 * Squad players for the site. Sample players (isSample) are only shown until
 * the first real player is added in the CMS; after that they disappear
 * everywhere automatically (squad pages, search, Man of the Match voting).
 */
export async function getPlayers(): Promise<Player[]> {
  const all = await getCollection('players');
  const real = all.filter(p => !p.data.isSample);
  return real.length ? real : all;
}
