// Squad & Staff Data Portal: the Data Package format (data.json, schemaVersion
// 1.1). Used by the partner API (/api/partner/squad) and every portal / admin
// export, so they always match. Only Public and Media fields: nothing Private
// (phone, email, emergency contact, guardian) can get in, because only the keys
// below are copied. The full date of birth and middle name only from age 18.
// 1.1 (22 Oct 2026): name in parts (surname, firstName, officialName, shortName),
// countries as ISO codes and names, place of birth, national team, international
// career, debut, bio, hero photo, social links; name pronunciation removed.
import { ageOn, isAdult, nameOf, profileName, groupOf } from './squadFields.js';
import { officialName, shortName } from './names.js';
import { countryName } from './countries.js';

export const SCHEMA_VERSION = '1.1';
const STATUS = { VERIFIED: 'verified', SUBMITTED: 'submitted', LEFT_THE_CLUB: 'left_the_club', CHANGES_REQUESTED: 'submitted', DRAFT: 'draft' };
const s = v => (v == null ? '' : String(v));
const n = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/** Lagos time with its offset, e.g. 2026-10-22T11:42:00+01:00. */
export function lagosIso(d = new Date()) {
  const t = new Date(new Date(d).getTime() + 3600e3).toISOString().slice(0, 19);
  return `${t}+01:00`;
}

const country = c => ({ code: s(c), name: countryName(c) });
/** What every person has (players and staff). */
function personJson(p, files) {
  const d = p.data || {}, adult = isAdult(d);
  const nm = nameOf(adult ? d : { ...d, middleName: '' });
  return {
    id: p.id, status: STATUS[p.status] || 'submitted', updatedAt: lagosIso(p.updatedAt),
    displayName: profileName(d), surname: s(d.surname), firstName: s(d.firstName), officialName: officialName(nm), shortName: shortName(nm), nickname: s(d.nickname),
    dateOfBirth: adult ? s(d.dob) : '', age: d.dob ? ageOn(d.dob) : (Number.isInteger(d.age) ? d.age : null),
    nationality: country(d.nationality), secondNationality: country(d.nationality2), placeOfBirth: { town: s(d.birthTown), country: country(d.birthCountry) },
    stateOfOrigin: s(d.stateOfOrigin), hometown: s(d.hometown), social: { instagram: s(d.socialInstagram), x: s(d.socialX), tiktok: s(d.socialTiktok) },
    honours: (d.honours || []).map(r => ({ title: s(r.title), seasonOrYear: s(r.seasonOrYear), clubOrTeam: s(r.clubOrTeam) })),
    bio: { headline: s(d.bioHeadline), text: s(d.bio) },
  };
}
export function playerJson(p, files) {
  const d = p.data || {};
  return {
    ...personJson(p, files),
    shirtNumber: n(d.shirtNumber), positionGroup: s(d.positionGroup || groupOf(d.primaryPosition)), primaryPosition: s(d.primaryPosition),
    secondaryPositions: Array.isArray(d.secondaryPositions) ? d.secondaryPositions.map(String) : [], preferredFoot: s(d.preferredFoot), heightCm: n(d.heightCm),
    joinedClub: s(d.joined), debut: s(d.debutDate), nationalTeam: country(d.nationalTeam),
    previousClubs: (d.previousClubs || []).map(r => ({ club: s(r.club), country: country(r.country), startYear: n(r.startYear), endYear: n(r.endYear) })),
    internationalCareer: (d.internationalCareer || []).map(r => ({ level: s(r.level), caps: n(r.caps), goals: n(r.goals), tournaments: s(r.tournaments) })),
    notes: { careerHighlight: s(d.careerHighlight), roleModel: s(d.roleModel), interestingFact: s(d.interestingFact) },
    photos: { profile: files.photo(p, 'profile'), action: p.hasAction ? files.photo(p, 'action') : null, hero: p.hasHero ? files.photo(p, 'hero') : null },
  };
}
export function staffJson(p, files) {
  const d = p.data || {};
  return {
    ...personJson(p, files),
    role: d.role === 'Other' ? s(d.roleOther) : s(d.role), joinedClub: s(d.joinedStaff), licence: s(d.qualifications), playingCareer: s(d.playingCareer),
    previousRoles: (d.previousRoles || []).map(r => ({ club: s(r.club), position: s(r.position), period: s(r.period) })),
    notes: { philosophy: s(d.philosophy), careerHighlight: s(d.careerHighlight), interestingFact: s(d.interestingFact) },
    photos: { profile: files.photo(p, 'profile'), hero: p.hasHero ? files.photo(p, 'hero') : null },
  };
}

export const POSITION_ORDER = ['Goalkeeper', 'Right back', 'Centre back', 'Left back', 'Defensive midfielder', 'Central midfielder', 'Attacking midfielder', 'Right winger', 'Left winger', 'Striker'];
export const ROLE_ORDER = ['Head Coach', 'Assistant Coach', 'Goalkeeper Trainer', 'Fitness Coach', 'Team Manager', 'Team Doctor', 'Physiotherapist', 'Kit Manager', 'Media Officer', 'Other'];
const GROUP_ORDER = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
const posIdx = (g, x) => { const a = GROUP_ORDER.indexOf(g), i = POSITION_ORDER.indexOf(x); return (a < 0 ? 9 : a) * 100 + (i < 0 ? 99 : i); };
const roleIdx = x => { const i = ROLE_ORDER.indexOf(x); return i < 0 ? ROLE_ORDER.length : i; };
/** Players by position group, then position, then shirt number; staff by role. */
export function sortPlayers(list) { return [...list].sort((a, b) => posIdx(a.positionGroup, a.primaryPosition) - posIdx(b.positionGroup, b.primaryPosition) || (a.shirtNumber ?? 999) - (b.shirtNumber ?? 999) || a.displayName.localeCompare(b.displayName)); }
export function sortStaff(list) { return [...list].sort((a, b) => roleIdx(a.role) - roleIdx(b.role) || a.displayName.localeCompare(b.displayName)); }

/** The whole data.json. */
export function buildPackage({ profiles, team, season, filters, files, exportedAt = new Date() }) {
  const players = sortPlayers(profiles.filter(p => p.type === 'player').map(p => playerJson(p, files)));
  const staff = sortStaff(profiles.filter(p => p.type === 'staff').map(p => staffJson(p, files)));
  return { schemaVersion: SCHEMA_VERSION, exportedAt: lagosIso(exportedAt), source: 'lobistarsfc.com', season, filters, team, players, staff };
}

// ── JSON Schema for data.json (also checked before every download) ──
const str = { type: 'string' }, strN = { type: ['string', 'null'] }, intN = { type: ['integer', 'null'] };
const obj = (props, req = Object.keys(props)) => ({ type: 'object', additionalProperties: false, required: req, properties: props });
const cty = obj({ code: { type: 'string', pattern: '^([A-Z]{2}(-[A-Z]{3})?)?$' }, name: str });
const honours = { type: 'array', items: obj({ title: str, seasonOrYear: str, clubOrTeam: str }) };
const common = {
  id: { type: 'string', minLength: 1 }, status: { enum: ['verified', 'submitted', 'left_the_club', 'draft'] }, updatedAt: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\+01:00$' },
  displayName: { type: 'string', minLength: 1 }, surname: str, firstName: str, officialName: str, shortName: str, nickname: str,
  dateOfBirth: { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' }, age: intN, nationality: cty, secondNationality: cty, placeOfBirth: obj({ town: str, country: cty }),
  stateOfOrigin: str, hometown: str, social: obj({ instagram: str, x: str, tiktok: str }), joinedClub: { type: 'string', pattern: '^(\\d{4}-\\d{2})?$' }, honours,
  bio: obj({ headline: str, text: { type: 'string', maxLength: 5000 } }),
};
const COMMON_REQ = Object.keys(common);
export const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://lobistarsfc.com/schemas/squad-data-package-1.1.json',
  title: 'Lobi Stars FC – Media Partner Data Package (data.json)', type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'exportedAt', 'source', 'season', 'filters', 'team', 'players', 'staff'],
  properties: {
    schemaVersion: { const: SCHEMA_VERSION }, exportedAt: { type: 'string' }, source: { const: 'lobistarsfc.com' }, season: str,
    filters: { type: 'object', required: ['status', 'type'], properties: { status: str, type: str, season: str } },
    team: { type: 'object', required: ['id', 'name', 'shortName', 'nickname', 'crest', 'kitColours', 'stadium', 'city', 'state', 'competition'],
      properties: { id: str, name: str, shortName: str, nickname: str, crest: str, kitColours: { type: 'object', required: ['home', 'away'], properties: { home: { type: 'array', items: str }, away: { type: 'array', items: str } } }, stadium: str, city: str, state: str, competition: str } },
    players: { type: 'array', items: obj({ ...common, shirtNumber: { type: ['integer', 'null'], minimum: 1, maximum: 99 }, positionGroup: { enum: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward', ''] }, primaryPosition: str,
      secondaryPositions: { type: 'array', items: str }, preferredFoot: str, heightCm: intN, debut: { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' }, nationalTeam: cty,
      previousClubs: { type: 'array', items: obj({ club: str, country: cty, startYear: intN, endYear: intN }) },
      internationalCareer: { type: 'array', items: obj({ level: str, caps: intN, goals: intN, tournaments: str }) },
      notes: obj({ careerHighlight: { type: 'string', maxLength: 300 }, roleModel: { type: 'string', maxLength: 300 }, interestingFact: { type: 'string', maxLength: 300 } }),
      photos: obj({ profile: strN, action: strN, hero: strN }) }) },
    staff: { type: 'array', items: obj({ ...common, role: str, licence: str, playingCareer: str,
      previousRoles: { type: 'array', items: obj({ club: str, position: str, period: str }) },
      notes: obj({ philosophy: { type: 'string', maxLength: 300 }, careerHighlight: { type: 'string', maxLength: 300 }, interestingFact: { type: 'string', maxLength: 300 } }),
      photos: obj({ profile: strN, hero: strN }) }) },
  },
};
export { COMMON_REQ };

/**
 * A small checker for SCHEMA (the parts it uses: type, required, properties,
 * additionalProperties, items, enum, const, pattern, min/maxLength, minimum/maximum).
 * Returns a list of problems like "players[3] (Musa Adeyemi).shirtNumber: …".
 */
export function validatePackage(doc, schema = SCHEMA) {
  const errs = [];
  const typeOk = (v, t) => [].concat(t).some(x => x === 'null' ? v === null : x === 'integer' ? Number.isInteger(v) : x === 'array' ? Array.isArray(v) : x === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : typeof v === x);
  const walk = (v, sc, path, who) => {
    const at = `${path}${who ? ` (${who})` : ''}`;
    if (sc.const !== undefined && v !== sc.const) errs.push(`${at}: must be ${JSON.stringify(sc.const)}`);
    if (sc.enum && !sc.enum.includes(v)) errs.push(`${at}: "${v}" is not allowed`);
    if (sc.type && !typeOk(v, sc.type)) { errs.push(`${at}: should be ${[].concat(sc.type).join(' or ')}`); return; }
    if (typeof v === 'string') {
      if (sc.minLength && v.length < sc.minLength) errs.push(`${at}: is empty`);
      if (sc.maxLength && v.length > sc.maxLength) errs.push(`${at}: longer than ${sc.maxLength} characters`);
      if (sc.pattern && !new RegExp(sc.pattern).test(v)) errs.push(`${at}: "${v}" is not in the right format`);
    }
    if (typeof v === 'number') {
      if (sc.minimum !== undefined && v < sc.minimum) errs.push(`${at}: below ${sc.minimum}`);
      if (sc.maximum !== undefined && v > sc.maximum) errs.push(`${at}: above ${sc.maximum}`);
    }
    if (sc.properties && v && typeof v === 'object') {
      for (const r of sc.required || []) if (!(r in v)) errs.push(`${path}.${r}${who ? ` (${who})` : ''}: missing`);
      for (const [k, x] of Object.entries(v)) {
        if (sc.properties[k]) walk(x, sc.properties[k], `${path}.${k}`, who);
        else if (sc.additionalProperties === false) errs.push(`${path}.${k}${who ? ` (${who})` : ''}: not allowed in the Data Package`);
      }
    }
    if (sc.items && Array.isArray(v)) v.forEach((x, i) => walk(x, sc.items, `${path}[${i}]`, who || x?.displayName));
  };
  walk(doc, schema, 'data', '');
  return errs;
}
