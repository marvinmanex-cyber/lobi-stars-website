// Squad Phases 5-6: careers worked out from the official match records
// (season and total, debut, first goal, awards, milestones, shirt numbers),
// milestones -> draft story suggestions in the Media Centre, verified and
// upcoming milestones in the partner feed (schema 1.4), the coach record,
// the Squad page highlights, and the data rules (media-only fields, staff age).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './media-helpers.mjs';
import { validatePackage, SCHEMA_VERSION } from '../src/lib/squadPackage.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET || 'cron-test-secret'}` };
const KEY = process.env.LOBI_PARTNER_API_KEY || 'partner-test-key';
const T = Math.random().toString(36).slice(2, 7).replace(/\d/g, 'c');
const rows = q => JSON.parse(sql(q))[0].results;
let P; // a live player of the local squad
const days = n => new Date(Date.now() - n * 86400e3).toISOString();
const EV = [1, 2, 3].map(i => `car-${T}-${i}`);

before(() => {
  P = rows(`SELECT id, person_id, public_slug, data_json FROM squad_profiles WHERE type = 'player' AND status = 'LIVE' AND public_slug IS NOT NULL ORDER BY public_slug LIMIT 1;`)[0];
  assert.ok(P, 'the local database needs one live player');
  sql(`INSERT INTO events (id, home_team, away_team, competition, event_date, venue, vip_price_kobo, premium_price_kobo, regular_price_kobo, active) VALUES
    ('${EV[0]}', 'Lobi Stars FC', 'Alpha ${T}', 'NNL', '${days(9)}', 'McCarthy Stadium', 1, 1, 1, 1),
    ('${EV[1]}', 'Beta ${T}', 'Lobi Stars FC', 'NNL', '${days(6)}', 'Away', 1, 1, 1, 1),
    ('${EV[2]}', 'Lobi Stars FC', 'Gamma ${T}', 'NNL', '${days(3)}', 'McCarthy Stadium', 1, 1, 1, 1);
    INSERT INTO match_centre (event_id, status, home_score, away_score) VALUES ('${EV[0]}', 'full-time', 2, 0), ('${EV[1]}', 'full-time', 1, 3), ('${EV[2]}', 'full-time', 1, 1);
    INSERT INTO player_match_stats (event_id, player_slug, played, started, goals, assists, yellow, red, minutes) VALUES
    ('${EV[0]}', '${P.public_slug}', 1, 1, 1, 0, 0, 0, 90), ('${EV[1]}', '${P.public_slug}', 1, 1, 3, 0, 1, 0, 90), ('${EV[2]}', '${P.public_slug}', 1, 0, 0, 1, 0, 0, 25);
    DELETE FROM mc_settings WHERE key = 'milestones_last';`);
});
after(() => {
  sql(`DELETE FROM player_match_stats WHERE event_id IN ('${EV.join("','")}'); DELETE FROM match_centre WHERE event_id IN ('${EV.join("','")}'); DELETE FROM events WHERE id IN ('${EV.join("','")}');
    DELETE FROM mc_revisions WHERE item_id IN (SELECT id FROM mc_items WHERE created_by = 'system'); DELETE FROM mc_items WHERE created_by = 'system';
    DELETE FROM squad_milestones WHERE slug = '${P.public_slug}'; DELETE FROM mc_settings WHERE key = 'milestones_last';`);
});

test('the career from the match records: totals, seasons, debut, first goal, milestones (upcoming kept private)', async () => {
  const d = await fetch(`${BASE}/api/squad/career?player=${P.public_slug}`).then(r => r.json());
  assert.ok(d.total.apps >= 3 && d.total.goals >= 4, JSON.stringify(d.total));
  assert.ok(d.total.subs >= 1, 'a substitute appearance');
  assert.ok(d.seasons.length >= 1 && d.seasons[0].season);
  assert.ok(d.debut && d.firstGoal);
  const keys = d.milestones.map(m => m.key);
  for (const k of ['debut', 'first_goal', 'first_assist']) assert.ok(keys.includes(k), `milestone ${k}`);
  assert.ok(keys.some(k => k.startsWith('hattrick_')), 'hat-trick');
  assert.equal(d.upcoming, undefined, 'upcoming milestones are not public');
  assert.match(d.note, /Stats updated automatically from official match records/);
  assert.ok(Array.isArray(d.shirts));
});

test('new recent milestones become DRAFT story suggestions in the Media Centre (never published)', async () => {
  const run = await fetch(`${BASE}/api/internal/newsletter-run`, { method: 'POST', headers: CRON }).then(r => r.json());
  assert.ok(run.media.milestones && run.media.milestones.recorded >= 4, JSON.stringify(run.media));
  const sugg = rows(`SELECT title, status, kind FROM mc_items WHERE created_by = 'system';`);
  assert.ok(sugg.length >= 4); assert.ok(sugg.every(s => s.status === 'draft' && s.kind === 'news'));
  assert.ok(sugg.some(s => /makes Lobi Stars debut/.test(s.title)) && sugg.some(s => /Hat-trick for/.test(s.title)));
  sql(`DELETE FROM mc_settings WHERE key = 'milestones_last';`);
  const again = await fetch(`${BASE}/api/internal/newsletter-run`, { method: 'POST', headers: CRON }).then(r => r.json());
  assert.equal(again.media.milestones.recorded, 0, 'each milestone only once');
  const third = await fetch(`${BASE}/api/internal/newsletter-run`, { method: 'POST', headers: CRON }).then(r => r.json());
  assert.equal(third.media.milestones.skipped, true, 'at most every 10 minutes');
});

test('partner feed 1.5: verified milestones and upcoming ones; availability', async () => {
  const doc = await fetch(`${BASE}/api/partner/squad`, { headers: { Authorization: `Bearer ${KEY}` } }).then(r => r.json());
  assert.equal(doc.schemaVersion, '1.5'); assert.equal(SCHEMA_VERSION, '1.5');
  assert.deepEqual(validatePackage(doc), []);
  const me = doc.players.find(p => p.id === P.id);
  assert.ok(me, 'the player is in the feed');
  assert.ok(me.milestones.some(m => m.key === 'debut' && /^\d{4}-\d{2}-\d{2}$/.test(m.date)));
  assert.ok(Array.isArray(me.upcomingMilestones));
  assert.ok(me.upcomingMilestones.some(m => /goal.* away from 5/.test(m.label)) || me.milestones.some(m => m.key === 'goals_5'), 'near the 5-goal milestone');
  assert.ok(['Available', 'Unavailable', ''].includes(me.availability));
});

test('Squad page highlights and data rules (hometown and interesting fact are media only; coach ages hidden by default)', async () => {
  const h = await fetch(`${BASE}/api/squad/highlights`).then(r => r.json());
  assert.ok(h.players[P.public_slug]?.goals >= 4, 'this season\'s goals for the badge');
  const pub = await fetch(`${BASE}/api/squad/public`).then(r => r.json());
  assert.ok(pub.players.every(p => p.hometown === undefined && p.interestingFact === undefined), 'not in the public feed');
  assert.ok(pub.staff.every(s => s.age === null && s.dob === null), 'staff ages hidden by default');
  const page = await fetch(`${BASE}/squad/`).then(r => r.text());
  assert.match(page, /data-sq-tab="g-/, 'position tabs on the Squad page');
  const coach = pub.staff.find(s => /Head Coach|Assistant Coach/.test(s.role));
  if (coach) {
    const r = await fetch(`${BASE}/api/squad/career?staff=${coach.slug}`).then(x => x.json());
    assert.ok(r.record && Number.isInteger(r.record.matches), 'coach record');
  }
});
