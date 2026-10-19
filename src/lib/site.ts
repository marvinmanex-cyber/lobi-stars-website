import site from '../data/site.json';
import { SOCIAL_VISIBLE } from '../data/social';

// Change the season once in src/data/site.json and it updates everywhere.
export const CURRENT_SEASON: string = site.currentSeason;
export const FOOTER_TAGLINE: string = site.footerTagline;
export const HERO_STATS: { value: string; label: string }[] = site.stats;

/** Replaces "{season}" in a string with the current season. */
export function withSeason(text: string): string {
  return text.replaceAll('{season}', CURRENT_SEASON);
}

/** 25000 -> "₦25,000". Returns null for a missing or non-positive price. */
export function formatNaira(amount: number | null | undefined): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  return '₦' + amount.toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

/** "Kada Warriors FC" -> "KW". Used for crest placeholders. */
export function teamInitials(name: string): string {
  const words = name.replace(/\b(FC|F\.C\.|United)\b/gi, '').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map(w => w[0]).join('') || name.charAt(0)).toUpperCase();
}

export const CONTACT: { address: string; email: string; phone: string; whatsapp: string } = site.contact;

/** Social links (from the shared list in src/data/social.ts); empty and placeholder addresses are hidden. */
export const SOCIAL_LINKS = SOCIAL_VISIBLE.map(s => ({ key: s.id, label: s.label, url: s.url, icon: s.icon }));
