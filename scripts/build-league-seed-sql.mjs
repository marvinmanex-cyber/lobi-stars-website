// Writes the league migrations from the same code the site uses:
//   migrations/0002_league.sql            the league_ tables
//   migrations/0003_league_seed_nnl_d.sql the official 2026/27 NNL Conference D season
// Usage: node scripts/build-league-seed-sql.mjs
// (The site also creates and seeds these on first use, so applying the
// migrations is optional; both are safe to run more than once.)
import { writeFileSync } from 'node:fs';
import { LEAGUE_TABLES_SQL, seedStatements } from '../functions/api/_lib/leagueDb.js';

const head = (title) => `-- ${title}\n-- Made by scripts/build-league-seed-sql.mjs: edit functions/api/_lib/leagueDb.js or\n-- functions/api/_lib/league/seed.js and run it again, never this file.\n\n`;
const tables = LEAGUE_TABLES_SQL.filter(s => !/TABLE IF NOT EXISTS settings/.test(s));
writeFileSync(new URL('../migrations/0002_league.sql', import.meta.url),
  head('League, fixtures and table (all tables start with league_).') + tables.map(s => s.replace(/\n {4}/g, '\n  ') + ';').join('\n\n') + '\n'
  + "\nCREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT);\n");
writeFileSync(new URL('../migrations/0003_league_seed_nnl_d.sql', import.meta.url),
  head('Seed: Nigeria National League, Conference D, 2026/2027 (8 clubs, 56 fixtures).') + seedStatements().map(s => s.replace(/\n\s+/g, '\n  ') + ';').join('\n') + '\n');
console.log('Wrote migrations/0002_league.sql and migrations/0003_league_seed_nnl_d.sql');
