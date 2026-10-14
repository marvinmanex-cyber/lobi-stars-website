import { logoFile } from '../../_lib/logoFiles.js';
import { leagueAuth, body, ok, fail } from '../../_lib/leagueAdmin.js';
import { logLeague, slugify, syncEvent } from '../../_lib/leagueDb.js';

// GET   /api/admin/league/teams
// POST  /api/admin/league/teams  { code, name, shortName, crestUrl?, colour?, homeVenueId?, aliases?, isLobi?, competitionId? }
// PATCH /api/admin/league/teams  { id, ...same fields }
// Clubs are never deleted once they have fixtures.
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

async function parseTeam(db, b, existing = null) {
  const v = {};
  if (b.code !== undefined || !existing) { const c = clean(b.code, 5).toUpperCase(); if (!/^[A-Z0-9]{2,5}$/.test(c)) return { error: 'The code is 2 to 5 letters or numbers, e.g. LOB.' }; v.code = c; }
  if (b.name !== undefined || !existing) { const n = clean(b.name, 80); if (n.length < 2) return { error: 'Enter the club name.' }; v.name = n; v.slug = slugify(n); }
  if (b.shortName !== undefined || !existing) { const s = clean(b.shortName || b.name, 40); if (s.length < 2) return { error: 'Enter a short name.' }; v.short_name = s; }
  if (b.crestUrl !== undefined) {
    const c = clean(b.crestUrl, 300);
    if (c && !/^\/[A-Za-z0-9\-._~/%]+$/.test(c) && !/^https:\/\/[^\s"'<>]+$/.test(c)) return { error: 'The crest must be a site path like /images/clubs/abs.png or an https:// address.' };
    v.crest_url = c || null;
  }
  if (b.colour !== undefined) { const c = clean(b.colour, 7); if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) return { error: 'Colours look like #E31E24.' }; v.colour = c || null; }
  if (b.homeVenueId !== undefined) {
    const id = b.homeVenueId === '' || b.homeVenueId === null ? null : Number(b.homeVenueId);
    if (id !== null && !(await db.prepare(`SELECT id FROM league_venues WHERE id = ?`).bind(id).first())) return { error: 'Unknown venue.' };
    v.home_venue_id = id;
  }
  if (b.aliases !== undefined) {
    const list = (Array.isArray(b.aliases) ? b.aliases : String(b.aliases).split(',')).map(a => clean(a, 60)).filter(Boolean).slice(0, 12);
    v.aliases = JSON.stringify(list);
  }
  if (b.isLobi !== undefined) v.is_lobi = b.isLobi ? 1 : 0;
  return { value: v };
}

export async function onRequestGet({ request, env }) {
  const { denied } = await leagueAuth(request, env);
  if (denied) return denied;
  const db = env.DB;
  const { results } = await db.prepare(`SELECT t.*, v.name AS venue_name,
      (SELECT COUNT(*) FROM league_fixtures f WHERE f.home_team_id = t.id OR f.away_team_id = t.id) AS fixtures
    FROM league_teams t LEFT JOIN league_venues v ON v.id = t.home_venue_id ORDER BY t.name`).all();
  const venues = (await db.prepare(`SELECT * FROM league_venues ORDER BY name`).all()).results;
  // crest: the file shown on the site (the transparent copy when there is one); crest_url stays as stored.
  return ok({ teams: results.map(t => ({ ...t, crest: logoFile(t.crest_url), aliases: JSON.parse(t.aliases || '[]') })), venues });
}

export async function onRequestPost({ request, env }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = (await body(request)) || {};
    const p = await parseTeam(db, b);
    if (p.error) return fail(p.error);
    const v = p.value;
    if (await db.prepare(`SELECT id FROM league_teams WHERE code = ? OR slug = ?`).bind(v.code, v.slug).first()) return fail('A club with this code or name already exists.', 409);
    if (v.is_lobi && await db.prepare(`SELECT id FROM league_teams WHERE is_lobi = 1`).first()) return fail('Only one club can be Lobi Stars.', 409);
    const cols = Object.keys(v);
    const r = await db.prepare(`INSERT INTO league_teams (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map(c => v[c])).run();
    if (b.competitionId) await db.prepare(`INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id) VALUES (?, ?)`).bind(Number(b.competitionId), r.meta.last_row_id).run();
    await logLeague(db, staff, 'team.add', 'team', r.meta.last_row_id, null, v);
    return ok({ id: r.meta.last_row_id });
  } catch (err) {
    console.error('[league admin] add team', err);
    return fail('Could not add the club.', 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const { staff, denied } = await leagueAuth(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = (await body(request)) || {};
    const t = await db.prepare(`SELECT * FROM league_teams WHERE id = ?`).bind(Number(b.id)).first();
    if (!t) return fail('Club not found.', 404);
    const p = await parseTeam(db, b, t);
    if (p.error) return fail(p.error);
    const v = p.value;
    if (v.code && v.code !== t.code && await db.prepare(`SELECT id FROM league_teams WHERE code = ? AND id <> ?`).bind(v.code, t.id).first()) return fail('Another club has this code.', 409);
    if (v.slug && v.slug !== t.slug && await db.prepare(`SELECT id FROM league_teams WHERE slug = ? AND id <> ?`).bind(v.slug, t.id).first()) return fail('Another club has this name.', 409);
    if (v.is_lobi && !t.is_lobi && await db.prepare(`SELECT id FROM league_teams WHERE is_lobi = 1`).first()) return fail('Only one club can be Lobi Stars.', 409);
    const cols = Object.keys(v);
    if (!cols.length) return fail('Nothing to change.');
    await db.prepare(`UPDATE league_teams SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map(c => v[c]), t.id).run();
    await logLeague(db, staff, 'team.update', 'team', t.id, t, { ...t, ...v });
    // A renamed club: its Lobi Stars matches in Matches & Fixtures follow.
    if (v.name) {
      const { results } = await db.prepare(`SELECT id FROM league_fixtures WHERE (home_team_id = ? OR away_team_id = ?) AND event_id IS NOT NULL`).bind(t.id, t.id).all();
      for (const f of results) await syncEvent(env, f.id);
    }
    return ok();
  } catch (err) {
    console.error('[league admin] edit team', err);
    return fail('Could not save the club.', 500);
  }
}
