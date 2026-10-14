-- "Benue" -> "Benue State" in the stored venue of Lobi Stars' home ground
-- (display text only; ids, slugs and links are unchanged).
-- Optional: the site also makes this change itself the first time the league
-- loads (functions/api/_lib/leagueDb.js), so nothing breaks if this is never run.
-- Safe to run more than once.
--   npx wrangler d1 migrations apply lobi-stars-tickets --local
--   npx wrangler d1 migrations apply lobi-stars-tickets --remote

UPDATE league_venues SET name = 'McCarthy Stadium, Makurdi, Benue State'
  WHERE name = 'McCarthy Stadium, Makurdi, Benue'
    AND NOT EXISTS (SELECT 1 FROM league_venues WHERE name = 'McCarthy Stadium, Makurdi, Benue State');

UPDATE events SET venue = 'McCarthy Stadium, Makurdi, Benue State'
  WHERE venue = 'McCarthy Stadium, Makurdi, Benue';
