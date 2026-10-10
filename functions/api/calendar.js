import { listMatches } from './_lib/matchCentre.js';
import { matchSlug } from './_lib/matchSlug.js';

// GET /api/calendar -- iCalendar feed of every visible match, so fans can
// subscribe once (webcal://lobistarsfc.com/api/calendar) and get new
// fixtures automatically.
const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = line => line.length <= 74 ? line : line.match(/.{1,74}/g).join('\r\n ');

// ?match=<slug> returns just that match, as a download ("Add to calendar").
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = url.origin;
  const only = (url.searchParams.get('match') || '').toLowerCase();
  let rows = await listMatches(env.DB);
  if (only) {
    rows = rows.filter(e => matchSlug(e) === only || e.id.toLowerCase() === only);
    if (!rows.length) return new Response('Match not found', { status: 404 });
  }
  const now = stamp(Date.now());

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lobi Stars FC//Fixtures//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Lobi Stars FC Fixtures', 'X-WR-TIMEZONE:Africa/Lagos', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
  ];
  for (const e of rows) {
    const start = new Date(e.event_date);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const score = e.home_score !== null && e.home_score !== undefined && e.away_score !== null && e.away_score !== undefined
      ? ` (${e.home_score}-${e.away_score})` : '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@lobistarsfc.com`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`${e.home_team} vs ${e.away_team}${score}`)}`,
      `LOCATION:${esc(e.venue)}`,
      `DESCRIPTION:${esc(`${e.competition}. Match Centre: ${origin}/matches/${matchSlug(e)}/`)}`,
      `URL:${origin}/matches/${matchSlug(e)}/`,
      e.status === 'cancelled' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');

  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': only ? `attachment; filename="lobi-stars-${only}.ics"` : 'inline; filename="lobi-stars-fixtures.ics"',
      'Cache-Control': 'public, max-age=900',
    },
  });
}
