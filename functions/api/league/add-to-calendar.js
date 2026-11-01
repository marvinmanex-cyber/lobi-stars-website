import { leagueFrom, badRequest } from '../_lib/leagueApi.js';

// GET /api/league/add-to-calendar?fixture=<id>
// The "Add to calendar" button: opens the fan's calendar with the match filled
// in, instead of downloading a file they don't know how to open.
//   iPhone / iPad / Mac -> the .ics file, which Apple devices open straight in Calendar.
//   Everyone else (Android, Windows, …) -> Google Calendar's "new event" page, filled in.
// ?to=google or ?to=ics forces one of them.
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const fixture = url.searchParams.get('fixture') || '';
    if (!/^\d{1,9}$/.test(fixture)) return badRequest('Unknown fixture.');
    const ua = request.headers.get('user-agent') || '';
    const to = url.searchParams.get('to') || (/iPhone|iPad|iPod|Macintosh/.test(ua) ? 'ics' : 'google');
    const ics = `${url.origin}/api/league/calendar.ics?fixture=${fixture}`;
    if (to === 'ics') return Response.redirect(ics, 302);
    const { league, error } = await leagueFrom(env, new URL(`${url.origin}/api/league/calendar.ics`));
    if (error) return error;
    const f = league.fixtures.find(x => x.id === Number(fixture));
    if (!f) return new Response('Not found', { status: 404 });
    if (!f.kickoff_at) return Response.redirect(`${url.origin}/fixtures/`, 302);
    const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const start = Date.parse(f.kickoff_at);
    const comp = f.competition?.name || f.competition?.short_name || '';
    const q = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${f.home.name} vs ${f.away.name}`,
      dates: `${stamp(start)}/${stamp(start + 2 * 3600e3)}`,
      details: `${comp}${f.matchday ? `, Matchday ${f.matchday}` : ''}. Kick-off times are Nigerian time. Tickets and fixtures: ${url.origin}/fixtures/`,
      location: f.venue?.name || '',
      ctz: 'Africa/Lagos',
    });
    return new Response(null, { status: 302, headers: { Location: `https://calendar.google.com/calendar/render?${q}`, 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[league] add to calendar', err);
    return new Response('Could not open the calendar.', { status: 500 });
  }
}
