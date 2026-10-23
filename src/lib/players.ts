import { getCollection, type CollectionEntry } from 'astro:content';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Player = CollectionEntry<'players'>;
export type StaffMember = CollectionEntry<'staff'>;

const norm = (s: string) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Names marked "left the club" in the Squad & Staff Data Portal (written by scripts/fetch-squad.mjs). */
function leftNames(): Set<string> {
  // The build runs from the project folder (import.meta.url points into the bundle).
  try { return new Set((JSON.parse(readFileSync(join(process.cwd(), 'src/content/players/portal/_left.json'), 'utf8')) as string[]).map(norm)); }
  catch { return new Set(); }
}
/** Once the old hand-made squad files are switched off (Squad › Profile Submissions › Old squad files), only portal profiles show. */
function legacyOff(): boolean {
  try { return !!JSON.parse(readFileSync(join(process.cwd(), 'src/content/players/portal/_source.json'), 'utf8')).legacyOff; } catch { return false; }
}
/** A live portal profile replaces a hand-made entry with the same name; people who left are not shown. */
function merge<T extends { data: { name: string; portal?: boolean } }>(list: T[]): T[] {
  const portal = new Set(list.filter(e => e.data.portal).map(e => norm(e.data.name)));
  const left = leftNames(), off = legacyOff();
  return list.filter(e => (e.data.portal || (!off && !portal.has(norm(e.data.name)))) && !left.has(norm(e.data.name)));
}

/**
 * Squad players shown on the public site. The starter "sample" players are
 * never shown publicly (squad page, profiles, search); they only exist so
 * staff can see how things look in the admin. Verified profiles from the Squad
 * & Staff Data Portal are included (public details only).
 */
export async function getPlayers(): Promise<Player[]> {
  return merge((await getCollection('players')).filter(p => !p.data.isSample));
}

/** Every player including samples (admin screens and /data/players.json, which marks samples). */
export async function getRoster(): Promise<Player[]> {
  return getCollection('players');
}

/** Coaching staff on the Squad page (portal staff ordered by role). */
export async function getCoaches(): Promise<StaffMember[]> {
  return merge((await getCollection('staff')).filter(s => s.data.group === 'Coaching Staff')).sort((a, b) => a.data.order - b.data.order);
}
