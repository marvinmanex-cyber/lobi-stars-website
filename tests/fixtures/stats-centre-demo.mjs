// Demo data for the Statistics Center (tests and scripts/stats-centre-demo.mjs): one fixture,
// Lobi Stars FC v Demo United FC, with line-ups and 21 events. Final score 3–1 (half-time 1–1):
// Lobi goals by Demo Striker (assist Demo Winger), Demo Winger (penalty) and an own goal by the visitors' No. 5.
export const DEMO_ROSTER = Array.from({ length: 16 }, (_, i) => ({
  slug: `demo-player-${i + 1}`, name: `Demo ${['Keeper', 'Rightback', 'Centreback', 'Stopper', 'Leftback', 'Anchor', 'Playmaker', 'Winger', 'Striker', 'Forward', 'Wide', 'Subkeeper', 'Subdefender', 'Submid', 'Subwinger', 'Substriker'][i]}`,
  number: i + 1, position: i === 0 || i === 11 ? 'GK' : i < 5 || i === 12 ? 'DF' : i < 8 || i === 13 ? 'MF' : 'FW', photo: null, isSample: false,
}));
export const DEMO_EVENT = { id: 'evt_demo_1', home_team: 'Lobi Stars FC', away_team: 'Demo United FC', competition: 'NNL', event_date: '2026-11-15T15:00:00Z', venue: 'McCarthy Stadium, Makurdi' };
export const DEMO_LINEUPS = {
  home: DEMO_ROSTER.map((p, i) => ({ slug: p.slug, number: p.number, position: p.position, starter: i < 11 })),
  away: Array.from({ length: 14 }, (_, i) => ({ name: `Visitor ${i + 1}`, number: i + 1, position: i === 0 ? 'GK' : '', starter: i < 11 })),
};
const P = n => ({ slug: `demo-player-${n}`, name: DEMO_ROSTER[n - 1].name });
const V = n => ({ slug: null, name: `Visitor ${n}` });
let k = 0;
const ev = (side, type, minute, period, who = {}, extra = {}) => ({ id: `demoevent${String(++k).padStart(3, '0')}`, side, type, minute, period, slug: who.slug ?? null, name: who.name ?? null, ...extra });
export const DEMO_EVENTS = [
  ev('home', 'shot', 4, '1H', P(9), { outcome: 'off_target', bodyPart: 'right_foot' }),
  ev('home', 'corner', 7, '1H', P(8)),
  ev('home', 'goal', 12, '1H', P(9), { relatedSlug: P(8).slug, relatedName: P(8).name, detail: 'open_play', bodyPart: 'head' }),
  ev('away', 'foul_committed', 15, '1H', V(6)),
  ev('away', 'yellow_card', 15, '1H', V(6)),
  ev('away', 'shot', 22, '1H', V(9), { outcome: 'on_target' }),
  ev('home', 'gk_save', 22, '1H', P(1)),
  ev('away', 'goal', 34, '1H', V(9), { detail: 'open_play', bodyPart: 'left_foot' }),
  ev('home', 'offside', 40, '1H', P(10)),
  ev('home', 'shot', 45, '1H', P(7), { outcome: 'blocked', stoppage: 2 }),
  ev('home', 'substitution', 46, '2H', P(10), { relatedSlug: P(16).slug, relatedName: P(16).name, outcome: 'tactical', detail: 'tactical' }),
  ev('home', 'shot', 52, '2H', P(16), { outcome: 'woodwork' }),
  ev('home', 'corner', 53, '2H', P(8)),
  ev('home', 'goal', 58, '2H', P(8), { detail: 'penalty', bodyPart: 'right_foot' }),
  ev('away', 'substitution', 60, '2H', V(9), { relatedName: 'Visitor 12', outcome: 'tactical' }),
  ev('home', 'yellow_card', 66, '2H', P(6)),
  ev('home', 'injury', 70, '2H', P(3), { outcome: 'off' }),
  ev('home', 'substitution', 71, '2H', P(3), { relatedSlug: P(13).slug, relatedName: P(13).name, outcome: 'injury', detail: 'injury' }),
  ev('home', 'goal', 80, '2H', V(5), { detail: 'own_goal' }),
  ev('away', 'red_card', 85, '2H', V(4), { detail: 'second_yellow' }),
  ev('home', 'foul_committed', 90, '2H', P(13), { stoppage: 3 }),
];
