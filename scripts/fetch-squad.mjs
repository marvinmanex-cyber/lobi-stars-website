// Before each build: the LIVE player and staff profiles (their approved version) from the Squad & Staff
// Data Portal (public details only; the full date of birth and middle name only
// from age 18; hidden profiles left out) become squad entries, so the Squad pages
// show them like any other player or staff member. Everything public is kept in
// `profile` (read by src/lib/squadPeople.ts); the bio becomes the page text.
// Source: SQUAD_SOURCE_URL (default https://lobistarsfc.com) /api/squad/public.
// Written to src/content/players/portal/ and src/content/staff/portal/ (not in
// git). If the source cannot be reached, the files from the last build are kept.
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS = path.join(root, 'src/content/players/portal'), STAFF = path.join(root, 'src/content/staff/portal');
const SOURCE = String(process.env.SQUAD_SOURCE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
const ROLE_ORDER = ['Head Coach', 'Assistant Coach', 'Goalkeeper Coach', 'Fitness Coach', 'Technical Adviser', 'Performance Analyst'];
const y = v => JSON.stringify(v ?? null); // JSON values are valid YAML
const initials = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'LS';
const COUNTRY = { NG: 'Nigeria' };
const front = fm => `---\n${Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${y(v)}`).join('\n')}\n---\n\n`;
/** The bio becomes the page text ("## " lines are headings). */
const body = p => `${String(p.bio || '').trim()}\n`;

/**
 * Share images (1200 × 630) for social media: the profile photo on the club's red
 * with the name and shirt number, saved as public/og/squad/<slug>.jpg (not in git).
 * Needs sharp (as the image optimiser does); without it the pages share the photo.
 */
const OG = path.join(root, 'public/og/squad');
const xml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
async function shareImages(people) {
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { console.warn('[fetch-squad] share images skipped (sharp not available).'); return; }
  await rm(OG, { recursive: true, force: true }); await mkdir(OG, { recursive: true });
  let n = 0;
  for (const p of people) {
    if (!p.photo) continue;
    try {
      const r = await fetch(`${SOURCE}${p.photo.replace('w1200.webp', 'w1200.jpg')}`, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const photo = await sharp(Buffer.from(await r.arrayBuffer())).resize(504, 630, { fit: 'cover', position: 'top' }).toBuffer();
      const first = xml((p.firstName || '').toUpperCase()), last = xml((p.surname || p.name || '').toUpperCase());
      const sub = xml(p.kind === 'player' ? (p.position || p.positionGroup || '') : (p.role || ''));
      const num = p.kind === 'player' && p.number != null ? xml(p.number) : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
        <defs><radialGradient id="g" cx="80%" cy="0%" r="120%"><stop offset="0" stop-color="#F0353B"/><stop offset=".45" stop-color="#C11A1F"/><stop offset="1" stop-color="#4D0B0D"/></radialGradient></defs>
        <rect width="1200" height="630" fill="url(#g)"/>
        ${num ? `<text x="660" y="520" font-family="Impact, 'Arial Black', sans-serif" font-size="460" fill="none" stroke="#FFC72C" stroke-width="5" opacity=".85" text-anchor="middle">${num}</text>` : ''}
        <rect x="0" y="600" width="1200" height="30" fill="#FFC72C"/>
        <text x="60" y="110" font-family="Arial, sans-serif" font-weight="700" font-size="30" letter-spacing="4" fill="#FFC72C">LOBI STARS FC</text>
        <text x="60" y="360" font-family="Arial, sans-serif" font-weight="700" font-size="44" fill="#FFFFFF">${first}</text>
        <text x="60" y="450" font-family="Impact, 'Arial Black', sans-serif" font-size="${last.length > 12 ? 78 : 104}" fill="#FFFFFF">${last}</text>
        <text x="60" y="520" font-family="Arial, sans-serif" font-weight="700" font-size="32" fill="#FFE7A0">${sub}${num ? ` · #${num}` : ''}</text>
      </svg>`;
      const slug = p.kind === 'player' ? p.slug : `staff-${p.slug}`;
      await sharp(Buffer.from(svg)).composite([{ input: photo, left: 696, top: 0 }]).jpeg({ quality: 82 }).toFile(path.join(OG, `${slug}.jpg`));
      n++;
    } catch (err) { console.warn(`[fetch-squad] share image for ${p.slug}: ${err.message}`); }
  }
  console.log(`[fetch-squad] ${n} share image(s).`);
}

async function main() {
  let data;
  try {
    const r = await fetch(`${SOURCE}/api/squad/public`, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
    if (!Array.isArray(data.players) || !Array.isArray(data.staff)) throw new Error('unexpected answer');
  } catch (err) {
    console.warn(`[fetch-squad] could not read ${SOURCE}/api/squad/public (${err.message}); keeping the last squad files.`);
    return;
  }
  for (const dir of [PLAYERS, STAFF]) { await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true }); }
  for (const p of data.players) {
    // Older fields stay filled so every page that lists players (Live Match Control, voting, /stats) keeps working.
    const fm = { slug: p.slug, name: p.name, position: p.group, number: p.number ?? 0, nationality: COUNTRY[p.nationality] || p.nationality || 'Nigeria', stateOfOrigin: p.stateOfOrigin || null,
      age: p.age ?? null, height: p.heightCm ? `${p.heightCm} cm` : null, preferredFoot: p.preferredFoot || null, photo: p.photo || null, portal: true,
      positionDetail: p.position || null, hometown: p.hometown || null, nickname: p.nickname || null, profile: p };
    await writeFile(path.join(PLAYERS, `${p.slug}.md`), front(fm) + body(p));
  }
  for (const s of data.staff) {
    // The order set in Squad › Roles (only coaching staff are in the feed).
    const idx = s.roleOrder != null ? s.roleOrder / 10 : ROLE_ORDER.indexOf(s.role);
    const fm = { slug: `staff-${s.slug}`, name: s.name, role: s.role || 'Staff', initials: initials(s.name), bio: s.bioHeadline || s.licence || s.role || '',
      photo: s.photo || undefined, order: 100 + (idx < 0 ? ROLE_ORDER.length : idx), group: 'Coaching Staff', portal: true, profile: s };
    await writeFile(path.join(STAFF, `${fm.slug}.md`), front(fm) + body(s));
  }
  await writeFile(path.join(PLAYERS, '_left.json'), JSON.stringify(data.left || []));
  await writeFile(path.join(PLAYERS, '_redirects.json'), JSON.stringify(data.redirects || []));
  // The old hand-made squad files are switched off once a Super Admin has gone through the migration list.
  await writeFile(path.join(PLAYERS, '_source.json'), JSON.stringify({ legacyOff: !!data.legacyOff }));
  await shareImages([...data.players.map(p => ({ ...p, kind: 'player' })), ...data.staff.map(s => ({ ...s, kind: 'staff' }))]);
  console.log(`[fetch-squad] ${data.players.length} player(s) and ${data.staff.length} staff from the portal (${data.season}).`);
}
main();
export { readdir };
