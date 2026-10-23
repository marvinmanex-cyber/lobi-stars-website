// The Squad pages read players and coaching staff through here, so verified
// portal profiles and hand-made Content CMS entries look the same. Names always
// come from the helpers in names.js (publicName / officialName / shortName).
// Only public details are here: the full date of birth only from age 18.
import type { CollectionEntry } from 'astro:content';
import { getPlayers, getCoaches } from './players';
import { publicName, officialName, shortName, partsFromName, nameSlug } from './names.js';
import { countryFromText } from './countries.js';
import { ageFrom, heightToCm } from './format.js';

export type Group = 'GK' | 'DEF' | 'MID' | 'FWD';
export const GROUPS: { key: Group; title: string; label: string }[] = [
  { key: 'GK', title: 'Goalkeepers', label: 'Goalkeeper' },
  { key: 'DEF', title: 'Defenders', label: 'Defender' },
  { key: 'MID', title: 'Midfielders', label: 'Midfielder' },
  { key: 'FWD', title: 'Forwards', label: 'Forward' },
];
export const ROLE_ORDER = ['Head Coach', 'Assistant Coach', 'Goalkeeper Coach', 'Fitness Coach', 'Technical Adviser', 'Performance Analyst'];

export type Person = {
  kind: 'player' | 'staff';
  slug: string; href: string;
  /** Earlier web addresses (before a name correction): their news tags and match stats still count. */
  oldSlugs: string[];
  firstName: string; surname: string; name: string; officialName: string; shortName: string;
  number: number | null; group: Group | null; groupLabel: string; position: string; role: string;
  photo: string | null; photoSmall: string | null; hero: string | null;
  nationality: string[]; nationalTeam: string | null; birthTown: string | null; birthCountry: string | null;
  dob: string | null; age: number | null; heightCm: number | null; preferredFoot: string | null;
  nickname: string | null; stateOfOrigin: string | null; hometown: string | null; secondaryPositions: string[]; playingCareer: string | null;
  joined: string | null; debut: string | null; licence: string | null;
  bioHeadline: string | null; bioText: string | null; shortBio: string | null; interestingFact: string | null; shirtUrl: string | null;
  socials: { instagram?: string | null; x?: string | null; tiktok?: string | null };
  previousClubs: { club: string; country?: string; startYear?: number | null; endYear?: number | null }[];
  previousRoles: { club: string; position: string; period: string }[];
  internationalCareer: { level: string; caps: number | null; goals: number | null; tournaments: string }[];
  honours: { title: string; seasonOrYear: string; clubOrTeam: string }[];
  isSample: boolean;
  entry: CollectionEntry<'players'> | CollectionEntry<'staff'>;
};

const adultDob = (dob: string | null) => (dob && (ageFrom(dob) ?? 0) >= 18 ? dob : null);
const ymd = (d: unknown) => (d instanceof Date && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);

function playerOf(e: CollectionEntry<'players'>): Person {
  const d = e.data, pr = (d.profile || {}) as Record<string, any>;
  const parts = pr.surname ? { firstName: pr.firstName || '', surname: pr.surname, middleName: '', websiteName: pr.websiteName || '' } : { ...partsFromName(d.name), middleName: '', websiteName: '' }; // middle names are never public
  const label = GROUPS.find(g => g.key === d.position)?.label || '';
  const dob = pr.surname ? pr.dob || null : adultDob(ymd(d.dateOfBirth));
  return {
    kind: 'player', slug: e.id, href: `/squad/${e.id}/`, oldSlugs: pr.oldSlugs || [],
    firstName: parts.firstName, surname: parts.surname, name: pr.name || publicName(parts) || d.name, officialName: pr.officialName || officialName(parts), shortName: pr.shortName || shortName(parts) || d.name,
    number: Number.isFinite(d.number) ? d.number : null, group: d.position, groupLabel: label, position: pr.position || d.positionDetail || label, role: '',
    photo: d.photo || null, photoSmall: pr.photoSmall || d.photo || null, hero: pr.heroPhoto || null,
    nationality: [pr.nationality || countryFromText(d.nationality), pr.nationality2].filter(Boolean) as string[], nationalTeam: pr.nationalTeam || null,
    birthTown: pr.birthTown || null, birthCountry: pr.birthCountry || null,
    dob, age: dob ? ageFrom(dob) : (pr.age ?? d.age ?? null), heightCm: pr.heightCm ?? heightToCm(d.height), preferredFoot: d.preferredFoot || null,
    nickname: pr.nickname || d.nickname || null, stateOfOrigin: pr.stateOfOrigin || d.stateOfOrigin || null, hometown: pr.hometown || d.hometown || null,
    secondaryPositions: (pr.secondaryPositions || []).filter((x: string) => x && x !== (pr.position || d.positionDetail)), playingCareer: null,
    joined: pr.joined || null, debut: pr.debutDate || null, licence: null,
    bioHeadline: pr.bioHeadline || null, bioText: pr.bio || null, shortBio: null, interestingFact: pr.interestingFact || null, shirtUrl: pr.shirtShopUrl || null,
    socials: pr.socials || {}, previousClubs: pr.previousClubs || [], previousRoles: [], internationalCareer: pr.internationalCareer || [], honours: pr.honours || [],
    isSample: !!d.isSample, entry: e,
  };
}
function staffOf(e: CollectionEntry<'staff'>): Person {
  const d = e.data, pr = (d.profile || {}) as Record<string, any>;
  const parts = pr.surname ? { firstName: pr.firstName || '', surname: pr.surname, middleName: '', websiteName: pr.websiteName || '' } : { ...partsFromName(d.name), middleName: '', websiteName: '' }; // middle names are never public
  const slug = pr.slug || nameSlug(d.name) || e.id;
  return {
    kind: 'staff', slug, href: `/squad/staff/${slug}/`, oldSlugs: pr.oldSlugs || [],
    firstName: parts.firstName, surname: parts.surname, name: pr.name || publicName(parts) || d.name, officialName: pr.officialName || officialName(parts), shortName: pr.shortName || shortName(parts) || d.name,
    number: null, group: null, groupLabel: '', position: '', role: d.role,
    photo: d.photo || null, photoSmall: pr.photoSmall || d.photo || null, hero: pr.heroPhoto || null,
    nationality: [pr.nationality, pr.nationality2].filter(Boolean) as string[], nationalTeam: null, birthTown: pr.birthTown || null, birthCountry: pr.birthCountry || null,
    dob: pr.dob || null, age: pr.dob ? ageFrom(pr.dob) : pr.age ?? null, heightCm: null, preferredFoot: null,
    nickname: pr.nickname || null, stateOfOrigin: pr.stateOfOrigin || null, hometown: pr.hometown || null, secondaryPositions: [], playingCareer: pr.playingCareer || null,
    joined: pr.joined || null, debut: null, licence: pr.licence || null,
    // The short CMS bio only for hand-made entries (for portal staff it just repeats the licence or role).
    bioHeadline: pr.bioHeadline || null, bioText: pr.bio || null, shortBio: pr.surname ? null : d.bio || null, interestingFact: pr.interestingFact || null, shirtUrl: pr.shirtShopUrl || null,
    socials: pr.socials || {}, previousClubs: [], previousRoles: pr.previousRoles || [], internationalCareer: [], honours: pr.honours || [],
    isSample: false, entry: e,
  };
}

/** Public players: by position group, then shirt number. */
export async function squadPlayers(): Promise<Person[]> {
  const order = (g: Group | null) => GROUPS.findIndex(x => x.key === g);
  return (await getPlayers()).map(playerOf).sort((a, b) => order(a.group) - order(b.group) || (a.number ?? 999) - (b.number ?? 999) || a.surname.localeCompare(b.surname));
}
/** Coaching staff: Head Coach first, then by role. */
export async function squadStaff(): Promise<Person[]> {
  // The order from Squad › Roles (written as `order` by scripts/fetch-squad.mjs), then the starting list.
  const idx = (r: string) => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? ROLE_ORDER.length : i; };
  return (await getCoaches()).map(staffOf).sort((a, b) => (a.entry.data as any).order - (b.entry.data as any).order || idx(a.role) - idx(b.role) || a.surname.localeCompare(b.surname));
}
