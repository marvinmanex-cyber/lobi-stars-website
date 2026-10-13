// The official 2026/27 Nigeria National League (NNL) Conference D season:
// competition, clubs, home grounds and all 56 fixtures. Single source for
// the database seed (migrations/0003, made by scripts/build-league-seed-sql.mjs),
// the first-use seed in the live database, the data checks and the tests.
// Kick-off 16:00 Nigerian time = 15:00 UTC for every match.

export const COMPETITION = {
  slug: 'nnl-conference-d-2026-27',
  name: 'Nigeria National League, Conference D',
  short_name: 'NNL Conference D',
  season: '2026/2027',
  type: 'league',
  has_table: 1,
  is_current: 1,
  start_date: '2026-11-07',
  end_date: '2027-03-14',
  break_start: '2026-12-21',
  break_end: '2027-01-29',
  break_label: 'Mid-season break',
};

// Crests: the club crests already on the site (public/images). Colours are
// placeholders for the initials badge when a crest is missing.
export const TEAMS = [
  { code: 'YDS', name: 'Yobe Desert Stars FC', short_name: 'Yobe Desert Stars', venue: 'August 27 Stadium, Damaturu', crest_url: '/images/yobe-desert-stars.jpg', colour: '#C8902B', aliases: ['Yobe Desert Stars', 'Desert Stars', 'Yobe Stars'] },
  { code: 'MJT', name: 'Mighty Jets FC', short_name: 'Mighty Jets', venue: 'Zaria Road Stadium, Jos', crest_url: '/images/mighty-jets-jos.jpg', colour: '#1F4E9C', aliases: ['Mighty Jets', 'Mighty Jets Jos'] },
  { code: 'WIK', name: 'Wikki Tourists FC', short_name: 'Wikki Tourists', venue: 'ATBS Stadium, Bauchi', crest_url: '/images/wikki-tourists.jpg', colour: '#0E7A3E', aliases: ['Wikki Tourists', 'Wikki'] },
  { code: 'KAD', name: 'Kada Warriors FC', short_name: 'Kada Warriors', venue: 'UBA Sanni Stadium', crest_url: '/images/kadawarriors-kaduna.jpg', colour: '#7A1F2B', aliases: ['Kada Warriors', 'Kada'] },
  { code: 'LOB', name: 'Lobi Stars FC', short_name: 'Lobi Stars', venue: 'McCarthy Stadium, Makurdi, Benue', crest_url: '/images/lobi-stars-badge.png', colour: '#E31E24', is_lobi: 1, aliases: ['Lobi Stars', 'Lobi', 'Lobi Stars Makurdi'] },
  { code: 'BIC', name: 'Bichi First FC', short_name: 'Bichi First', venue: 'Bichi First Stadium, Bichi', crest_url: '/images/bichi-first.jpg', colour: '#5B2C83', aliases: ['Bichi First', 'Bichi'] },
  { code: 'ABS', name: 'ABS FC', short_name: 'ABS', venue: 'Ilorin Township Stadium', crest_url: '/images/abs-illorin.jpg', colour: '#0B6E99', aliases: ['ABS', 'ABS Ilorin', 'Abubakar Bukola Saraki FC'] },
  { code: 'SOK', name: 'Sokoto United FC', short_name: 'Sokoto Utd', venue: 'Giginya Memorial Stadium, Sokoto', crest_url: '/images/sokoto-united.jpg', colour: '#2E7D32', aliases: ['Sokoto Utd FC', 'Sokoto United', 'Sokoto Utd'] },
];

// match_no | matchday | date (Nigerian) | home | away
const LIST = `
1|1|2026-11-07|YDS|MJT
2|1|2026-11-07|WIK|KAD
3|1|2026-11-08|LOB|BIC
4|1|2026-11-07|ABS|SOK
5|2|2026-11-14|MJT|SOK
6|2|2026-11-14|BIC|ABS
7|2|2026-11-14|KAD|LOB
8|2|2026-11-14|YDS|WIK
9|3|2026-11-21|WIK|MJT
10|3|2026-11-22|LOB|YDS
11|3|2026-11-21|ABS|KAD
12|3|2026-11-21|SOK|BIC
13|4|2026-11-28|MJT|BIC
14|4|2026-11-28|KAD|SOK
15|4|2026-11-28|YDS|ABS
16|4|2026-11-28|WIK|LOB
17|5|2026-12-06|LOB|MJT
18|5|2026-12-05|ABS|WIK
19|5|2026-12-05|SOK|YDS
20|5|2026-12-05|BIC|KAD
21|6|2026-12-12|MJT|KAD
22|6|2026-12-12|YDS|BIC
23|6|2026-12-12|WIK|SOK
24|6|2026-12-13|LOB|ABS
25|7|2026-12-19|ABS|MJT
26|7|2026-12-19|SOK|LOB
27|7|2026-12-19|BIC|WIK
28|7|2026-12-19|KAD|YDS
29|8|2027-01-30|MJT|ABS
30|8|2027-01-31|LOB|SOK
31|8|2027-01-30|WIK|BIC
32|8|2027-01-30|YDS|KAD
33|9|2027-02-06|KAD|MJT
34|9|2027-02-06|BIC|YDS
35|9|2027-02-06|SOK|WIK
36|9|2027-02-06|ABS|LOB
37|10|2027-02-13|MJT|LOB
38|10|2027-02-13|WIK|ABS
39|10|2027-02-13|YDS|SOK
40|10|2027-02-13|KAD|BIC
41|11|2027-02-20|BIC|MJT
42|11|2027-02-20|SOK|KAD
43|11|2027-02-20|ABS|YDS
44|11|2027-02-21|LOB|WIK
45|12|2027-02-27|MJT|WIK
46|12|2027-02-27|YDS|LOB
47|12|2027-02-27|KAD|ABS
48|12|2027-02-27|BIC|SOK
49|13|2027-03-06|SOK|MJT
50|13|2027-03-06|ABS|BIC
51|13|2027-03-07|LOB|KAD
52|13|2027-03-06|WIK|YDS
53|14|2027-03-14|MJT|YDS
54|14|2027-03-14|KAD|WIK
55|14|2027-03-14|BIC|LOB
56|14|2027-03-14|SOK|ABS`;

export const FIXTURES = LIST.trim().split('\n').map(line => {
  const [match_no, matchday, date, home, away] = line.split('|');
  const kickoff = `${date}T15:00:00Z`;
  return { match_no: Number(match_no), matchday: Number(matchday), round: Number(matchday) <= 7 ? 1 : 2, home, away, kickoff_at: kickoff, original_kickoff_at: kickoff };
});

/** Data checks for a season; returns a list of problems (empty = all good). */
export function checkSeason({ teams, fixtures, lobiCode = 'LOB' }) {
  const problems = [];
  const codes = teams.map(t => t.code);
  if (fixtures.length !== 56) problems.push(`Expected 56 fixtures, found ${fixtures.length}.`);
  if (teams.length !== 8) problems.push(`Expected 8 teams, found ${teams.length}.`);
  for (let md = 1; md <= 14; md++) {
    const day = fixtures.filter(f => f.matchday === md);
    if (day.length !== 4) problems.push(`Matchday ${md} has ${day.length} fixtures, not 4.`);
    const seen = day.flatMap(f => [f.home, f.away]);
    for (const c of codes) { const n = seen.filter(x => x === c).length; if (n !== 1) problems.push(`Matchday ${md}: ${c} appears ${n} times.`); }
  }
  if (fixtures.some(f => f.matchday < 1 || f.matchday > 14)) problems.push('Matchdays must be 1 to 14.');
  for (const h of codes) for (const a of codes) {
    if (h === a) continue;
    const n = fixtures.filter(f => f.home === h && f.away === a).length;
    if (n !== 1) problems.push(`${h} v ${a} occurs ${n} times.`);
  }
  for (const c of codes) {
    const home = fixtures.filter(f => f.home === c).length, away = fixtures.filter(f => f.away === c).length;
    if (home !== 7 || away !== 7) problems.push(`${c} has ${home} home and ${away} away fixtures.`);
  }
  for (const f of fixtures.filter(x => x.matchday >= 8)) {
    const rev = fixtures.find(x => x.home === f.away && x.away === f.home);
    if (!rev || rev.matchday !== 15 - f.matchday) problems.push(`Reverse of ${f.home} v ${f.away} (Matchday ${f.matchday}) should be on Matchday ${15 - f.matchday}.`);
  }
  const lobi = fixtures.filter(f => f.home === lobiCode || f.away === lobiCode);
  if (lobi.length !== 14) problems.push(`Lobi Stars has ${lobi.length} fixtures, not 14.`);
  for (const f of lobi.filter(x => x.home === lobiCode)) {
    const day = new Date(Date.parse(f.kickoff_at) + 3600e3).getUTCDay();
    if (day !== 0) problems.push(`Lobi Stars home match ${f.match_no} is not on a Sunday.`);
  }
  return problems;
}
