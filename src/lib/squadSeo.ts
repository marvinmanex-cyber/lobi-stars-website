// Search engines and sharing for the Squad profile pages: the description from
// the bio and schema.org Person data (src/lib/squadRender.js, shared with the
// server), and the share image (name and number on the photo, made by
// scripts/fetch-squad.mjs).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Person } from './squadPeople';
export { profileDescription, personJsonLd } from './squadRender.js';

/** /og/squad/<slug>.jpg if it was made at build time, otherwise the profile photo. */
export function shareImage(p: Person): string | undefined {
  const file = p.kind === 'player' ? p.slug : (p.entry.id as string);
  if (existsSync(join(process.cwd(), 'public/og/squad', `${file}.jpg`))) return `/og/squad/${file}.jpg`;
  return p.photo || undefined;
}
