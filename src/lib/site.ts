import site from '../data/site.json';

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

/** Social links; entries with an empty URL are hidden. */
export const SOCIAL_LINKS = (
  [
    { key: 'facebook', label: 'Facebook' },
    { key: 'x', label: 'X' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'youtube', label: 'YouTube' },
    { key: 'tiktok', label: 'TikTok' },
    { key: 'whatsappChannel', label: 'WhatsApp Channel' },
  ] as const
)
  .map(s => ({ ...s, url: (site.social as Record<string, string>)[s.key] || '' }))
  .filter(s => s.url);
