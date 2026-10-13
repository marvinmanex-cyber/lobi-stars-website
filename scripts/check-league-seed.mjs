// Checks the 2026/27 NNL Conference D season: 56 fixtures, 8 clubs, 14
// matchdays of 4, every club once per matchday, every pairing once each way,
// 7 home and 7 away each, second half mirrors the first (matchday 15 - n),
// and Lobi Stars' 7 home matches all on Sundays (Nigerian time).
// Checks the seed file, then the LOCAL database (skip with --seed-only).
// Usage: node scripts/check-league-seed.mjs [--seed-only]
import { execFileSync } from 'node:child_process';
import { TEAMS, FIXTURES, checkSeason } from '../functions/api/_lib/league/seed.js';

let failed = false;
const report = (label, problems) => {
  if (problems.length) { failed = true; console.log(`✖ ${label}:`); for (const p of problems) console.log(`   - ${p}`); }
  else console.log(`✔ ${label}: all checks pass`);
};

report('Seed data', checkSeason({ teams: TEAMS, fixtures: FIXTURES }));

if (!process.argv.includes('--seed-only')) {
  try {
    const sql = `SELECT f.match_no, f.matchday, f.kickoff_at, h.code AS home, a.code AS away FROM league_fixtures f
      JOIN league_competitions c ON c.id = f.competition_id JOIN league_teams h ON h.id = f.home_team_id JOIN league_teams a ON a.id = f.away_team_id
      WHERE c.slug = 'nnl-conference-d-2026-27'`;
    const run = q => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', `"${q.replace(/\s+/g, ' ')}"`], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
    const rows = run(sql);
    const teams = run(`SELECT t.code FROM league_teams t JOIN league_competition_teams ct ON ct.team_id = t.id JOIN league_competitions c ON c.id = ct.competition_id WHERE c.slug = 'nnl-conference-d-2026-27'`);
    // Postponed fixtures have no kick-off: use the seed date for the Sunday check.
    const seedDate = new Map(FIXTURES.map(f => [f.match_no, f.kickoff_at]));
    report('Local database', checkSeason({ teams, fixtures: rows.map(r => ({ ...r, kickoff_at: r.kickoff_at || seedDate.get(r.match_no) })) }));
  } catch (err) {
    failed = true;
    console.log(`✖ Local database: could not read it (${String(err.message).split('\n')[0]}). Apply the migrations first: npx wrangler d1 migrations apply DB --local`);
  }
}
process.exit(failed ? 1 : 0);
