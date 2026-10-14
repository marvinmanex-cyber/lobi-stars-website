// Team name -> crest image lookup (transparent files: see logoFiles.js;
// Wikki Tourists still has its white background until the club sends a
// transparent file), used wherever a team is shown (match
// countdown, ticket cards, ticket stub, verification page, ticket email).
// Mirrors the client-side copies in src/pages/index.astro,
// src/pages/tickets/index.astro, src/pages/tickets/success.astro and
// src/pages/programme/index.astro -- keep them in sync. Unmapped teams
// fall back to the club's initials.
export const TEAM_LOGOS = {
  // Lobi Stars
  'Lobi Stars FC': '/images/lobi-stars-fc-transparent.png',
  'Lobi Stars': '/images/lobi-stars-crest.png',

  // 2026/27 NNL Conference D
  'ABS FC': '/images/abs-illorin-transparent.png',
  'Bichi First FC': '/images/bichi-first-transparent.png',
  'Bichi First': '/images/bichi-first-transparent.png',
  'Kada Warriors FC': '/images/kadawarriors-kaduna-transparent.png',
  'Kada Warriors': '/images/kadawarriors-kaduna-transparent.png',
  'Mighty Jets': '/images/mighty-jets-jos-transparent.png',
  'Mighty Jets Feeder / Bida Lions': '/images/mighty-jets-jos-transparent.png',
  'Sokoto United FC': '/images/sokoto-united-transparent.png',
  'Sokoto United': '/images/sokoto-united-transparent.png',
  'Wikki Tourists FC': '/images/wikki-tourists.jpg',
  'Wikki Tourists': '/images/wikki-tourists.jpg',
  'Yobe Desert Stars FC': '/images/yobe-desert-stars-transparent.png',
  'Yobe Desert Stars': '/images/yobe-desert-stars-transparent.png',

  // Other Nigerian sides
  'Kano Pillars': '/images/kano-pillars-logo.png',
};

export function teamLogo(name) {
  return TEAM_LOGOS[name] || null;
}
