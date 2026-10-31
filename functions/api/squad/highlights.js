import { careerData } from '../_lib/squadCareer.js';
import { seasonOf } from '../_lib/stats.js';
import { ensureProfileSchema, parseJson } from '../_lib/squadProfiles.js';

// GET /api/squad/highlights -- this season's highlights for the badges on the
// Squad page cards: goals, Man of the Match awards and (goalkeepers) clean
// sheets, per player web address. From the official match records. Cached 5 min.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), db = env.DB;
  let site = {};
  try { site = await (await env.ASSETS.fetch(new URL('/data/site.json', url))).json(); } catch { /* defaults */ }
  const startMonth = /^\d{4}-(\d{2})-\d{2}$/.test(site.seasonStart || '') ? Number(site.seasonStart.slice(5, 7)) : 8;
  try {
    await ensureProfileSchema(db);
    const data = await careerData(db, { startMonth });
    const season = site.currentSeason || seasonOf(new Date().toISOString(), startMonth);
    // Earlier web addresses (name corrections) count for the person's address now; goalkeepers for clean sheets.
    const live = (await db.prepare(`SELECT public_slug, old_slugs, live_json FROM squad_profiles WHERE type = 'player' AND status IN ('LIVE', 'ON_LOAN') AND live_json IS NOT NULL`).all()).results;
    const alias = new Map(), keepers = new Set();
    for (const r of live) {
      if (!r.public_slug) continue;
      alias.set(r.public_slug, r.public_slug);
      for (const o of parseJson(r.old_slugs, [])) alias.set(o, r.public_slug);
      if (parseJson(r.live_json, {})?.data?.positionGroup === 'Goalkeeper') keepers.add(r.public_slug);
    }
    const out = {};
    const get = s => (out[s] ||= { goals: 0, motm: 0, cleanSheets: 0 });
    for (const st of data.stats) {
      const m = data.byId.get(st.event_id), slug = alias.get(st.player_slug);
      if (!m || m.season !== season || !slug) continue;
      if (st.goals) get(slug).goals += st.goals;
      if (keepers.has(slug) && st.played && m.ga === 0) get(slug).cleanSheets++;
    }
    for (const [id, winners] of data.motm) {
      if (data.byId.get(id)?.season !== season) continue;
      for (const w of winners) { const slug = alias.get(w); if (slug) get(slug).motm++; }
    }
    return Response.json({ season, players: out }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    console.error('[squad highlights]', err);
    return Response.json({ season: '', players: {} }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
