// Plain helpers with no server-only imports, so browser scripts can use them too.

// The only news categories the club uses. Order here is the order of the
// tabs on /news (after "All").
export const NEWS_CATEGORIES = [
  { name: 'First Team', slug: 'first-team' },
  { name: 'Team News', slug: 'team-news' },
  { name: 'Features', slug: 'features' },
  { name: 'Tickets', slug: 'tickets' },
  { name: 'Club', slug: 'club' },
  { name: 'Media Watch', slug: 'media-watch' },
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number]['name'];

export function categorySlug(name: string): string {
  return NEWS_CATEGORIES.find(c => c.name === name)?.slug ?? 'all';
}

export function categoryHref(name: string): string {
  return `/news?category=${categorySlug(name)}`;
}

/** "9 minutes ago", "3 hours ago", "a day ago", "5 days ago", ... */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? 'a day ago' : `${d} days ago`;
  if (d < 30) {
    const w = Math.floor(d / 7);
    return w === 1 ? 'a week ago' : `${w} weeks ago`;
  }
  if (d < 365) {
    const mo = Math.floor(d / 30);
    return mo <= 1 ? 'a month ago' : `${mo} months ago`;
  }
  const y = Math.floor(d / 365);
  return y === 1 ? 'a year ago' : `${y} years ago`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos',
  });
}

/** Turns a YouTube/Vimeo link into an embeddable URL; null if it isn't one. */
export function videoEmbedUrl(url?: string | null): string | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}
