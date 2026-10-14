// The shared match card (functions/api/_lib/fixtureCard.js): date, kick-off
// and venue as separate details, countdown tiles, featured vs regular cards,
// monogram when a crest is missing, no "WAT" label. No server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lagosParts, splitVenue, initials, detailsHtml, countdownHtml, fixtureCardHtml, compLabel } from '../functions/api/_lib/fixtureCard.js';

const KO = '2026-11-08T15:00:00Z'; // 4:00 PM in Nigeria

test('Nigerian date and time from the stored UTC kick-off', () => {
  const p = lagosParts(KO);
  assert.equal(p.date, 'Sunday, 8 November 2026');
  assert.equal(p.time, '4:00 PM');
  assert.equal(p.iso, '2026-11-08T16:00:00+01:00');
  assert.equal(lagosParts('2026-11-08T23:30:00Z').date, 'Monday, 9 November 2026', 'after 11 PM UTC it is the next day in Nigeria');
  assert.equal(lagosParts('2026-11-08T11:05:00Z').time, '12:05 PM');
  assert.equal(lagosParts(null), null);
});

test('venue name on its own line above the town and state', () => {
  assert.deepEqual(splitVenue('McCarthy Stadium, Makurdi, Benue State'), { name: 'McCarthy Stadium', place: 'Makurdi, Benue State' });
  assert.deepEqual(splitVenue('UBA Sanni Stadium'), { name: 'UBA Sanni Stadium', place: '' });
  const html = detailsHtml({ kickoff: KO, venue: 'McCarthy Stadium, Makurdi, Benue State' });
  assert.match(html, /^<dl class="fx-details">/);
  assert.match(html, /Date<\/span><\/dt><dd><time datetime="2026-11-08T16:00:00\+01:00">Sunday, 8 November 2026<\/time>/);
  assert.match(html, /Kick-off<\/span><\/dt><dd><time datetime="2026-11-08T16:00:00\+01:00">4:00 PM<\/time>/);
  assert.match(html, /<span class="fx-vn">McCarthy Stadium<\/span><span class="fx-vp">Makurdi, Benue State<\/span>/);
  assert.equal((html.match(/<svg[^>]*aria-hidden="true"/g) || []).length, 3, 'decorative icons');
  assert.ok(!html.includes('·') && !/\bWAT\b/.test(html));
  assert.match(detailsHtml({ kickoff: KO, venue: 'X', tbc: true }), /To be confirmed.*TBC/s);
});

test('countdown tiles with a no-JavaScript fallback', () => {
  const html = countdownHtml(KO, { seconds: true });
  assert.match(html, /data-fx-cd="2026-11-08T15:00:00.000Z"/);
  assert.match(html, /Kick-off in/);
  for (const u of ['Days', 'Hours', 'Minutes', 'Seconds']) assert.match(html, new RegExp(`fx-unit">${u}<`));
  assert.match(html, /<p class="fx-cd-plain">Kick-off: <time datetime="2026-11-08T16:00:00\+01:00">Sunday, 8 November 2026, 4:00 PM<\/time>/);
  assert.ok(!countdownHtml(KO).includes('Seconds'));
});

test('featured and regular cards look different; LIVE, final score, postponed', () => {
  const base = { home: { name: 'Lobi Stars FC', crest: '/images/lobi-stars-fc.jpg', isLobi: true }, away: { name: 'Bichi First FC', crest: null }, kickoff: KO, venue: 'McCarthy Stadium, Makurdi, Benue State', status: 'scheduled', matchday: 1, competition: 'Nigeria National League, Conference D' };
  const big = fixtureCardHtml({ ...base, featured: true });
  assert.match(big, /class="fx-card fx-card--featured fx-card--home"/);
  assert.match(big, /Next match/);
  assert.match(big, /width="96" height="96"/);
  assert.match(big, /data-fx-cd=/);
  assert.match(big, /Nigeria National League · Conference D/);
  assert.match(big, /fx-pill--home">Home/);
  assert.match(big, /<span class="club-logo club-logo--mono fx-crest fx-crest--mono"[^>]*>BF<\/span>/, 'initials for a missing crest');
  assert.ok(!/border-radius|background:#fff/.test(big), 'no circle or white background on logos');
  assert.match(big, /<img class="club-logo fx-crest" src="\/images\/lobi-stars-fc-transparent.png"/, 'transparent copy of the crest');
  assert.match(big, /alt="Lobi Stars FC crest" width="96" height="96" loading="lazy"/);
  const small = fixtureCardHtml({ ...base, home: base.away, away: base.home });
  assert.match(small, /class="fx-card fx-card--regular fx-card--away"/);
  assert.match(small, /width="60" height="60"/);
  assert.ok(!small.includes('data-fx-cd'), 'countdown only on the featured card');
  assert.match(fixtureCardHtml({ ...base, featured: true, status: 'live', homeGoals: 1, awayGoals: 0 }), /fx-live" data-status>.*LIVE/s);
  const ft = fixtureCardHtml({ ...base, featured: true, status: 'full_time', homeGoals: 2, awayGoals: 1 });
  assert.match(ft, /Full time: Lobi Stars FC 2–1 Bichi First FC/);
  assert.match(fixtureCardHtml({ ...base, status: 'full_time', homeGoals: 2, awayGoals: 1 }), /fx-card--done/);
  assert.match(fixtureCardHtml({ ...base, status: 'postponed' }), /Postponed – date to be confirmed/);
  assert.ok(!fixtureCardHtml({ ...base, away: { name: '<b>x</b>' } }).includes('<b>x</b>'), 'escaped');
  assert.equal(initials('Lobi Stars FC'), 'LS');
  assert.equal(initials('ABS FC'), 'AB');
  assert.equal(compLabel('Nigeria National League, Conference D'), 'Nigeria National League · Conference D');
  assert.equal(compLabel('NNL Conference D'), 'Nigeria National League · Conference D');
  assert.equal(compLabel('Friendly'), 'Friendly');
});
