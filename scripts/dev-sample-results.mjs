// LOCAL TESTING ONLY: writes sample results for matchdays 1 to 3 (including a
// draw, an awarded 3-0 and a sample points deduction) into the LOCAL database
// so the table and pages can be checked. Never part of a migration.
//   node scripts/dev-sample-results.mjs          add the sample results
//   node scripts/dev-sample-results.mjs --clear  remove them again
// Refuses to run against the live database.
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (process.argv.some(a => /remote|--env|production/i.test(a))) {
  console.error('Refusing: this script only ever writes to the LOCAL database.');
  process.exit(1);
}
const COMP = "(SELECT id FROM league_competitions WHERE slug = 'nnl-conference-d-2026-27')";
const RESULTS = [
  [1, 2, 1], [2, 0, 0], [3, 3, 1], [4, 1, 1],
  [5, 2, 0], [6, 1, 1], [7, 0, 1], [8, 0, 2],
  [9, 1, 1], [10, 2, 0], [11, 3, 0, 'awarded'], [12, 1, 0],
];
const run = sql => {
  const file = path.join(tmpdir(), `league-sample-${Date.now()}.sql`);
  writeFileSync(file, sql);
  try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', `"${file}"`], { stdio: 'pipe', shell: true }); }
  finally { rmSync(file, { force: true }); }
};

if (process.argv.includes('--clear')) {
  run(`UPDATE match_centre SET status = 'scheduled', home_score = NULL, away_score = NULL, kickoff_at = NULL, ended_at = NULL, updated_at = datetime('now')
         WHERE event_id IN (SELECT event_id FROM league_fixtures WHERE updated_by = 'sample' AND event_id IS NOT NULL);
       UPDATE league_fixtures SET status = 'scheduled', home_goals = NULL, away_goals = NULL, result_type = 'normal', updated_at = datetime('now'), updated_by = 'sample-cleared'
         WHERE updated_by = 'sample';
       DELETE FROM league_table_adjustments WHERE reason LIKE '[local test]%' OR reason LIKE '[sample]%';`);
  console.log('Sample results removed from the local database.');
} else {
  const sql = RESULTS.map(([no, h, a, type]) => `
UPDATE league_fixtures SET status = '${type === 'awarded' ? 'awarded' : 'full_time'}', home_goals = ${h}, away_goals = ${a}, result_type = '${type === 'awarded' ? 'awarded' : 'normal'}',
  updated_at = datetime('now'), updated_by = 'sample' WHERE competition_id = ${COMP} AND match_no = ${no};
INSERT INTO match_centre (event_id, status, home_score, away_score, updated_at)
  SELECT event_id, 'full-time', ${h}, ${a}, datetime('now') FROM league_fixtures WHERE competition_id = ${COMP} AND match_no = ${no} AND event_id IS NOT NULL
  ON CONFLICT(event_id) DO UPDATE SET status = 'full-time', home_score = excluded.home_score, away_score = excluded.away_score, updated_at = datetime('now');`).join('\n')
    + `\nINSERT INTO league_table_adjustments (competition_id, team_id, points_delta, reason, created_by)
  SELECT ${COMP}, id, -3, '[local test] Fielded an ineligible player', 'sample' FROM league_teams WHERE code = 'SOK';`;
  run(sql);
  console.log('Sample results for matchdays 1 to 3 written to the LOCAL database (remove with --clear).');
}
