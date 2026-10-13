-- Seed: Nigeria National League, Conference D, 2026/2027 (8 clubs, 56 fixtures).
-- Made by scripts/build-league-seed-sql.mjs: edit functions/api/_lib/leagueDb.js or
-- functions/api/_lib/league/seed.js and run it again, never this file.

INSERT OR IGNORE INTO league_competitions (slug, name, short_name, season, type, has_table, is_current, start_date, end_date, break_start, break_end, break_label)
  VALUES ('nnl-conference-d-2026-27', 'Nigeria National League, Conference D', 'NNL Conference D', '2026/2027', 'league', 1, 1, '2026-11-07', '2027-03-14', '2026-12-21', '2027-01-29', 'Mid-season break');
INSERT OR IGNORE INTO league_venues (name, city) VALUES ('August 27 Stadium, Damaturu', NULL);
INSERT OR IGNORE INTO league_venues (name, city) VALUES ('Zaria Road Stadium, Jos', NULL);
INSERT OR IGNORE INTO league_venues (name, city) VALUES ('ATBS Stadium, Bauchi', NULL);
INSERT OR IGNORE INTO league_venues (name, city) VALUES ('UBA Sanni Stadium', NULL);
INSERT OR IGNORE INTO league_venues (name, city) VALUES ('McCarthy Stadium, Makurdi, Benue', NULL);
INSERT OR IGNORE INTO league_venues (name, city) VALUES ('Bichi First Stadium, Bichi', NULL);
INSERT OR IGNORE INTO league_venues (name, city) VALUES ('Ilorin Township Stadium', NULL);
INSERT OR IGNORE INTO league_venues (name, city) VALUES ('Giginya Memorial Stadium, Sokoto', NULL);
INSERT OR IGNORE INTO league_teams (code, name, short_name, slug, crest_url, colour, home_venue_id, is_lobi, aliases)
  VALUES ('YDS', 'Yobe Desert Stars FC', 'Yobe Desert Stars', 'yobe-desert-stars-fc', '/images/yobe-desert-stars.jpg', '#C8902B', (SELECT id FROM league_venues WHERE name = 'August 27 Stadium, Damaturu'), 0, '["Yobe Desert Stars","Desert Stars","Yobe Stars"]');
INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), (SELECT id FROM league_teams WHERE code = 'YDS'));
INSERT OR IGNORE INTO league_teams (code, name, short_name, slug, crest_url, colour, home_venue_id, is_lobi, aliases)
  VALUES ('MJT', 'Mighty Jets FC', 'Mighty Jets', 'mighty-jets-fc', '/images/mighty-jets-jos.jpg', '#1F4E9C', (SELECT id FROM league_venues WHERE name = 'Zaria Road Stadium, Jos'), 0, '["Mighty Jets","Mighty Jets Jos"]');
INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), (SELECT id FROM league_teams WHERE code = 'MJT'));
INSERT OR IGNORE INTO league_teams (code, name, short_name, slug, crest_url, colour, home_venue_id, is_lobi, aliases)
  VALUES ('WIK', 'Wikki Tourists FC', 'Wikki Tourists', 'wikki-tourists-fc', '/images/wikki-tourists.jpg', '#0E7A3E', (SELECT id FROM league_venues WHERE name = 'ATBS Stadium, Bauchi'), 0, '["Wikki Tourists","Wikki"]');
INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), (SELECT id FROM league_teams WHERE code = 'WIK'));
INSERT OR IGNORE INTO league_teams (code, name, short_name, slug, crest_url, colour, home_venue_id, is_lobi, aliases)
  VALUES ('KAD', 'Kada Warriors FC', 'Kada Warriors', 'kada-warriors-fc', '/images/kadawarriors-kaduna.jpg', '#7A1F2B', (SELECT id FROM league_venues WHERE name = 'UBA Sanni Stadium'), 0, '["Kada Warriors","Kada"]');
INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), (SELECT id FROM league_teams WHERE code = 'KAD'));
INSERT OR IGNORE INTO league_teams (code, name, short_name, slug, crest_url, colour, home_venue_id, is_lobi, aliases)
  VALUES ('LOB', 'Lobi Stars FC', 'Lobi Stars', 'lobi-stars-fc', '/images/lobi-stars-badge.png', '#E31E24', (SELECT id FROM league_venues WHERE name = 'McCarthy Stadium, Makurdi, Benue'), 1, '["Lobi Stars","Lobi","Lobi Stars Makurdi"]');
INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), (SELECT id FROM league_teams WHERE code = 'LOB'));
INSERT OR IGNORE INTO league_teams (code, name, short_name, slug, crest_url, colour, home_venue_id, is_lobi, aliases)
  VALUES ('BIC', 'Bichi First FC', 'Bichi First', 'bichi-first-fc', '/images/bichi-first.jpg', '#5B2C83', (SELECT id FROM league_venues WHERE name = 'Bichi First Stadium, Bichi'), 0, '["Bichi First","Bichi"]');
INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), (SELECT id FROM league_teams WHERE code = 'BIC'));
INSERT OR IGNORE INTO league_teams (code, name, short_name, slug, crest_url, colour, home_venue_id, is_lobi, aliases)
  VALUES ('ABS', 'ABS FC', 'ABS', 'abs-fc', '/images/abs-illorin.jpg', '#0B6E99', (SELECT id FROM league_venues WHERE name = 'Ilorin Township Stadium'), 0, '["ABS","ABS Ilorin","Abubakar Bukola Saraki FC"]');
INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), (SELECT id FROM league_teams WHERE code = 'ABS'));
INSERT OR IGNORE INTO league_teams (code, name, short_name, slug, crest_url, colour, home_venue_id, is_lobi, aliases)
  VALUES ('SOK', 'Sokoto United FC', 'Sokoto Utd', 'sokoto-united-fc', '/images/sokoto-united.jpg', '#2E7D32', (SELECT id FROM league_venues WHERE name = 'Giginya Memorial Stadium, Sokoto'), 0, '["Sokoto Utd FC","Sokoto United","Sokoto Utd"]');
INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), (SELECT id FROM league_teams WHERE code = 'SOK'));
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 1, 1, 1,
  (SELECT id FROM league_teams WHERE code = 'YDS'), (SELECT id FROM league_teams WHERE code = 'MJT'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'YDS'), '2026-11-07T15:00:00Z', '2026-11-07T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 2, 1, 1,
  (SELECT id FROM league_teams WHERE code = 'WIK'), (SELECT id FROM league_teams WHERE code = 'KAD'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'WIK'), '2026-11-07T15:00:00Z', '2026-11-07T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 3, 1, 1,
  (SELECT id FROM league_teams WHERE code = 'LOB'), (SELECT id FROM league_teams WHERE code = 'BIC'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'LOB'), '2026-11-08T15:00:00Z', '2026-11-08T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 4, 1, 1,
  (SELECT id FROM league_teams WHERE code = 'ABS'), (SELECT id FROM league_teams WHERE code = 'SOK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'ABS'), '2026-11-07T15:00:00Z', '2026-11-07T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 5, 2, 1,
  (SELECT id FROM league_teams WHERE code = 'MJT'), (SELECT id FROM league_teams WHERE code = 'SOK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'MJT'), '2026-11-14T15:00:00Z', '2026-11-14T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 6, 2, 1,
  (SELECT id FROM league_teams WHERE code = 'BIC'), (SELECT id FROM league_teams WHERE code = 'ABS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'BIC'), '2026-11-14T15:00:00Z', '2026-11-14T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 7, 2, 1,
  (SELECT id FROM league_teams WHERE code = 'KAD'), (SELECT id FROM league_teams WHERE code = 'LOB'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'KAD'), '2026-11-14T15:00:00Z', '2026-11-14T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 8, 2, 1,
  (SELECT id FROM league_teams WHERE code = 'YDS'), (SELECT id FROM league_teams WHERE code = 'WIK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'YDS'), '2026-11-14T15:00:00Z', '2026-11-14T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 9, 3, 1,
  (SELECT id FROM league_teams WHERE code = 'WIK'), (SELECT id FROM league_teams WHERE code = 'MJT'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'WIK'), '2026-11-21T15:00:00Z', '2026-11-21T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 10, 3, 1,
  (SELECT id FROM league_teams WHERE code = 'LOB'), (SELECT id FROM league_teams WHERE code = 'YDS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'LOB'), '2026-11-22T15:00:00Z', '2026-11-22T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 11, 3, 1,
  (SELECT id FROM league_teams WHERE code = 'ABS'), (SELECT id FROM league_teams WHERE code = 'KAD'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'ABS'), '2026-11-21T15:00:00Z', '2026-11-21T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 12, 3, 1,
  (SELECT id FROM league_teams WHERE code = 'SOK'), (SELECT id FROM league_teams WHERE code = 'BIC'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'SOK'), '2026-11-21T15:00:00Z', '2026-11-21T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 13, 4, 1,
  (SELECT id FROM league_teams WHERE code = 'MJT'), (SELECT id FROM league_teams WHERE code = 'BIC'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'MJT'), '2026-11-28T15:00:00Z', '2026-11-28T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 14, 4, 1,
  (SELECT id FROM league_teams WHERE code = 'KAD'), (SELECT id FROM league_teams WHERE code = 'SOK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'KAD'), '2026-11-28T15:00:00Z', '2026-11-28T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 15, 4, 1,
  (SELECT id FROM league_teams WHERE code = 'YDS'), (SELECT id FROM league_teams WHERE code = 'ABS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'YDS'), '2026-11-28T15:00:00Z', '2026-11-28T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 16, 4, 1,
  (SELECT id FROM league_teams WHERE code = 'WIK'), (SELECT id FROM league_teams WHERE code = 'LOB'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'WIK'), '2026-11-28T15:00:00Z', '2026-11-28T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 17, 5, 1,
  (SELECT id FROM league_teams WHERE code = 'LOB'), (SELECT id FROM league_teams WHERE code = 'MJT'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'LOB'), '2026-12-06T15:00:00Z', '2026-12-06T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 18, 5, 1,
  (SELECT id FROM league_teams WHERE code = 'ABS'), (SELECT id FROM league_teams WHERE code = 'WIK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'ABS'), '2026-12-05T15:00:00Z', '2026-12-05T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 19, 5, 1,
  (SELECT id FROM league_teams WHERE code = 'SOK'), (SELECT id FROM league_teams WHERE code = 'YDS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'SOK'), '2026-12-05T15:00:00Z', '2026-12-05T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 20, 5, 1,
  (SELECT id FROM league_teams WHERE code = 'BIC'), (SELECT id FROM league_teams WHERE code = 'KAD'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'BIC'), '2026-12-05T15:00:00Z', '2026-12-05T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 21, 6, 1,
  (SELECT id FROM league_teams WHERE code = 'MJT'), (SELECT id FROM league_teams WHERE code = 'KAD'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'MJT'), '2026-12-12T15:00:00Z', '2026-12-12T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 22, 6, 1,
  (SELECT id FROM league_teams WHERE code = 'YDS'), (SELECT id FROM league_teams WHERE code = 'BIC'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'YDS'), '2026-12-12T15:00:00Z', '2026-12-12T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 23, 6, 1,
  (SELECT id FROM league_teams WHERE code = 'WIK'), (SELECT id FROM league_teams WHERE code = 'SOK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'WIK'), '2026-12-12T15:00:00Z', '2026-12-12T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 24, 6, 1,
  (SELECT id FROM league_teams WHERE code = 'LOB'), (SELECT id FROM league_teams WHERE code = 'ABS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'LOB'), '2026-12-13T15:00:00Z', '2026-12-13T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 25, 7, 1,
  (SELECT id FROM league_teams WHERE code = 'ABS'), (SELECT id FROM league_teams WHERE code = 'MJT'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'ABS'), '2026-12-19T15:00:00Z', '2026-12-19T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 26, 7, 1,
  (SELECT id FROM league_teams WHERE code = 'SOK'), (SELECT id FROM league_teams WHERE code = 'LOB'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'SOK'), '2026-12-19T15:00:00Z', '2026-12-19T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 27, 7, 1,
  (SELECT id FROM league_teams WHERE code = 'BIC'), (SELECT id FROM league_teams WHERE code = 'WIK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'BIC'), '2026-12-19T15:00:00Z', '2026-12-19T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 28, 7, 1,
  (SELECT id FROM league_teams WHERE code = 'KAD'), (SELECT id FROM league_teams WHERE code = 'YDS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'KAD'), '2026-12-19T15:00:00Z', '2026-12-19T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 29, 8, 2,
  (SELECT id FROM league_teams WHERE code = 'MJT'), (SELECT id FROM league_teams WHERE code = 'ABS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'MJT'), '2027-01-30T15:00:00Z', '2027-01-30T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 30, 8, 2,
  (SELECT id FROM league_teams WHERE code = 'LOB'), (SELECT id FROM league_teams WHERE code = 'SOK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'LOB'), '2027-01-31T15:00:00Z', '2027-01-31T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 31, 8, 2,
  (SELECT id FROM league_teams WHERE code = 'WIK'), (SELECT id FROM league_teams WHERE code = 'BIC'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'WIK'), '2027-01-30T15:00:00Z', '2027-01-30T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 32, 8, 2,
  (SELECT id FROM league_teams WHERE code = 'YDS'), (SELECT id FROM league_teams WHERE code = 'KAD'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'YDS'), '2027-01-30T15:00:00Z', '2027-01-30T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 33, 9, 2,
  (SELECT id FROM league_teams WHERE code = 'KAD'), (SELECT id FROM league_teams WHERE code = 'MJT'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'KAD'), '2027-02-06T15:00:00Z', '2027-02-06T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 34, 9, 2,
  (SELECT id FROM league_teams WHERE code = 'BIC'), (SELECT id FROM league_teams WHERE code = 'YDS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'BIC'), '2027-02-06T15:00:00Z', '2027-02-06T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 35, 9, 2,
  (SELECT id FROM league_teams WHERE code = 'SOK'), (SELECT id FROM league_teams WHERE code = 'WIK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'SOK'), '2027-02-06T15:00:00Z', '2027-02-06T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 36, 9, 2,
  (SELECT id FROM league_teams WHERE code = 'ABS'), (SELECT id FROM league_teams WHERE code = 'LOB'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'ABS'), '2027-02-06T15:00:00Z', '2027-02-06T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 37, 10, 2,
  (SELECT id FROM league_teams WHERE code = 'MJT'), (SELECT id FROM league_teams WHERE code = 'LOB'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'MJT'), '2027-02-13T15:00:00Z', '2027-02-13T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 38, 10, 2,
  (SELECT id FROM league_teams WHERE code = 'WIK'), (SELECT id FROM league_teams WHERE code = 'ABS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'WIK'), '2027-02-13T15:00:00Z', '2027-02-13T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 39, 10, 2,
  (SELECT id FROM league_teams WHERE code = 'YDS'), (SELECT id FROM league_teams WHERE code = 'SOK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'YDS'), '2027-02-13T15:00:00Z', '2027-02-13T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 40, 10, 2,
  (SELECT id FROM league_teams WHERE code = 'KAD'), (SELECT id FROM league_teams WHERE code = 'BIC'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'KAD'), '2027-02-13T15:00:00Z', '2027-02-13T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 41, 11, 2,
  (SELECT id FROM league_teams WHERE code = 'BIC'), (SELECT id FROM league_teams WHERE code = 'MJT'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'BIC'), '2027-02-20T15:00:00Z', '2027-02-20T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 42, 11, 2,
  (SELECT id FROM league_teams WHERE code = 'SOK'), (SELECT id FROM league_teams WHERE code = 'KAD'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'SOK'), '2027-02-20T15:00:00Z', '2027-02-20T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 43, 11, 2,
  (SELECT id FROM league_teams WHERE code = 'ABS'), (SELECT id FROM league_teams WHERE code = 'YDS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'ABS'), '2027-02-20T15:00:00Z', '2027-02-20T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 44, 11, 2,
  (SELECT id FROM league_teams WHERE code = 'LOB'), (SELECT id FROM league_teams WHERE code = 'WIK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'LOB'), '2027-02-21T15:00:00Z', '2027-02-21T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 45, 12, 2,
  (SELECT id FROM league_teams WHERE code = 'MJT'), (SELECT id FROM league_teams WHERE code = 'WIK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'MJT'), '2027-02-27T15:00:00Z', '2027-02-27T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 46, 12, 2,
  (SELECT id FROM league_teams WHERE code = 'YDS'), (SELECT id FROM league_teams WHERE code = 'LOB'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'YDS'), '2027-02-27T15:00:00Z', '2027-02-27T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 47, 12, 2,
  (SELECT id FROM league_teams WHERE code = 'KAD'), (SELECT id FROM league_teams WHERE code = 'ABS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'KAD'), '2027-02-27T15:00:00Z', '2027-02-27T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 48, 12, 2,
  (SELECT id FROM league_teams WHERE code = 'BIC'), (SELECT id FROM league_teams WHERE code = 'SOK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'BIC'), '2027-02-27T15:00:00Z', '2027-02-27T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 49, 13, 2,
  (SELECT id FROM league_teams WHERE code = 'SOK'), (SELECT id FROM league_teams WHERE code = 'MJT'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'SOK'), '2027-03-06T15:00:00Z', '2027-03-06T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 50, 13, 2,
  (SELECT id FROM league_teams WHERE code = 'ABS'), (SELECT id FROM league_teams WHERE code = 'BIC'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'ABS'), '2027-03-06T15:00:00Z', '2027-03-06T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 51, 13, 2,
  (SELECT id FROM league_teams WHERE code = 'LOB'), (SELECT id FROM league_teams WHERE code = 'KAD'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'LOB'), '2027-03-07T15:00:00Z', '2027-03-07T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 52, 13, 2,
  (SELECT id FROM league_teams WHERE code = 'WIK'), (SELECT id FROM league_teams WHERE code = 'YDS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'WIK'), '2027-03-06T15:00:00Z', '2027-03-06T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 53, 14, 2,
  (SELECT id FROM league_teams WHERE code = 'MJT'), (SELECT id FROM league_teams WHERE code = 'YDS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'MJT'), '2027-03-14T15:00:00Z', '2027-03-14T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 54, 14, 2,
  (SELECT id FROM league_teams WHERE code = 'KAD'), (SELECT id FROM league_teams WHERE code = 'WIK'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'KAD'), '2027-03-14T15:00:00Z', '2027-03-14T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 55, 14, 2,
  (SELECT id FROM league_teams WHERE code = 'BIC'), (SELECT id FROM league_teams WHERE code = 'LOB'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'BIC'), '2027-03-14T15:00:00Z', '2027-03-14T15:00:00Z', 'scheduled', 1, 'seed');
INSERT OR IGNORE INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
  VALUES ((SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27'), 56, 14, 2,
  (SELECT id FROM league_teams WHERE code = 'SOK'), (SELECT id FROM league_teams WHERE code = 'ABS'),
  (SELECT home_venue_id FROM league_teams WHERE code = 'SOK'), '2027-03-14T15:00:00Z', '2027-03-14T15:00:00Z', 'scheduled', 1, 'seed');
