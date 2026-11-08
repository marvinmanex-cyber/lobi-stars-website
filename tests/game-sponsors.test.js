// Matchday Live game sponsors (no server needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, publicSponsor } from '../functions/api/_lib/gameSponsors.js';
import { predictSponsorHtml } from '../functions/predict-and-win/index.js';

test('Predict & Win sponsor: Prime Beverages & Logistics Ltd by default, name only until a picture is added', () => {
  assert.equal(GAMES.predict.key, 'predict_sponsor');
  assert.equal(GAMES.predict.defaults.name, 'Prime Beverages & Logistics Ltd');
  const html = predictSponsorHtml(publicSponsor(GAMES.predict.defaults));
  assert.match(html, /data-predict-sponsor-line>Predict &amp; Win, sponsored by <strong>Prime Beverages &amp; Logistics Ltd<\/strong>/);
  assert.doesNotMatch(html, /<img/, 'no picture: name only');
});

test('with a logo the picture shows; with Show sponsor off nothing shows', () => {
  const html = predictSponsorHtml(publicSponsor({ ...GAMES.predict.defaults, photoUrl: '/api/media-file/abc123' }));
  assert.match(html, /<img data-predict-sponsor src="\/api\/media-file\/abc123" alt="Prime Beverages &amp; Logistics Ltd"/);
  assert.equal(publicSponsor({ ...GAMES.predict.defaults, show: false }), null);
  assert.equal(predictSponsorHtml(null), '');
});

test('Man of the Match keeps its own sponsor record', () => {
  assert.equal(GAMES.motm.key, 'motm_sponsor');
  assert.equal(GAMES.motm.defaults.name, 'Mr. Moses Orkuma');
});
