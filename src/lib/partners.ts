import { getCollection, type CollectionEntry } from 'astro:content';
import { existsSync } from 'node:fs';
import partnership from '../data/partnership.json';

export type Partner = CollectionEntry<'partners'>;

export const TIERS = [
  'Principal Partner',
  'Official Kit Partner',
  'Official Club Partners',
  'Official Suppliers',
  'Media & Broadcast Partners',
  'Institutional & Community Partners',
] as const;
export type Tier = (typeof TIERS)[number];

const warned = new Set<string>();

/** Active partners, ordered by tier then displayOrder. */
export async function getPartners(): Promise<Partner[]> {
  const all = (await getCollection('partners')).filter(p => p.data.active);
  const list = all.sort((a, b) =>
    TIERS.indexOf(a.data.tier) - TIERS.indexOf(b.data.tier) || a.data.displayOrder - b.data.displayOrder || a.data.name.localeCompare(b.data.name));
  for (const w of partnerWarnings(list)) {
    if (!warned.has(w)) { warned.add(w); console.warn(`[partners] ${w}`); }
  }
  return list;
}

export function byTier(list: Partner[]) {
  return TIERS.map(tier => ({ tier, partners: list.filter(p => p.data.tier === tier) })).filter(g => g.partners.length);
}

/** Only one active Official Club Partner per category. */
export function partnerWarnings(list: Partner[]): string[] {
  const seen = new Map<string, string[]>();
  for (const p of list) {
    if (p.data.tier !== 'Official Club Partners') continue;
    const key = p.data.category.trim().toLowerCase();
    seen.set(key, [...(seen.get(key) ?? []), p.data.name]);
  }
  return [...seen.entries()].filter(([, names]) => names.length > 1)
    .map(([cat, names]) => `Category "${cat}" has more than one active Official Club Partner: ${names.join(', ')}. Only one is allowed.`);
}

/** Open categories minus any already taken by an active partner. */
export function openCategories(list: Partner[]): string[] {
  const taken = new Set(list.map(p => p.data.category.trim().toLowerCase()));
  return partnership.openCategories.filter(c => !taken.has(c.trim().toLowerCase()));
}

/** Logo path if the file exists in public/, otherwise null (show the name instead). */
export function logoSrc(p: Partner): string | null {
  const logo = p.data.logo;
  if (!logo) return null;
  if (/^https?:\/\//.test(logo)) return logo;
  return existsSync(`public${decodeURI(logo)}`) ? logo : null;
}

export function logoAlt(p: Partner) {
  return `${p.data.name} – ${p.data.officialTitle} of Lobi Stars FC`;
}

export function website(p: Partner): string | null {
  const w = (p.data.website || '').trim();
  return /^https?:\/\//.test(w) ? w : null;
}

export const PARTNERSHIP = partnership;
