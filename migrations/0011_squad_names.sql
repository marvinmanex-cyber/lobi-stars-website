-- Squad & Staff Data Portal, 22 Oct 2026: the name in three parts and the
-- profile pages. Nothing is dropped or deleted: display_name and full_name keep
-- their old values (no longer written), and old name recordings stay in storage.
--   surname, first_name, middle_name  the new name fields (cached from data_json)
--   website_name                       "Name on website" (club only), if any
--   public_name                        website_name, or "First name Surname" (lists, search, logs)
--   name_status                        'pending' = an old single name waiting for the Super Admin's
--                                      name check; 'confirmed' once checked
-- player_match_stats.minutes: minutes played, entered in Live Match Control.
--
-- The website also adds these columns itself the first time it opens the tables
-- (functions/api/_lib/squadProfiles.js and stats.js), so on a database the live
-- site has already used this file is not needed (applying it there would report
-- "duplicate column"). Back up first:
--   npx wrangler d1 export DB --remote --table squad_profiles --output backups/squad_profiles-before-names.sql
ALTER TABLE squad_profiles ADD COLUMN surname TEXT;
ALTER TABLE squad_profiles ADD COLUMN first_name TEXT;
ALTER TABLE squad_profiles ADD COLUMN middle_name TEXT;
ALTER TABLE squad_profiles ADD COLUMN website_name TEXT;
ALTER TABLE squad_profiles ADD COLUMN public_name TEXT;
ALTER TABLE squad_profiles ADD COLUMN name_status TEXT;
ALTER TABLE player_match_stats ADD COLUMN minutes INTEGER NOT NULL DEFAULT 0;
