// /api/stats-centre/* -- the Lobi Stars Statistics Center (see _lib/statsCentre.js and _lib/statsCentreData.js).
// POST login { loginId, password, code? } (a Super Admin signs in with their email) · POST logout · GET session · POST password { current, password }
// GET dashboard?season= · GET fixtures · GET matches?season=&status=&competition= · POST matches { eventId } | { home, away, date, ... }
// GET match?id= · POST match/setup { id, ...fields } · POST match/lineups { id, home: [], away: [] } · POST match/events { id, ops: [] }
// POST match/clock { id, action, at } · POST match/status { id, status } · POST match/publish { id } · POST match/reopen { id } · POST match/remove { id }
// GET players?season= (or season=career) · GET team?season= · GET activity?item=
// GET export/events.csv?season=|matchId= · GET export/matches.csv?season= · GET settings · POST settings { competitions }
// Every change needs the session's CSRF token; a temporary password must be changed before anything else.
import { signIn, getStatsSession, signOut, changePassword, csrfProblem, clearStatsCookie, json, IDLE_MS, setSxSetting, activityList, oneLine, sxLog, statsActor } from '../_lib/statsCentre.js';
import {
  loadRoster, siteSettings, startMonthOf, listFixtures, listMatches, seasons, createMatch, getMatch, saveSetup, saveLineups, applyEvents, setClock, setStatus,
  publish, reopen, removeMatch, dashboard, publishedMatches, playerTotals, teamTotals, eventsCsv, matchesCsv, settingsView,
  EVENT_TYPES, LIVE_BUTTONS, PERIODS, OUTCOMES, BODY_PARTS, DETAIL_TYPES, STATUSES,
} from '../_lib/statsCentreData.js';
import { seasonOf } from '../_lib/stats.js';

const PASSWORD_ONLY = new Set(['GET session', 'POST password', 'POST logout']);

export async function onRequest({ request, env, params }) {
  const route = [].concat(params.route || []).join('/');
  const method = request.method;
  const db = env.DB;
  try {
    if (route === 'login' && method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const r = await signIn(env, request, b);
      if (r.error) return json({ error: r.error, needCode: !!r.needCode }, r.status || 400);
      return json({ ok: true }, 200, { 'Set-Cookie': r.cookie });
    }
    const s = await getStatsSession(request, env, { touch: !(method === 'GET' && route === 'session') });
    if (!s) return json({ error: 'Please sign in to the Statistics Center again.', signedOut: true }, 401, { 'Set-Cookie': clearStatsCookie() });
    if (method !== 'GET' && method !== 'HEAD') {
      const bad = csrfProblem(request, s);
      if (bad) return json({ error: bad }, 403);
    }
    const key = `${method} ${route}`;
    if (s.user.mustChange && !PASSWORD_ONLY.has(key)) return json({ error: 'Please choose your own password first.', mustChange: true }, 403);
    const b = method === 'POST' ? await request.json().catch(() => ({})) : {};
    const q = new URL(request.url).searchParams;
    const site = await siteSettings(env, request.url);
    const startMonth = startMonthOf(site);
    const current = site.currentSeason || seasonOf(new Date().toISOString(), startMonth);
    const season = q.has('season') ? oneLine(q.get('season'), 12) : current;
    const opts = { startMonth, request };
    const out = r => (r.error ? json(r, 400) : json(r));
    const csv = (body, name) => new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

    switch (key) {
      case 'GET session': return json({
        user: s.user, csrf: s.csrf, idleMinutes: IDLE_MS / 60e3, season: current, seasons: await seasons(db, current),
        eventTypes: EVENT_TYPES, liveButtons: LIVE_BUTTONS, periods: PERIODS, outcomes: OUTCOMES, bodyParts: BODY_PARTS, detailTypes: DETAIL_TYPES, statuses: STATUSES,
        roster: s.user.mustChange ? [] : await loadRoster(env, request.url), settings: await settingsView(db),
      });
      case 'POST logout': await signOut(env, request, s); return json({ ok: true }, 200, { 'Set-Cookie': clearStatsCookie() });
      case 'POST password': return out(await changePassword(env, request, s, b));

      case 'GET dashboard': return json(await dashboard(db, season));
      case 'GET fixtures': return json({ fixtures: await listFixtures(db) });
      case 'GET matches': return json({ matches: await listMatches(db, { season: q.get('season') || '', status: q.get('status') || '', competition: q.get('competition') || '' }) });
      case 'POST matches': { const r = await createMatch(db, s.user, b, opts); return r.error ? json(r, r.id ? 409 : 400) : json(r); }
      case 'GET match': { const m = await getMatch(db, q.get('id')); return m ? json(m) : json({ error: 'Match not found.' }, 404); }
      case 'POST match/setup': return out(await saveSetup(db, s.user, b.id, b, opts));
      case 'POST match/lineups': return out(await saveLineups(db, s.user, b.id, b, await loadRoster(env, request.url), opts));
      case 'POST match/events': {
        const r = await applyEvents(db, s.user, b.id, b.ops, await loadRoster(env, request.url), opts);
        if (r.error) return json(r, 400);
        const m = await getMatch(db, b.id);
        return json({ ...r, match: m.match, events: m.events, derived: m.derived });
      }
      case 'POST match/clock': return out(await setClock(db, s.user, b.id, b, opts));
      case 'POST match/status': return out(await setStatus(db, s.user, b.id, b.status, opts));
      case 'POST match/publish': { const r = await publish(db, s.user, b.id, opts); return r.error ? json(r, r.check ? 422 : 400) : json(r); }
      case 'POST match/reopen': return out(await reopen(db, s.user, b.id, opts));
      case 'POST match/remove': return out(await removeMatch(db, s.user, b.id, opts));

      case 'GET players': {
        const snaps = await publishedMatches(db, season === 'career' ? '' : season);
        return json({ season, players: playerTotals(snaps) });
      }
      case 'GET team': return json({ season, team: teamTotals(await publishedMatches(db, season)) });
      case 'GET activity': return json({ activity: await activityList(db, { item: oneLine(q.get('item') || '', 60), limit: 300 }) });

      case 'GET export/events.csv': {
        const matchId = oneLine(q.get('matchId') || '', 60);
        await sxLog(db, statsActor(s.user), 'export', { details: `Events CSV (${matchId || `season ${season}`})`, request });
        return csv(await eventsCsv(db, matchId ? { matchId } : { season }), `lobi-stars-events-${(matchId || season).replace(/[^\w-]/g, '-')}.csv`);
      }
      case 'GET export/matches.csv': {
        await sxLog(db, statsActor(s.user), 'export', { details: `Matches CSV (season ${season})`, request });
        return csv(await matchesCsv(db, { season }), `lobi-stars-matches-${season.replace(/[^\w-]/g, '-')}.csv`);
      }
      case 'GET settings': return json(await settingsView(db));
      case 'POST settings': {
        if (!s.user.canPublish) return json({ error: 'Only a senior statistician or a Super Admin can change the settings.' }, 403);
        const comps = [...new Set((Array.isArray(b.competitions) ? b.competitions : []).map(c => oneLine(c, 60)).filter(Boolean))].slice(0, 30);
        if (!comps.length) return json({ error: 'Keep at least one competition.' }, 400);
        await setSxSetting(db, 'competitions', JSON.stringify(comps), s.user.fullName);
        await sxLog(db, statsActor(s.user), 'settings', { after: { competitions: comps }, request });
        return json({ ok: true, ...(await settingsView(db)) });
      }
      default: return json({ error: 'Not found.' }, 404);
    }
  } catch (err) {
    console.error('[stats-centre]', err);
    return json({ error: 'Something went wrong; nothing was saved. Please try again.' }, 500);
  }
}
