// Logo files that had a white (or black) background baked into the image now
// have a transparent copy (made with scripts/logo-remove-background.mjs; the
// originals are kept, in public/images and design-sources/logo-originals).
// Stored addresses (league teams in the database, older content) keep
// working: wherever a logo is shown, logoFile() swaps in the transparent copy.
// No copy for wikki-tourists.jpg: its white inside can't be separated from
// the background safely, so it waits for a transparent file from the club.
export const TRANSPARENT_LOGOS = {
  '/images/lobi-stars-fc.jpg': '/images/lobi-stars-fc-transparent.png',
  '/images/lobi-stars-badge.png': '/images/lobi-stars-fc-transparent.png',
  '/images/yobe-desert-stars.jpg': '/images/yobe-desert-stars-transparent.png',
  '/images/mighty-jets-jos.jpg': '/images/mighty-jets-jos-transparent.png',
  '/images/kadawarriors-kaduna.jpg': '/images/kadawarriors-kaduna-transparent.png',
  '/images/bichi-first.jpg': '/images/bichi-first-transparent.png',
  '/images/abs-illorin.jpg': '/images/abs-illorin-transparent.png',
  '/images/sokoto-united.jpg': '/images/sokoto-united-transparent.png',
  '/images/bipc-logo.jpg': '/images/bipc-logo-transparent.png',
  '/images/novus.png': '/images/novus-transparent.png',
  '/images/prime-beverages2.jpg': '/images/prime-beverages2-transparent.png',
  '/images/Jumia-Logo.jpg': '/images/Jumia-Logo-transparent.png',
};

/** The file to show for a stored logo address (the transparent copy when there is one). */
export const logoFile = url => (url ? TRANSPARENT_LOGOS[url] || url : null);
