// Logo files that had a white (or black) background baked into the image now
// have a transparent copy (made with scripts/logo-remove-background.mjs; the
// originals are kept, in public/images and design-sources/logo-originals).
// Stored addresses (league teams in the database, older content) keep
// working: wherever a logo is shown, logoFile() swaps in the transparent copy.
// No copy for wikki-tourists.jpg: its white inside can't be separated from
// the background safely, so it waits for a transparent file from the club.
// Club crests only: partner logos stay exactly as uploaded, on their white
// cards (PartnerLogo.astro).
export const TRANSPARENT_LOGOS = {
  '/images/lobi-stars-fc.jpg': '/images/lobi-stars-fc-transparent-256.webp',
  '/images/lobi-stars-badge.png': '/images/lobi-stars-fc-transparent-256.webp',
  '/images/yobe-desert-stars.jpg': '/images/yobe-desert-stars-transparent.webp',
  '/images/mighty-jets-jos.jpg': '/images/mighty-jets-jos-transparent.webp',
  '/images/kadawarriors-kaduna.jpg': '/images/kadawarriors-kaduna-transparent.webp',
  '/images/bichi-first.jpg': '/images/bichi-first-transparent.webp',
  '/images/abs-illorin.jpg': '/images/abs-illorin-transparent.webp',
  '/images/sokoto-united.jpg': '/images/sokoto-united-transparent.webp',
};

/** The file to show for a stored logo address (the transparent copy when there is one). */
export const logoFile = url => (url ? TRANSPARENT_LOGOS[url] || url : null);
