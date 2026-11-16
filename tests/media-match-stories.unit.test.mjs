// Media Centre: missing match preview / match report detection (Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchStoryStatus, matchStoryDeadlines } from '../functions/api/_lib/mediaMatchStories.js';

const env = (matches, news) => ({
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: matches }) }) }) },
  ASSETS: { fetch: async () => new Response(JSON.stringify(news)) },
});
const now = Date.parse('2026-11-12T10:00:00Z');
const next = { id: 'm2', home_team: 'Kada Warriors FC', away_team: 'Lobi Stars FC', event_date: '2026-11-14T15:00:00Z', venue: 'Kaduna' };
const last = { id: 'm1', home_team: 'Lobi Stars FC', away_team: 'Bichi First FC', event_date: '2026-11-08T15:00:00Z', venue: 'Makurdi' };

test('a coming match without a preview, and a played match without a report, are listed', async () => {
  const s = await matchStoryStatus(env([last, next], []), now);
  assert.deepEqual(s.map(x => [x.kind, x.done]), [['match_report', false], ['match_preview', false]]);
  assert.equal((await matchStoryDeadlines(env([last, next], []), now)).length, 2);
});
test('published stories count as done', async () => {
  const news = [
    { title: '𝗠𝗔𝗧𝗖𝗛 𝗥𝗘𝗣𝗢𝗥𝗧 𝗙𝗢𝗚𝗔 𝗙𝗜𝗥𝗘𝗦 𝗟𝗢𝗕𝗜 𝗦𝗧𝗔𝗥𝗦', summary: 'Lobi Stars takes all 3points', contentType: null, publishedAt: '2026-11-09T12:51:37Z' },
    { title: 'Focus. Discipline. Determination.', summary: 'Final preparation ahead of Saturday', contentType: 'Preview', matchDate: '2026-11-14', publishedAt: '2026-11-11T18:32:01Z' },
  ];
  const s = await matchStoryStatus(env([last, next], news), now);
  assert.ok(s.every(x => x.done), JSON.stringify(s));
});
