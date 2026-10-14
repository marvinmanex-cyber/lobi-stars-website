// The homepage Match Day Programme strip and the shared "next match" helper:
// earliest unfinished Lobi Stars fixture, finished/cancelled/abandoned/postponed
// skipped (also when only the league says so), live first, the right opponent
// home and away, and the strip's text, link and "coming soon" state. No server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLobiMatch, opponentOf, lobiAtHome } from '../functions/api/_lib/tickets/rules.js';
import { programmeStripHtml } from '../functions/api/_lib/programmeStrip.js';
import { upcomingHtml } from '../functions/api/_lib/tickets/upcomingHtml.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const m = (id, iso, home, away, extra = {}) => ({ id, slug: id, event_date: iso, home_team: home, away_team: away, competition: 'NNL Conference D', venue: 'McCarthy Stadium, Makurdi, Benue State', status: 'scheduled', ...extra });
const MD1 = m('md1', '2026-11-08T15:00:00Z', 'Lobi Stars FC', 'Bichi First FC', { league_status: 'scheduled' });
const MD2 = m('md2', '2026-11-14T15:00:00Z', 'Kada Warriors FC', 'Lobi Stars FC', { league_status: 'scheduled' });
const MD3 = m('md3', '2026-11-22T15:00:00Z', 'Lobi Stars FC', 'Yobe Desert Stars FC', { league_status: 'scheduled' });
const OTHER = m('x', '2026-11-02T15:00:00Z', 'ABS FC', 'Sokoto United FC');

test('next match: the earliest unfinished Lobi Stars fixture; other clubs ignored', () => {
  const n = nextLobiMatch([MD3, OTHER, MD2, MD1], NOW);
  assert.equal(n.id, 'md1');
  assert.equal(opponentOf(n), 'Bichi First FC');
  assert.equal(lobiAtHome(n), true);
});

test('finished, cancelled, abandoned and postponed are skipped (match or league status)', () => {
  for (const extra of [{ status: 'full-time' }, { status: 'cancelled' }, { status: 'abandoned' }, { status: 'postponed' },
    { league_status: 'full_time' }, { league_status: 'awarded' }, { league_status: 'cancelled' }, { league_status: 'postponed' }]) {
    const n = nextLobiMatch([{ ...MD1, ...extra }, MD2, MD3], NOW);
    assert.equal(n.id, 'md2', JSON.stringify(extra));
    assert.equal(opponentOf(n), 'Kada Warriors FC', 'away match: the opponent is the home club');
    assert.equal(lobiAtHome(n), false);
  }
});

test('a live match is the current match until it ends; nothing left gives null', () => {
  const live = { ...MD2, status: 'live' };
  assert.equal(nextLobiMatch([MD1, live, MD3], NOW).id, 'md2');
  assert.equal(nextLobiMatch([{ ...MD1, status: 'full-time' }], NOW), null);
  assert.equal(nextLobiMatch([], NOW), null);
  // After kick-off + 2 h 15 min without a result, the next fixture takes over.
  assert.equal(nextLobiMatch([MD1, MD2], Date.parse('2026-11-08T17:30:00Z')).id, 'md2');
});

test('Upcoming Matches features the same match as the strip', () => {
  const html = upcomingHtml([{ ...MD1, league_status: 'postponed' }, MD2, MD3], { now: NOW });
  const featured = html.split('<li').find(c => c.includes('fx-card--featured'));
  assert.ok(featured.includes('Kada Warriors FC'), 'postponed MD1 is not the featured next match');
  assert.match(html, /Postponed – date to be confirmed/, 'the postponed match is still listed');
});

test('strip: "Lobi Stars FC vs <opponent>" and always "Read free" to the programme page', () => {
  const on = programmeStripHtml({ opponent: 'Bichi First FC', home: true, kickoff: MD1.event_date, programmeSlug: 'lobi-stars-vs-bichi-first-2026-11-08' });
  assert.match(on, /Match Day Programme/);
  assert.match(on, /Lobi Stars FC vs Bichi First FC <span class="pgb-ha">Home<\/span>/);
  assert.match(on, /<a class="pgb-link" href="\/programme\/\?src=homepage" aria-label="Read the match day programme: Lobi Stars FC vs Bichi First FC">/);
  assert.match(on, /Read free &rarr;/);
  const soon = programmeStripHtml({ opponent: 'Kada Warriors FC', home: false, kickoff: MD2.event_date, programmeSlug: null });
  assert.match(soon, /Lobi Stars FC vs Kada Warriors FC <span class="pgb-ha">Away<\/span>/);
  assert.match(soon, /<a class="pgb-link" href="\/programme\/\?src=homepage"/, 'Read free even before the programme is out');
  assert.match(soon, /Read free &rarr;/);
  assert.ok(!soon.includes('coming soon'));
  assert.equal(programmeStripHtml(null), '');
  assert.ok(!programmeStripHtml({ opponent: '<b>x</b>', home: true, kickoff: 'k', programmeSlug: null }).includes('<b>x</b>'), 'escaped');
});
