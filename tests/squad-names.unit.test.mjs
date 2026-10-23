// Squad names, ages, heights and the form rules (22 Oct 2026), without a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicName, officialName, shortName, splitFullName, migrateName, tidyName, partsFromName } from '../src/lib/names.js';
import { longDate, ageFrom, birthLine, heightText, heightToCm } from '../src/lib/format.js';
import { FIELDS, FIELD, fieldsFor, missingForSubmit, cleanValue, shareable, labelOf, upgradeData, NEVER_SHARED } from '../src/lib/squadFields.js';
import { countryName, flagUrl, countryFromText } from '../src/lib/countries.js';
import { existsSync } from 'node:fs';

const musa = { surname: 'Adeyemi', firstName: 'Musa', middleName: 'Ibrahim' };

test('name helpers: public name, official name (SURNAME, First Middle), short name, and the "Name on website" override', () => {
  assert.equal(publicName(musa), 'Musa Adeyemi');
  assert.equal(officialName(musa), 'ADEYEMI, Musa Ibrahim');
  assert.equal(officialName({ surname: 'Adeyemi', firstName: 'Musa' }), 'ADEYEMI, Musa');
  assert.equal(shortName(musa), 'Adeyemi');
  assert.equal(publicName({ ...musa, websiteName: 'Musa Baba' }), 'Musa Baba', 'the website name wins');
  assert.equal(officialName({ ...musa, websiteName: 'Musa Baba' }), 'ADEYEMI, Musa Ibrahim', 'official names never use it');
  assert.equal(tidyName('ADEYEMI'), 'Adeyemi'); assert.equal(tidyName("o'neil-ade"), "O'Neil-Ade"); assert.equal(tidyName('McDonald'), 'McDonald');
  assert.deepEqual(partsFromName('Terver Joseph Iorliam'), { firstName: 'Terver', surname: 'Iorliam', middleName: 'Joseph' });
});

test('splitting old full names: 2 words high confidence; 3+ words or unclear order "needs review"; nothing silent', () => {
  assert.deepEqual(splitFullName('Musa Adeyemi'), { surname: 'Adeyemi', firstName: 'Musa', middleName: '', confidence: 'high', reason: 'Two names: first name, then surname.' });
  assert.equal(splitFullName('ADEYEMI, Musa Ibrahim').confidence, 'high');
  assert.equal(splitFullName('ADEYEMI, Musa Ibrahim').surname, 'Adeyemi');
  const three = splitFullName('Musa Ibrahim Adeyemi');
  assert.equal(three.confidence, 'needs review'); assert.equal(three.middleName, 'Ibrahim');
  assert.equal(splitFullName('Musa').confidence, 'needs review');
  assert.equal(splitFullName('').confidence, 'needs review');
});

test('name migration: Nigerian order only where the old full name clearly used it, otherwise the display name as "First Surname"', () => {
  assert.deepEqual(migrateName('ADEYEMI, Musa Ibrahim', 'Musa Adeyemi').surname, 'Adeyemi');
  assert.deepEqual(migrateName('ADEYEMI Musa Ibrahim', '').firstName, 'Musa');
  const m = migrateName('Adeyemi Musa Ibrahim', 'Musa Adeyemi');
  assert.deepEqual([m.surname, m.firstName, m.middleName], ['Adeyemi', 'Musa', 'Ibrahim']);
  const d = migrateName('Musa Ibrahim Adeyemi', 'Musa Adeyemi');
  assert.deepEqual([d.surname, d.firstName, d.middleName], ['Adeyemi', 'Musa', 'Ibrahim']); assert.match(d.rule, /display name/);
  assert.deepEqual([migrateName('', 'Chidi Okon').firstName, migrateName('', 'Chidi Okon').surname], ['Chidi', 'Okon']);
});

test('age (Africa/Lagos), height and dates', () => {
  assert.equal(ageFrom('2007-04-24', '2026-04-23'), 18); assert.equal(ageFrom('2007-04-24', '2026-04-24'), 19);
  assert.equal(ageFrom('2008-02-29', '2026-02-28'), 17); assert.equal(ageFrom('bad'), null);
  assert.equal(longDate('2007-04-24'), '24 April, 2007'); assert.equal(longDate('2025-08'), 'August 2025');
  assert.equal(birthLine('2007-04-24', '2026-10-22'), '24 April, 2007 (age 19)');
  assert.equal(heightText(178), '1.78m (5ft 10in)'); assert.equal(heightText(183), '1.83m (6ft 0in)'); assert.equal(heightText(190), '1.90m (6ft 3in)');
  assert.equal(heightText(''), ''); assert.equal(heightToCm('1.80 m'), 180); assert.equal(heightToCm('175cm'), 175);
});

test('form: surname and first name required, middle name optional; Display name and pronunciation gone (old answers kept, never saved again)', () => {
  const form = fieldsFor('player').map(f => f.key);
  assert.deepEqual(form.slice(0, 3), ['surname', 'firstName', 'middleName']);
  for (const k of ['fullName', 'displayName', 'pronunciation', 'roleModel']) assert.ok(!form.includes(k), `${k} not on the form`);
  assert.ok(FIELD.fullName && FIELD.displayName && FIELD.pronunciation, 'old questions kept so old answers can be read');
  const missing = missingForSubmit('player', {}).map(m => m.key);
  assert.ok(missing.includes('surname') && missing.includes('firstName')); assert.ok(!missing.includes('middleName'));
  assert.equal(cleanValue('displayName', 'x').error, 'This question is no longer used.');
  assert.equal(cleanValue('pronunciation', 'x').error, 'This question is no longer used.');
  assert.match(cleanValue('surname', 'Adeyemi2').error, /letters only/);
  assert.equal(cleanValue('heightCm', 139).error ? 'bad' : 'ok', 'bad'); assert.equal(cleanValue('heightCm', 221).error ? 'bad' : 'ok', 'bad');
  assert.equal(labelOf(FIELD.interestingFact, 'player'), 'An interesting fact about the player');
  assert.equal(labelOf(FIELD.interestingFact, 'staff'), 'An interesting fact about the coach');
  assert.equal(FIELD.surname.hint, 'As it appears on official documents.');
  assert.equal(FIELD.surname.use, 'public'); assert.equal(FIELD.firstName.use, 'public'); assert.equal(FIELD.middleName.use, 'private', 'middle name is private');
  assert.equal(labelOf(FIELD.interestingFact, 'staff', { role: 'Kit Manager' }), 'An interesting fact about the staff member');
  assert.equal(labelOf(FIELD.interestingFact, 'staff', { role: 'Assistant Coach' }), 'An interesting fact about the coach');
  assert.ok(!fieldsFor('player').some(f => f.admin), 'club-only fields are not on the portal form');
  assert.ok(!fieldsFor('staff').some(f => f.key === 'shirtNumber'), 'no jersey number for staff');
});

test('publishing: private details never; full date of birth and middle name only from 18; countries as codes with local flags', () => {
  const data = { ...musa, dob: '2010-05-05', phone: '+2348030000000', email: 'a@b.co', emergencyName: 'X', guardianName: 'Y', fullName: 'Old Name', displayName: 'Old', pronunciation: 'oh', nationality: 'NG' };
  const minor = shareable('player', data);
  for (const k of [...NEVER_SHARED, 'dob', 'middleName']) assert.ok(!(k in minor), `${k} not shared for an under-18`);
  assert.equal(minor.age, 16);
  const adult = shareable('player', { ...data, dob: '1999-05-05' });
  assert.equal(adult.dob, '1999-05-05'); assert.ok(!('middleName' in adult), 'middle name never shared, even from 18');
  for (const k of NEVER_SHARED) assert.ok(!(k in adult), `${k} never shared`);
  assert.equal(countryName('NG'), 'Nigeria'); assert.equal(flagUrl('ng'), '/flags/ng.svg'); assert.ok(existsSync(new URL('../public/flags/ng.svg', import.meta.url)));
  assert.equal(countryFromText('Nigerian'), 'NG'); assert.equal(countryFromText('Ghana'), 'GH');
  assert.deepEqual(upgradeData('player', { nationality: 'Nigerian', primaryPosition: 'Striker' }), { nationality: 'NG', primaryPosition: 'Striker', positionGroup: 'Forward' });
  assert.ok(FIELDS.every(f => f.use), 'every field says where it may go');
});
