import { leagueAuth, body, ok, fail } from '../../_lib/leagueAdmin.js';
import { logLeague, listCompetitions, slugify } from '../../_lib/leagueDb.js';

// GET  /api/admin/league/competitions
// POST /api/admin/league/competitions { name, shortName, season, type: 'cup' | 'friendly' | 'league' }
//      e.g. the Federation Cup or a pre-season friendly; cups and friendlies have no table.
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  return ok({ competitions: await listCompetitions(env.DB) });
}

export async function onRequestPost({ request, env }) {
  const { staff, denied } = await leagueAuth(request, env, { sensitive: true });
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = (await body(request)) || {};
    const name = clean(b.name, 100), short = clean(b.shortName || b.name, 40), season = clean(b.season, 20);
    const type = ['league', 'cup', 'friendly'].includes(b.type) ? b.type : null;
    if (name.length < 3 || short.length < 2) return fail('Enter the competition name.');
    if (!/^\d{4}(\/\d{2,4})?$/.test(season)) return fail('Season looks like 2026/2027.');
    if (!type) return fail('Choose league, cup or friendly.');
    const slug = slugify(`${short}-${season}`);
    if (await db.prepare(`SELECT id FROM league_competitions WHERE slug = ?`).bind(slug).first()) return fail('This competition already exists.', 409);
    const r = await db.prepare(`INSERT INTO league_competitions (slug, name, short_name, season, type, has_table, is_current) VALUES (?, ?, ?, ?, ?, ?, 0)`)
      .bind(slug, name, short, season, type, type === 'league' ? 1 : 0).run();
    await logLeague(db, staff, 'competition.add', 'competition', r.meta.last_row_id, null, { slug, name, short, season, type });
    return ok({ id: r.meta.last_row_id, slug });
  } catch (err) {
    console.error('[league admin] add competition', err);
    return fail('Could not add the competition.', 500);
  }
}
