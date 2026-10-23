// /admin/squad-legacy.json -- built with the site: the players and staff still kept
// as hand-made files in src/content (not from the Squad & Staff Data Portal). Read
// by Squad › Profile Submissions › "Old squad files" (server side, through the
// site's own files) to show the migration list before anything is moved. The
// admin login protects /admin.
import { getCollection } from 'astro:content';

export async function GET() {
  const players = (await getCollection('players')).filter(p => !p.data.portal).map(p => ({
    key: `players/${p.id}`, kind: 'player', name: p.data.name, number: p.data.number, position: p.data.position, nationality: p.data.nationality || null,
    stateOfOrigin: p.data.stateOfOrigin || null, dob: p.data.dateOfBirth ? new Date(p.data.dateOfBirth).toISOString().slice(0, 10) : null, height: p.data.height || null,
    preferredFoot: p.data.preferredFoot || null, photo: p.data.photo || null, isSample: !!p.data.isSample, bio: String(p.body || '').trim().slice(0, 3000),
  }));
  const staff = (await getCollection('staff')).filter(s => !(s.data as any).portal).map(s => ({
    key: `staff/${s.id}`, kind: 'staff', name: s.data.name, role: (s.data as any).role || null, group: (s.data as any).group || null, photo: (s.data as any).photo || null,
    // A file whose name is just its role ("Head Coach") is a placeholder, not a person.
    isSample: /^(head coach|assistant coach|coach|staff|sample)/i.test(String(s.data.name || '')) && String(s.data.name) === String((s.data as any).role || s.data.name),
    bio: String((s.data as any).bio || s.body || '').trim().slice(0, 3000),
  }));
  return new Response(JSON.stringify({ players, staff }), { headers: { 'Content-Type': 'application/json' } });
}
