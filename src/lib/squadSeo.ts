// Search engines and sharing for the Squad profile pages: the description from
// the bio, the share image (name and number on the photo, made by
// scripts/fetch-squad.mjs) and schema.org Person data (member of Lobi Stars FC).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Person } from './squadPeople';
import { countryName } from './countries.js';

const clip = (s: string, n = 155) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

export function profileDescription(p: Person): string {
  const bio = String(p.bioText || '').split(/\n+/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).join(' ');
  if (bio) return clip(bio);
  const what = p.kind === 'player' ? `${p.position || p.groupLabel}${p.number != null ? ` (#${p.number})` : ''} for Lobi Stars FC` : `${p.role} at Lobi Stars FC`;
  return clip(`${p.name}, ${what}: profile, career and news.`);
}

/** /og/squad/<slug>.jpg if it was made at build time, otherwise the profile photo. */
export function shareImage(p: Person): string | undefined {
  const file = p.kind === 'player' ? p.slug : (p.entry.id as string);
  if (existsSync(join(process.cwd(), 'public/og/squad', `${file}.jpg`))) return `/og/squad/${file}.jpg`;
  return p.photo || undefined;
}

export function personJsonLd(p: Person, site: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: p.name,
    ...(p.firstName ? { givenName: p.firstName } : {}),
    ...(p.surname ? { familyName: p.surname } : {}),
    url: new URL(p.href, site).toString(),
    ...(p.photo ? { image: new URL(p.photo, site).toString() } : {}),
    jobTitle: p.kind === 'player' ? `${p.position || p.groupLabel}, Lobi Stars FC` : `${p.role}, Lobi Stars FC`,
    ...(p.dob ? { birthDate: p.dob } : {}),
    ...(p.birthTown || p.birthCountry ? { birthPlace: { '@type': 'Place', name: [p.birthTown, countryName(p.birthCountry)].filter(Boolean).join(', ') } } : {}),
    ...(p.nationality[0] ? { nationality: { '@type': 'Country', name: countryName(p.nationality[0]) } } : {}),
    ...(p.heightCm ? { height: { '@type': 'QuantitativeValue', value: p.heightCm, unitCode: 'CMT' } } : {}),
    ...(p.bioText ? { description: profileDescription(p) } : {}),
    memberOf: { '@type': 'SportsTeam', name: 'Lobi Stars FC', sport: 'Football', url: new URL('/', site).toString() },
  };
}
