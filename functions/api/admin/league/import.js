import { leagueAuth, ok, fail, snapshot, afterFixtureChange } from '../../_lib/leagueAdmin.js';
import { getCompetition, logLeague } from '../../_lib/leagueDb.js';
import { parseCsv } from '../../_lib/league/csv.js';
import { lagosDateTimeToUtcIso, toLagos } from '../../_lib/league/time.js';

// POST /api/admin/league/import?dryRun=1   body: { csv, competition?, confirm?, allowFinished? }
// Columns: match_no, matchday, date, time, home, away, venue (venue optional).
// Dates YYYY-MM-DD or DD/MM/YYYY, time HH:MM (24-hour, Nigerian time).
// Clubs are matched by name, short name, code or alias. Returns every row as
// new, changed (field by field), unchanged or error. Applying needs
// confirm: true; matches with a result are never changed unless allowFinished.
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const { staff, denied } = await leagueAuth(request, env, { sensitive: !dryRun });
  if (denied) return denied;
  try {
    const db = env.DB;
    let b;
    const type = request.headers.get('Content-Type') || '';
    if (/json/.test(type)) b = await request.json().catch(() => null);
    else b = { csv: await request.text() };
    if (!b || typeof b.csv !== 'string' || !b.csv.trim()) return fail('Upload a CSV file.');
    if (b.csv.length > 200_000) return fail('The file is too big (200 KB at most).');
    const comp = await getCompetition(db, b.competition && /^[a-z0-9-]{1,80}$/.test(b.competition) ? b.competition : null);
    if (!comp) return fail('No competition found.', 404);
    const allowFinished = url.searchParams.get('allowFinished') === '1' || b.allowFinished === true;

    const rows = parseCsv(b.csv);
    if (rows.length < 2) return fail('The file has no fixtures.');
    const head = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
    const need = ['match_no', 'matchday', 'date', 'time', 'home', 'away'];
    const missing = need.filter(h => !head.includes(h));
    if (missing.length) return fail(`Missing columns: ${missing.join(', ')}. Download the template.`);
    const col = name => head.indexOf(name);

    const teams = (await db.prepare(`SELECT * FROM league_teams`).all()).results;
    const venues = (await db.prepare(`SELECT * FROM league_venues`).all()).results;
    const findTeam = v => {
      const k = norm(v);
      return teams.find(t => [t.name, t.short_name, t.code, ...JSON.parse(t.aliases || '[]')].some(x => norm(x) === k)) || null;
    };
    const existing = new Map((await db.prepare(`SELECT * FROM league_fixtures WHERE competition_id = ?`).bind(comp.id).all()).results.map(f => [f.match_no, f]));
    const teamName = id => teams.find(t => t.id === id)?.name || '?';
    const venueName = id => venues.find(v => v.id === id)?.name || '';

    const out = [];
    const seen = new Set();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const get = name => (col(name) >= 0 ? r[col(name)] || '' : '');
      const line = i + 1;
      const err = msg => out.push({ line, status: 'error', error: msg, raw: r.join(', ') });
      const no = Number(get('match_no')), md = Number(get('matchday'));
      if (!Number.isInteger(no) || no < 1) { err('match_no must be a whole number.'); continue; }
      if (seen.has(no)) { err(`match_no ${no} appears twice in the file.`); continue; }
      seen.add(no);
      if (!Number.isInteger(md) || md < 1 || md > 60) { err('matchday must be a whole number.'); continue; }
      const kickoff = lagosDateTimeToUtcIso(get('date'), get('time') || '16:00');
      if (!kickoff) { err('date must be YYYY-MM-DD or DD/MM/YYYY and time HH:MM (24-hour).'); continue; }
      const home = findTeam(get('home')), away = findTeam(get('away'));
      if (!home) { err(`Unknown club "${get('home')}". Add it on the Clubs page or add an alias.`); continue; }
      if (!away) { err(`Unknown club "${get('away')}". Add it on the Clubs page or add an alias.`); continue; }
      if (home.id === away.id) { err('A club cannot play itself.'); continue; }
      let venueId = home.home_venue_id ?? null;
      const vText = get('venue');
      if (vText) {
        const v = venues.find(x => norm(x.name) === norm(vText));
        if (!v) { err(`Unknown venue "${vText}". Add it first or leave the column empty for the home ground.`); continue; }
        venueId = v.id;
      }
      const next = { match_no: no, matchday: md, round: md <= 7 ? 1 : 2, home_team_id: home.id, away_team_id: away.id, venue_id: venueId, kickoff_at: kickoff };
      const f = existing.get(no);
      const label = { home: home.name, away: away.name, date: toLagos(kickoff).date, time: toLagos(kickoff).time, matchday: md };
      if (!f) { out.push({ line, status: 'new', matchNo: no, ...label, apply: next }); continue; }
      const diff = [];
      if (f.matchday !== md) diff.push({ field: 'Matchday', from: f.matchday, to: md });
      if (f.home_team_id !== home.id) diff.push({ field: 'Home', from: teamName(f.home_team_id), to: home.name });
      if (f.away_team_id !== away.id) diff.push({ field: 'Away', from: teamName(f.away_team_id), to: away.name });
      const wasKick = f.kickoff_at || f.original_kickoff_at;
      if (wasKick !== kickoff) diff.push({ field: 'Kick-off', from: wasKick ? `${toLagos(wasKick).date} ${toLagos(wasKick).time}` : 'none', to: `${label.date} ${label.time}` });
      if ((f.venue_id ?? null) !== venueId) diff.push({ field: 'Venue', from: venueName(f.venue_id), to: venueName(venueId) });
      if (!diff.length) { out.push({ line, status: 'unchanged', matchNo: no, ...label }); continue; }
      const finished = Number.isInteger(f.home_goals) || ['full_time', 'awarded', 'live', 'half_time'].includes(f.status);
      if (finished && !allowFinished) { out.push({ line, status: 'error', matchNo: no, ...label, diff, error: 'This match has a result: not changed (tick "also change matches with a result" to override).' }); continue; }
      out.push({ line, status: 'changed', matchNo: no, ...label, diff, apply: next, id: f.id });
    }
    const counts = ['new', 'changed', 'unchanged', 'error'].reduce((o, k) => ({ ...o, [k]: out.filter(r => r.status === k).length }), {});
    const preview = out.map(({ apply, ...r }) => r);
    if (dryRun || !b.confirm) return ok({ dryRun: true, counts, rows: preview });

    let applied = 0;
    for (const r of out) {
      if (r.status === 'new') {
        const a = r.apply;
        const ins = await db.prepare(`INSERT INTO league_fixtures (competition_id, match_no, matchday, round, home_team_id, away_team_id, venue_id, kickoff_at, original_kickoff_at, status, is_published, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 1, ?)`).bind(comp.id, a.match_no, a.matchday, a.round, a.home_team_id, a.away_team_id, a.venue_id, a.kickoff_at, a.kickoff_at, staff.email).run();
        for (const id of [a.home_team_id, a.away_team_id]) await db.prepare(`INSERT OR IGNORE INTO league_competition_teams (competition_id, team_id) VALUES (?, ?)`).bind(comp.id, id).run();
        const f = await db.prepare(`SELECT * FROM league_fixtures WHERE id = ?`).bind(ins.meta.last_row_id).first();
        await logLeague(db, staff, 'import.apply', 'fixture', f.id, null, snapshot(f));
        await afterFixtureChange(env, f, []);
        applied++;
      } else if (r.status === 'changed') {
        const before = existing.get(r.matchNo), a = r.apply;
        const postponed = before.status === 'postponed';
        await db.prepare(`UPDATE league_fixtures SET matchday = ?, round = ?, home_team_id = ?, away_team_id = ?, venue_id = ?, kickoff_at = ?, status = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
          .bind(a.matchday, a.round, a.home_team_id, a.away_team_id, a.venue_id, a.kickoff_at, postponed ? 'scheduled' : before.status, staff.email, before.id).run();
        const f = await db.prepare(`SELECT * FROM league_fixtures WHERE id = ?`).bind(before.id).first();
        await logLeague(db, staff, 'import.apply', 'fixture', f.id, snapshot(before), snapshot(f));
        await afterFixtureChange(env, f, []);
        applied++;
      }
    }
    return ok({ applied, counts, rows: preview });
  } catch (err) {
    console.error('[league admin] import', err);
    return fail('Could not read the file.', 500);
  }
}
