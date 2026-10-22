// Before each build: the VERIFIED player and staff profiles from the Squad & Staff
// Data Portal (public details only: age, never the date of birth) become squad
// entries, so the Squad pages show them like any other player or staff member.
// Source: SQUAD_SOURCE_URL (default https://lobistarsfc.com) /api/squad/public.
// Written to src/content/players/portal/ and src/content/staff/portal/ (not in
// git). If the source cannot be reached, the files from the last build are kept.
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS = path.join(root, 'src/content/players/portal'), STAFF = path.join(root, 'src/content/staff/portal');
const SOURCE = String(process.env.SQUAD_SOURCE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
const ROLE_ORDER = ['Head Coach', 'Assistant Coach', 'Goalkeeper Trainer', 'Fitness Coach', 'Team Manager', 'Team Doctor', 'Physiotherapist', 'Kit Manager', 'Media Officer'];
const y = v => JSON.stringify(v ?? null); // JSON values are valid YAML
const initials = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'LS';
const monthYear = ym => { const m = /^(\d{4})-(\d{2})$/.exec(ym || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : null; };

function bodyFor(p, staff) {
  const out = [];
  if (staff && p.qualifications) out.push(`**Qualifications:** ${p.qualifications}`);
  if (staff && p.playingCareer) out.push(`**Playing career:** ${p.playingCareer}`);
  if (p.joined) out.push(`Joined Lobi Stars in ${monthYear(p.joined) || p.joined}.`);
  if (!staff && p.international) out.push(`**International experience:** ${p.international}`);
  const clubs = staff ? (p.previousRoles || []).map(r => `- ${[r.club, r.position, r.period].filter(Boolean).join(', ')}`) : (p.previousClubs || []).map(r => `- ${r.club}${r.startYear ? ` (${r.startYear}${r.endYear ? `–${r.endYear}` : '–'})` : ''}`);
  if (clubs.length) out.push(`### ${staff ? 'Previous clubs and positions' : 'Previous clubs'}\n\n${clubs.join('\n')}`);
  const hon = (p.honours || []).map(h => `- ${[h.title, h.seasonOrYear, h.clubOrTeam].filter(Boolean).join(', ')}`);
  if (hon.length) out.push(`### Honours\n\n${hon.join('\n')}`);
  return out.join('\n\n');
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
    const fm = { slug: p.slug, name: p.name, position: p.group, number: p.number ?? 0, nationality: p.nationality || 'Nigeria', stateOfOrigin: p.stateOfOrigin || null,
      age: p.age ?? null, height: p.heightCm ? `${p.heightCm} cm` : null, preferredFoot: p.preferredFoot || null, photo: p.photo || null, portal: true,
      positionDetail: p.position || null, hometown: p.hometown || null, nickname: p.nickname || null, social: p.social || null };
    await writeFile(path.join(PLAYERS, `${p.slug}.md`), `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${y(v)}`).join('\n')}\n---\n\n${bodyFor(p, false)}\n`);
  }
  for (const s of data.staff) {
    const idx = ROLE_ORDER.indexOf(s.role);
    const fm = { slug: `staff-${s.slug}`, name: s.name, role: s.role || 'Staff', initials: initials(s.name), bio: [s.qualifications, s.playingCareer].filter(Boolean).join(' · ').slice(0, 200) || s.role || '',
      photo: s.photo || undefined, order: 100 + (idx < 0 ? ROLE_ORDER.length : idx), group: 'Coaching Staff', portal: true };
    await writeFile(path.join(STAFF, `${fm.slug}.md`), `---\n${Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${y(v)}`).join('\n')}\n---\n\n${bodyFor(s, true)}\n`);
  }
  await writeFile(path.join(PLAYERS, '_left.json'), JSON.stringify(data.left || []));
  console.log(`[fetch-squad] ${data.players.length} player(s) and ${data.staff.length} staff from the portal (${data.season}).`);
}
main();
export { readdir };
