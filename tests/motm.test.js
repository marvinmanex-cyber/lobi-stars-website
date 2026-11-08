// Man of the Match voting rules (no server needed): npm run test:motm
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { votingWindow, candidates, tally, isHeldAccount, sponsorView, announcementData, announcementView, clubTime, VOTING_OPEN_MINUTES } from '../functions/api/_lib/motmRules.js';
import { cardHtml, announcementHtml, sponsorHtml } from '../functions/api/_lib/motmCard.js';

const KO = '2026-11-08T15:00:00.000Z'; // 4:00 pm in Lagos
const at = (min, base = KO) => new Date(Date.parse(base) + min * 60e3).toISOString();
const home = (x = {}) => ({ event_date: KO, status: 'scheduled', is_home: true, ...x });
const squad = {
  starting: [{ slug: 'a', name: 'Daniel Atsaka', number: 1, position: 'GK', photo: '/api/squad/photo/a.webp' }, { slug: 'b', name: 'Samuel Obi', number: 9, position: 'FWD', photo: null }, { slug: 'c', name: 'Nanen Imenger', number: 10, position: 'MID', photo: null }],
  bench: [{ slug: 'd', name: 'Musa Sudes', number: 20, position: 'MID', photo: null }, { slug: 'e', name: 'Victor Amos', number: 19, position: 'FWD', photo: null }],
};
const subOn = (player, minAfter) => ({ type: 'sub', team: 'home', player, detail: 'on for Samuel Obi', recordedAt: at(minAfter) });
const W = votingWindow(home(), Date.parse(KO));
const v = (slug, min, status = 'counted') => ({ player_slug: slug, created_at: at(min), status });

test('opens at 4:00 pm', () => {
  assert.equal(votingWindow(home(), Date.parse(at(-1))).status, 'upcoming');
  assert.equal(votingWindow(home(), Date.parse(KO)).status, 'open');
  assert.equal(clubTime(W.opensAt), '4:00 pm');
});

test('closes at 5:50 pm (kick-off + 110 minutes, one constant)', () => {
  assert.equal(VOTING_OPEN_MINUTES, 110);
  assert.equal(clubTime(W.closesAt), '5:50 pm');
  assert.equal(votingWindow(home(), Date.parse(at(109))).status, 'open');
  assert.equal(votingWindow(home(), Date.parse(at(110))).status, 'closed');
});

test('a delayed kick-off moves both times', () => {
  const late = home({ event_date: at(30) });
  const w = votingWindow(late, Date.parse(at(20)));
  assert.equal(w.status, 'upcoming');
  assert.equal(clubTime(w.opensAt), '4:30 pm'); assert.equal(clubTime(w.closesAt), '6:20 pm');
});

test('away and abandoned matches have no vote', () => {
  assert.equal(votingWindow(home({ is_home: false }), Date.parse(KO)).status, 'not_home');
  assert.equal(votingWindow(home({ status: 'cancelled' }), Date.parse(KO)).status, 'cancelled');
  assert.equal(votingWindow(home({ status: 'postponed' }), Date.parse(KO)).status, 'cancelled');
  assert.equal(votingWindow(null).status, 'no_match');
});

test('only the starting XI and substitutes who came on (after their entry time); unused subs never', () => {
  const tl = [subOn('Musa Sudes', 60)];
  assert.deepEqual(candidates(squad, tl, 'home', Date.parse(at(59))).map(p => p.slug), ['a', 'b', 'c'], 'before he came on');
  const later = candidates(squad, tl, 'home', Date.parse(at(61)));
  assert.deepEqual(later.map(p => p.slug), ['a', 'b', 'c', 'd']);
  assert.equal(later.find(p => p.slug === 'd').since, at(60));
  assert.ok(!later.some(p => p.slug === 'e'), 'unused substitute');
  // A vote for him before his entry time does not count.
  const t = tally({ votes: [v('d', 30), v('d', 70)], players: later, opensAt: W.opensAt, closesAt: W.closesAt });
  assert.equal(t.totalVotes, 1); assert.equal(t.invalid, 1);
  // A substitution for the other team doesn't bring our player on.
  assert.ok(!candidates(squad, [{ ...subOn('Victor Amos', 10), team: 'away' }], 'home', Date.parse(at(20))).some(p => p.slug === 'e'));
});

test('unverified accounts are refused (the vote API checks this before saving)', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../functions/api/_lib/motmService.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!fan\.email_verified\) return fail\('Confirm your email address to vote\.'/);
});

test('a second vote is refused (UNIQUE (event_id, member_id))', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../functions/api/_lib/motmService.js', import.meta.url), 'utf8');
  assert.match(src, /UNIQUE \(event_id, member_id\)/);
  assert.match(src, /ON CONFLICT \(event_id, member_id\) DO NOTHING/);
  assert.match(src, /'You have already voted in this match\.'/);
});

test('held accounts (created less than 24 hours before kick-off) are not counted', () => {
  assert.equal(isHeldAccount(at(-24 * 60 - 1), KO), false);
  assert.equal(isHeldAccount(at(-23 * 60), KO), true);
  assert.equal(isHeldAccount(at(5), KO), true, 'made during the match');
  const players = candidates(squad, [], 'home', Date.parse(KO));
  const t = tally({ votes: [v('a', 5), v('b', 6, 'held'), v('b', 7, 'held')], players, opensAt: W.opensAt, closesAt: W.closesAt });
  assert.equal(t.totalVotes, 1); assert.equal(t.held, 2); assert.equal(t.rows[0].slug, 'a');
});

test('votes outside the window are not counted', () => {
  const players = candidates(squad, [], 'home', Date.parse(KO));
  const t = tally({ votes: [v('a', -1), v('a', 110), v('b', 109)], players, opensAt: W.opensAt, closesAt: W.closesAt });
  assert.equal(t.totalVotes, 1); assert.equal(t.rows[0].slug, 'b'); assert.equal(t.invalid, 2);
});

test('top 3: correct votes and whole-number percentages', () => {
  const players = candidates(squad, [], 'home', Date.parse(KO));
  const votes = [v('a', 1), v('a', 2), v('a', 3), v('b', 4), v('b', 5), v('c', 6)];
  const t = tally({ votes, players, opensAt: W.opensAt, closesAt: W.closesAt });
  assert.deepEqual(t.rows.map(r => [r.slug, r.votes, r.percent]), [['a', 3, 50], ['b', 2, 33], ['c', 1, 17]]);
  const d = announcementData(t, at(110));
  assert.equal(d.top3.length, 3);
  for (const r of d.top3) { assert.ok(Number.isInteger(r.votes)); assert.ok(Number.isInteger(r.percent)); }
});

test('tie-break: the player who reached the total first wins', () => {
  const players = candidates(squad, [], 'home', Date.parse(KO));
  // b reaches 2 votes at minute 4, a reaches 2 at minute 9.
  const t = tally({ votes: [v('a', 1), v('b', 2), v('b', 4), v('a', 9)], players, opensAt: W.opensAt, closesAt: W.closesAt });
  assert.equal(t.rows[0].slug, 'b'); assert.equal(t.tieBroken, true);
});

test('the announcement appears automatically at 5:50 pm and not at 5:49 pm', () => {
  assert.equal(votingWindow(home(), Date.parse(at(109))).status, 'open');
  assert.equal(votingWindow(home(), Date.parse(at(110))).status, 'closed');
  // The service saves it on the first request when the status is closed (once, UNIQUE event_id), with no approval.
  return import('node:fs/promises').then(async fs => {
    const src = await fs.readFile(new URL('../functions/api/_lib/motmService.js', import.meta.url), 'utf8');
    assert.match(src, /motm_announcements \(event_id TEXT PRIMARY KEY/);
    assert.match(src, /if \(win\.status === 'closed'\) out\.announcement = /);
    assert.doesNotMatch(src, /approv|pending/i);
  });
});

test('a winner with no squad photo has photoUrl null and is shown by name with the badge', () => {
  const players = candidates(squad, [], 'home', Date.parse(KO));
  const t = tally({ votes: [v('b', 1)], players, opensAt: W.opensAt, closesAt: W.closesAt });
  const a = announcementView(announcementData(t, at(110)), { opponent: 'Bichi First FC', sponsor: sponsorView({}) });
  assert.equal(a.winner.photoUrl, null);
  const html = announcementHtml(a, { opponent: 'Bichi First FC' });
  assert.match(html, /motm-bigname">Samuel Obi</); assert.match(html, /lobi-stars-badge\.png/);
  assert.match(a.message, /^Your Man of the Match: Samuel Obi!\nLobi Stars fans have spoken\. Samuel Obi \(#9\) is the Man of the Match for Lobi Stars vs Bichi First FC at McCarthy Stadium, with 1 vote \(100% of the fan vote\)\. Congratulations, Samuel!\nThe Lobi Stars Man of the Match award is proudly sponsored by Mr\. Moses Orkuma\.$/);
  assert.doesNotMatch(html, /Okuma/);
});

test('hiding the sponsor removes the sponsor line', () => {
  assert.equal(sponsorView({ show: false }), null);
  assert.equal(sponsorHtml(null), '');
  const players = candidates(squad, [], 'home', Date.parse(KO));
  const a = announcementView(announcementData(tally({ votes: [v('a', 1)], players, opensAt: W.opensAt, closesAt: W.closesAt }), at(110)), { opponent: 'X', sponsor: null });
  assert.doesNotMatch(a.message, /sponsored/);
  assert.match(sponsorHtml(sponsorView({})), /data-motm-sponsor-line>Man of the Match, sponsored by <strong>Mr\. Moses Orkuma/);
});

test('no valid votes gives "no winner"', () => {
  const players = candidates(squad, [], 'home', Date.parse(KO));
  const a = announcementView(announcementData(tally({ votes: [v('a', 120)], players, opensAt: W.opensAt, closesAt: W.closesAt }), at(110)), { opponent: 'X' });
  assert.equal(a.winner, null); assert.equal(a.message, 'No Man of the Match this game.');
  assert.match(cardHtml({ status: 'closed', opponent: 'X', announcement: a, archive: [] }), /No Man of the Match this game\./);
});

test('no kick-off time entered (midnight): voting and Predict & Win use 4:00 pm Nigerian time', async () => {
  const { predictionWindow } = await import('../functions/api/_lib/predict.js');
  const noTime = home({ event_date: '2026-11-21T23:00:00.000Z' }); // 22 Nov, 00:00 in Lagos
  const w = votingWindow(noTime, Date.parse('2026-11-22T10:00:00Z'));
  assert.equal(w.status, 'upcoming');
  assert.equal(w.opensAt, '2026-11-22T15:00:00.000Z'); assert.equal(clubTime(w.opensAt), '4:00 pm'); assert.equal(clubTime(w.closesAt), '5:50 pm');
  assert.equal(new Date(predictionWindow(noTime).closesAt).toISOString(), '2026-11-22T15:00:00.000Z', 'predictions close at 4:00 pm');
  assert.equal(new Date(predictionWindow(home()).closesAt).toISOString(), KO, 'a real kick-off time is used as it is');
});
