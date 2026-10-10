import { getCollection, type CollectionEntry } from 'astro:content';

export type Player = CollectionEntry<'players'>;

/**
 * Squad players shown on the public site. The starter "sample" players are
 * never shown publicly (squad page, profiles, search); they only exist so
 * staff can see how things look in the admin.
 */
export async function getPlayers(): Promise<Player[]> {
  return (await getCollection('players')).filter(p => !p.data.isSample);
}

/** Every player including samples (admin screens and /data/players.json, which marks samples). */
export async function getRoster(): Promise<Player[]> {
  return getCollection('players');
}
