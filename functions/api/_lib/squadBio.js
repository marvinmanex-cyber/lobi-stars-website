// Squad profiles › "Draft bio with Claude" (Super Admins, on the review page).
// Claude only drafts: the preview is shown with a "check the facts" warning and
// nothing is saved until a Super Admin puts it in the Bio box and presses Save.
// Uses the same connection, budget guard and usage log as every other Claude
// feature (claude.js). Only the public facts in the record are sent, plus what
// the Super Admin types in "Extra details" (emails and phone numbers removed):
// never phone, email, address, ID, salary, medical details or next of kin.
import { callClaude, scrubPersonal, logFix } from './claude.js';
import { getProfile, parseJson, rowName, logProfile } from './squadProfiles.js';
import { profileName, nameOf } from '../../../src/lib/squadFields.js';
import { officialName } from '../../../src/lib/names.js';
import { countryName } from '../../../src/lib/countries.js';

const VOICE = 'You write for the website of Lobi Stars FC, a Nigerian professional football club from Makurdi, Benue State ("Pride of Benue"). '
  + 'Club voice: warm, proud and confident, in clear British English for Nigerian fans; short sentences; no hype words like "legendary" unless the facts show it.';
const RULES = [
  'Write an engaging, story-style profile with a short headline of 2 to 5 words (e.g. "Accomplished keeper").',
  'Write 3 to 6 short paragraphs (2 to 4 sentences each), separated by an empty line. Plain text only: no Markdown, no lists, no emoji.',
  'Use ONLY the facts given. NEVER invent facts, achievements, statistics, goals, caps, transfer fees, quotes, injuries, family details or dates.',
  'Do not mention the date of birth or exact age, phone numbers, addresses or anything private.',
  'If the facts are thin, write a shorter bio (even 2 paragraphs) and list in "missing" the extra details that would improve it (e.g. "how he joined Lobi Stars", "a favourite moment").',
].join(' ');
const SCHEMA = {
  headline: { type: 'string', min: 3, max: 60 },
  bio: { type: 'string', min: 80, max: 3000, multiline: true },
  missing: { type: 'string', max: 400, optional: true },
};

/** The facts Claude may use: public details of the record only. */
export function bioFacts(type, d) {
  const c = x => countryName(x) || undefined;
  const facts = {
    name: profileName(d), officialName: officialName({ ...nameOf(d), middleName: '' }), nickname: d.nickname || undefined,
    kind: type === 'staff' ? 'coach / staff member' : 'player',
    position: type === 'player' ? d.primaryPosition || d.positionGroup || undefined : undefined,
    role: type === 'staff' ? (d.role === 'Other' ? d.roleOther : d.role) || undefined : undefined,
    shirtNumber: type === 'player' ? d.shirtNumber ?? undefined : undefined,
    nationality: c(d.nationality), secondNationality: c(d.nationality2), nationalTeam: d.intlVerified ? c(d.nationalTeam) : undefined,
    placeOfBirth: [d.birthTown, c(d.birthCountry)].filter(Boolean).join(', ') || undefined,
    stateOfOrigin: d.stateOfOrigin || undefined, hometown: d.hometown || undefined,
    preferredFoot: d.preferredFoot || undefined,
    joinedLobiStars: d.joined || d.joinedStaff || undefined, lobiStarsDebut: d.debutDate || undefined,
    previousClubs: (d.previousClubs || []).map(r => ({ club: r.club, country: c(r.country), from: r.startYear || undefined, to: r.endYear || undefined })),
    previousRoles: (d.previousRoles || []).map(r => ({ club: r.club, position: r.position, period: r.period })),
    internationalCareer: (d.intlVerified ? d.internationalCareer || [] : []).map(r => ({ level: r.level, caps: r.caps ?? undefined, goals: r.goals ?? undefined, tournaments: r.tournaments || undefined })),
    honours: (d.honours || []).map(h => [h.title, h.seasonOrYear, h.clubOrTeam].filter(Boolean).join(', ')),
    coachingLicence: type === 'staff' ? d.qualifications || undefined : undefined,
    playingCareer: type === 'staff' ? d.playingCareer || undefined : undefined,
    interestingFact: d.interestingFact || undefined, careerHighlight: d.careerHighlight || undefined,
  };
  for (const [k, v] of Object.entries(facts)) if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete facts[k];
  return facts;
}

export async function draftBio(env, admin, id, extra = '') {
  const p = await getProfile(env.DB, id);
  if (!p) return { error: 'Profile not found.', status: 404 };
  const d = parseJson(p.data_json, {});
  if (!profileName(d)) return { error: 'Add the name first.', status: 400 };
  const typed = scrubPersonal(String(extra || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()).slice(0, 1500);
  const facts = bioFacts(p.type, d);
  const prompt = `${RULES}\nFacts from the club record: ${JSON.stringify(facts)}\nExtra details from the club: ${typed || '(none)'}`;
  const r = await callClaude(env, { feature: 'squad_bio', system: VOICE, prompt, schema: SCHEMA, maxTokens: 1200, adminId: admin?.id, relatedId: `squad:${p.id}` });
  if (!r.ok) return { error: r.error, status: r.budget ? 402 : 502 };
  const proposal = { headline: r.data.headline, bio: r.data.bio, missing: r.data.missing || '', ...(r.mock ? { mock: true } : {}) };
  await logFix(env.DB, { recId: `squad:${p.id}`, fixType: 'squad_bio', action: 'prepared', admin, detail: rowName(p), after: proposal });
  await logProfile(env.DB, admin, 'squad_bio_draft', `${admin.name} asked Claude to draft a bio for ${rowName(p) || 'a profile'} (not saved until approved)`);
  return { ok: true, proposal, factsUsed: Object.keys(facts) };
}
