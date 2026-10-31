import { careerData, careerFor, coachRecord, COACH_RECORD_ROLES } from '../_lib/squadCareer.js';
import { ensureProfileSchema, parseJson } from '../_lib/squadProfiles.js';

// GET /api/squad/career?player=<slug>[,<earlier slug>…] | ?staff=<slug>
// A player's Lobi Stars career from the official match records (season by
// season and in total, debut, first goal, awards, milestones) and their shirt
// numbers by season; or a Head / Assistant Coach's record while in the role.
// Public football data only. Cached for 5 minutes.
const CACHE = { 'Cache-Control': 'public, max-age=300' };
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), db = env.DB;
  let site = {};
  try { site = await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json(); } catch { /* defaults */ }
  const startMonth = /^\d{4}-(\d{2})-\d{2}$/.test(site.seasonStart || '') ? Number(site.seasonStart.slice(5, 7)) : 8;
  try {
    await ensureProfileSchema(db);
    const data = await careerData(db, { startMonth });
    const staffSlug = (url.searchParams.get('staff') || '').toLowerCase();
    if (staffSlug) {
      const r = await db.prepare(`SELECT data_json, live_json, left_at FROM squad_profiles WHERE type = 'staff' AND public_slug = ? AND live_json IS NOT NULL ORDER BY season DESC LIMIT 1`).bind(staffSlug).first();
      const d = parseJson(r?.live_json, {})?.data || parseJson(r?.data_json, {});
      const role = d.role === 'Other' ? d.roleOther : d.role;
      if (!r || !COACH_RECORD_ROLES.includes(role)) return Response.json({ record: null }, { headers: CACHE });
      const from = /^\d{4}-\d{2}(-\d{2})?$/.test(d.joinedStaff || '') ? `${d.joinedStaff.length === 7 ? `${d.joinedStaff}-01` : d.joinedStaff}T00:00:00Z` : null;
      return Response.json({ role, since: from, record: coachRecord(data, { from, to: r.left_at }) }, { headers: CACHE });
    }
    const slugs = String(url.searchParams.get('player') || '').toLowerCase().split(',').map(s => s.trim()).filter(s => /^[a-z0-9-]{2,120}$/.test(s)).slice(0, 6);
    if (!slugs.length) return Response.json({ error: 'player needed' }, { status: 400 });
    const row = await db.prepare(`SELECT person_id, id, live_json FROM squad_profiles WHERE type = 'player' AND public_slug = ? AND live_json IS NOT NULL ORDER BY season DESC LIMIT 1`).bind(slugs[0]).first();
    const live = parseJson(row?.live_json, {})?.data || {};
    const career = careerFor(data, slugs, { goalkeeper: live.positionGroup === 'Goalkeeper' });
    // Shirt numbers by season (all of this person's approved profiles).
    let shirts = [];
    if (row) {
      const all = (await db.prepare(`SELECT season, live_json FROM squad_profiles WHERE (person_id = ? OR id = ?) AND live_json IS NOT NULL ORDER BY season`).bind(row.person_id || row.id, row.id).all()).results;
      shirts = all.map(x => ({ season: x.season, number: parseJson(x.live_json, {})?.data?.shirtNumber ?? null })).filter(x => Number.isInteger(x.number));
    }
    const { upcoming, ...pub } = career; // upcoming milestones are for the media partner only
    return Response.json({ ...pub, shirts, note: 'Stats updated automatically from official match records.' }, { headers: CACHE });
  } catch (err) {
    console.error('[squad career]', err);
    return Response.json({ seasons: [], total: null, awards: [], milestones: [], shirts: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
