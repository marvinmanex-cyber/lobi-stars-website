// Team name -> crest image lookup, used wherever a team is shown (match
// countdown, ticket cards, ticket stub, verification page, ticket email).
// Mirrors the client-side copies in src/pages/index.astro,
// src/pages/tickets/index.astro and src/pages/tickets/success.astro --
// keep them in sync. Unmapped teams fall back to an initial-letter circle.
export const TEAM_LOGOS = {
  // Lobi Stars
  'Lobi Stars FC': '/images/lobi-stars-fc.jpg',
  'Lobi Stars': '/images/lobi-stars-crest.png',

  // 2026/27 NNL Conference D
  'ABS FC': '/images/abs-illorin.jpg',
  'Bichi First FC': '/images/bichi-first.jpg',
  'Bichi First': '/images/bichi-first.jpg',
  'Kada Warriors FC': '/images/kadawarriors-kaduna.jpg',
  'Kada Warriors': '/images/kadawarriors-kaduna.jpg',
  'Mighty Jets': '/images/mighty-jets-jos.jpg',
  'Mighty Jets Feeder / Bida Lions': '/images/mighty-jets-jos.jpg',
  'Sokoto United FC': '/images/sokoto-united.jpg',
  'Sokoto United': '/images/sokoto-united.jpg',
  'Wikki Tourists FC': '/images/wikki-tourists.jpg',
  'Wikki Tourists': '/images/wikki-tourists.jpg',
  'Yobe Desert Stars FC': '/images/yobe-desert-stars.jpg',
  'Yobe Desert Stars': '/images/yobe-desert-stars.jpg',

  // Other Nigerian sides
  'Kano Pillars': '/images/kano-pillars-logo.png',
};

export function teamLogo(name) {
  return TEAM_LOGOS[name] || null;
}
