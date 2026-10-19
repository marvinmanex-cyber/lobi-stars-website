// The club's social links: one list for the footer icons, the Contact page, the
// homepage WhatsApp Channel card and the Share Hub. The addresses themselves are
// edited in the Content CMS (Site Settings & Shop › Season, Homepage Stats &
// Footer Text › Social links), which saves them in site.json.
// An entry whose address is empty or still a "REPLACE_WITH_…" placeholder is not
// shown anywhere (no broken icon or dead link).
import site from './site.json';

export interface SocialLink { id: string; label: string; url: string; icon: string }

/** SVG path data (24×24 viewBox), drawn white on each platform's brand colour. */
const ICONS: Record<string, string> = {
  "facebook": "M14 8.5V6.8c0-.8.5-1 1-1h2.4V2.1L14.1 2C10.6 2 9.8 4.6 9.8 6.3v2.2H7.5v3.9h2.3V22H14v-9.6h3l.5-3.9H14z",
  "x": "M17.8 3h3.1l-6.8 7.7 8 10.3h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.9 3h6.4l4.4 5.9L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z",
  "instagram": "M12 7.4A4.6 4.6 0 1 0 12 16.6 4.6 4.6 0 0 0 12 7.4zm0 7.6a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5.9-7.8a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0zM21.9 8.2c-.1-1.6-.4-3-1.6-4.2S17.4 2.4 15.8 2.3C14.2 2.2 9.8 2.2 8.2 2.3 6.6 2.4 5.2 2.7 4 3.9S2.4 6.6 2.3 8.2c-.1 1.6-.1 6 0 7.6.1 1.6.4 3 1.6 4.2s2.6 1.5 4.2 1.6c1.6.1 6 .1 7.6 0 1.6-.1 3-.4 4.2-1.6s1.5-2.6 1.6-4.2c.1-1.6.1-6 0-7.6zm-2.1 9.4a3 3 0 0 1-1.7 1.7c-1.2.5-4 .4-5.3.4s-4.1.1-5.3-.4a3 3 0 0 1-1.7-1.7c-.5-1.2-.4-4-.4-5.3s-.1-4.1.4-5.3a3 3 0 0 1 1.7-1.7c1.2-.5 4-.4 5.3-.4s4.1-.1 5.3.4a3 3 0 0 1 1.7 1.7c.5 1.2.4 4 .4 5.3s.1 4.1-.4 5.3z",
  "youtube": "M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15V9l5.8 3-5.8 3z",
  "tiktok": "M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9.1a7.3 7.3 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.2-1.6z",
  "whatsappChannel": "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2l-.5-.3z"
};

const social = (site.social || {}) as Record<string, string>;

/** Is this a real address (not empty, not a placeholder)? */
export const isRealUrl = (url: string | undefined | null): url is string =>
  !!url && !/^REPLACE_WITH/i.test(url.trim()) && /^https:\/\//i.test(url.trim());

/** Every platform, in display order (placeholders included). */
export const SOCIAL: SocialLink[] = [
  { id: 'facebook', label: 'Facebook', url: social.facebook || '', icon: ICONS.facebook },
  { id: 'x', label: 'X', url: social.x || '', icon: ICONS.x },
  { id: 'instagram', label: 'Instagram', url: social.instagram || '', icon: ICONS.instagram },
  { id: 'youtube', label: 'YouTube', url: social.youtube || '', icon: ICONS.youtube },
  { id: 'tiktok', label: 'TikTok', url: social.tiktok || '', icon: ICONS.tiktok },
  { id: 'whatsappChannel', label: 'WhatsApp Channel', url: social.whatsappChannel || '', icon: ICONS.whatsappChannel },
].map(s => ({ ...s, url: s.url.trim() }));

/** Still a "REPLACE_WITH_…" placeholder (the club will send the address)? */
export const isPlaceholder = (url: string | undefined | null): boolean => /^REPLACE_WITH/i.test(String(url || '').trim());

/** Only the platforms with a real address (links that work). */
export const SOCIAL_VISIBLE: SocialLink[] = SOCIAL.filter(s => isRealUrl(s.url));

/**
 * What the site shows: real addresses as links, and placeholders as the same icon
 * that is not a link yet ("coming soon": nothing happens on click). An empty
 * address means the club has no such account: not shown at all.
 */
export const SOCIAL_SHOWN: (SocialLink & { live: boolean })[] = SOCIAL
  .filter(s => isRealUrl(s.url) || isPlaceholder(s.url))
  .map(s => ({ ...s, url: isRealUrl(s.url) ? s.url : '', live: isRealUrl(s.url) }));

/** The WhatsApp Channel address ('' while it is a placeholder). */
export const WHATSAPP_CHANNEL_URL: string = isRealUrl(social.whatsappChannel) ? social.whatsappChannel.trim() : '';
/** Show the WhatsApp Channel card and footer link (as a link once the address is real, before that not clickable). */
export const WHATSAPP_CHANNEL_SHOWN: boolean = !!WHATSAPP_CHANNEL_URL || isPlaceholder(social.whatsappChannel);

/** The WhatsApp icon on its own (for buttons). */
export const WHATSAPP_ICON = ICONS.whatsappChannel;
