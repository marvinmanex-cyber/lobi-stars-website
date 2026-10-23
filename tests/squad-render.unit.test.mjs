// The Squad pages' shared markup (src/lib/squadRender.js): the same HTML at build
// time and on the server; text is escaped; empty squad message; groups in order;
// no number for coaches; a bio's "## " lines become headings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personFromFeed, renderList, renderProfile, renderCard, bioHtml, sortPlayers, neighbours, profileDescription } from '../src/lib/squadRender.js';

const pl = (n, first, sur, group, extra = {}) => personFromFeed({ slug: `${first}-${sur}`.toLowerCase(), name: `${first} ${sur}`, firstName: first, surname: sur, number: n, group, position: 'Striker', nationality: 'NG', ...extra }, 'player');

test('list: empty message, groups in order, escaped names', () => {
  assert.match(renderList({ players: [], staff: [], season: '2026/27' }), /The squad for the 2026\/27 season will be announced soon\./);
  const list = sortPlayers([pl(9, 'Musa', 'Adeyemi', 'FWD'), pl(1, 'Ade', 'Keeper', 'GK'), pl(5, 'Tom', '<b>Bad</b>', 'DEF')]);
  const html = renderList({ players: list, staff: [], season: '2026/27' });
  assert.ok(html.indexOf('g-GK') < html.indexOf('g-DEF') && html.indexOf('g-DEF') < html.indexOf('g-FWD'));
  assert.ok(!html.includes('<b>Bad</b>') && html.includes('&lt;b&gt;Bad&lt;/b&gt;'), 'escaped');
});

test('profile: number for players only, bio headings, neighbours, description', () => {
  const coach = personFromFeed({ slug: 'terver-iorliam', name: 'Terver Iorliam', firstName: 'Terver', surname: 'Iorliam', role: 'Head Coach', licence: 'CAF A' }, 'staff');
  assert.ok(!renderProfile(coach, { season: '2026/27' }).includes('pf-num'));
  const p = pl(9, 'Musa', 'Adeyemi', 'FWD', { bio: '## Early years\nBorn in Makurdi.\n\nJoined in 2023.' });
  const html = renderProfile(p, { season: '2026/27' });
  assert.match(html, /class="pf-num"[^>]*>9</); assert.match(html, /<h3>Early years<\/h3><p>Born in Makurdi\.<\/p><p>Joined in 2023\.<\/p>/);
  assert.equal(bioHtml(''), '');
  const list = [pl(1, 'A', 'One', 'FWD'), p, pl(11, 'C', 'Three', 'FWD')];
  const n = neighbours(list, p);
  assert.equal(n.prev.slug, 'a-one'); assert.equal(n.next.slug, 'c-three'); assert.equal(n.teammates.length, 2);
  assert.match(profileDescription(p), /^Born in Makurdi\. Joined in 2023\./);
  assert.match(renderCard(p), /href="\/squad\/musa-adeyemi\/"/);
});
