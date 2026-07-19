// Team name -> crest image lookup, used wherever a team is shown (match
// countdown, ticket cards, ticket stub, verification page). Mirrors the
// client-side copy in src/pages/index.astro and src/pages/tickets/index.astro
// -- keep all three in sync. Unmapped teams fall back to an initial-letter
// circle in the UI.
export const TEAM_LOGOS = {
  'Lobi Stars': '/images/hero-6.jpg',
  'Kano Pillars': '/images/kano-pillars-logo.jpeg',
};

export function teamLogo(name) {
  return TEAM_LOGOS[name] || null;
}
