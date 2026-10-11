// Share images for match pages: made at build time (integrations/og) for
// every team in TEAM_LOGOS, home and away, e.g.
// /og/match/lobi-stars-v-kada-warriors.jpg. Matches against a team without
// one use the general Match Centre image.
export const teamSlug = name => (/lobi stars/i.test(name || '') ? 'lobi-stars'
  : String(name || '').replace(/\s+F\.?C\.?$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
export const matchImagePath = (home, away) => `/og/match/${teamSlug(home)}-v-${teamSlug(away)}.jpg`;
export const MATCH_FALLBACK_IMAGE = '/og/match/match-centre.jpg';
