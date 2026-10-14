// The homepage match bar (functions/api/_lib/matchBar.js): one main button
// (Buy ticket / Listen live / Match Centre), the rest in "More", separate date,
// time and venue, countdown, live and postponed states, hidden with no match.
// No server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchBarHtml } from '../functions/api/_lib/matchBar.js';
import { upcomingHtml } from '../functions/api/_lib/tickets/upcomingHtml.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const m = (id, iso, home, away, extra = {}) => ({ id, slug: id, event_date: iso, home_team: home, away_team: away, competition: 'NNL Conference D', venue: 'McCarthy Stadium, Makurdi, Benue State', status: 'scheduled', matchday: 1, ...extra });
const HOME = m('md1', '2026-11-08T15:00:00Z', 'Lobi Stars FC', 'Bichi First FC', { is_home: true, ticket: { state: 'on_sale', fromKobo: 100000 } });
const AWAY = m('md2', '2026-11-14T15:00:00Z', 'Kada Warriors FC', 'Lobi Stars FC', { is_home: false, matchday: 2 });
const LATER = m('md3', '2026-11-22T15:00:00Z', 'Lobi Stars FC', 'Yobe Desert Stars FC', { is_home: true, matchday: 3 });
const menu = html => html.slice(html.indexOf('<ul class="mb-menu"'), html.indexOf('</ul>'));
const primary = html => html.match(/<a class="mb-btn mb-btn--primary"[^>]*>(.*?)<\/a>/s)?.[1].replace(/<[^>]+>/g, '');

test('home match on sale: "Buy ticket from ₦1,000"; Match Centre, calendar, share, listen in More', () => {
  const html = matchBarHtml([LATER, HOME, AWAY], { now: NOW });
  assert.match(html, /aria-label="Next match: Lobi Stars FC vs Bichi First FC"/);
  assert.equal(primary(html), 'Buy ticket from ₦1,000');
  assert.match(html, /href="\/tickets\/\?event=md1"/);
  const more = menu(html);
  for (const t of ['Match Centre', 'Add to calendar', 'Share', 'Listen live']) assert.ok(more.includes(t), t);
  assert.match(more, /href="\/matches\/md1\/"/);
  assert.match(more, /href="\/api\/calendar\?match=md1"/);
  assert.match(more, /href="\/commentary\/"[^>]*data-track="commentary_click"/);
  assert.match(html, /aria-haspopup="true" aria-expanded="false" aria-controls="mbMenu"/);
  // Date, time and venue are separate items; no "WAT"; Benue State.
  assert.match(html, /<dd><time datetime="2026-11-08T16:00:00\+01:00">Sun 8 Nov<\/time><\/dd>/);
  assert.match(html, /<dd><time datetime="2026-11-08T16:00:00\+01:00">4:00 PM<\/time><\/dd>/);
  assert.match(html, /McCarthy Stadium, Makurdi, Benue State/);
  assert.ok(!/\bWAT\b/.test(html));
  assert.match(html, /data-fx-cd="2026-11-08T15:00:00.000Z"/);
  assert.match(html, /data-u="s" hidden/, 'seconds only under 24 hours');
  assert.match(html, /"@type":"SportsEvent"/);
  assert.match(html, /class="club-logo fx-crest"/);
});

test('home match not on sale and away match: the main button is Match Centre (never a dead Buy ticket)', () => {
  for (const x of [{ ...HOME, ticket: { state: 'not_on_sale' } }, { ...HOME, ticket: { state: 'sold_out' } }, AWAY]) {
    const html = matchBarHtml([x], { now: NOW });
    assert.equal(primary(html), 'Match Centre');
    assert.ok(!html.includes('Buy ticket'));
    assert.ok(!menu(html).includes('Match Centre'), 'not twice');
  }
  assert.match(matchBarHtml([AWAY], { now: NOW }), /mb-ha--away">Away/);
});

test('live: Listen live is the main button, LIVE and the score replace the countdown', () => {
  const html = matchBarHtml([{ ...HOME, status: 'live', home_score: 1, away_score: 0 }], { now: Date.parse('2026-11-08T15:30:00Z') });
  assert.equal(primary(html), 'Listen live');
  assert.match(html, /class="mb-live"/);
  assert.match(html, /aria-label="Score 1 to 0"/);
  assert.ok(!html.includes('data-fx-cd'));
  assert.ok(!menu(html).includes('Listen live'));
});

test('postponed (when it is the only match left): "Postponed – date to be confirmed" and Match Centre', () => {
  const html = matchBarHtml([{ ...HOME, status: 'postponed' }], { now: NOW });
  assert.match(html, /Postponed – date to be confirmed/);
  assert.equal(primary(html), 'Match Centre');
  assert.ok(!menu(html).includes('Add to calendar'));
  // A dated match is preferred over a postponed one.
  assert.match(matchBarHtml([{ ...HOME, status: 'postponed' }, AWAY], { now: NOW }), /Kada Warriors FC/);
});

test('no fixtures left: no bar; the Upcoming Matches list starts after the bar match', () => {
  assert.equal(matchBarHtml([], { now: NOW }), '');
  assert.equal(matchBarHtml([{ ...HOME, status: 'full-time' }], { now: NOW }), '');
  const list = upcomingHtml([HOME, AWAY, LATER], { now: NOW, limit: 2, afterBar: true });
  assert.ok(!list.includes('Bichi First FC'), 'the bar match is not repeated');
  assert.ok(!list.includes('fx-card--featured'), 'no second big card');
  assert.equal((list.match(/<li class="fx-card/g) || []).length, 2);
});
