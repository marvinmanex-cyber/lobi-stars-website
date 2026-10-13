// iCalendar (RFC 5545) feed of fixtures: CRLF line endings, lines folded at
// 75 octets, commas, semicolons, backslashes and newlines escaped. Fixtures
// without a kick-off time (postponed, to be confirmed) are left out.
const enc = new TextEncoder();

export const icsEscape = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds one content line at 75 octets (never splitting a UTF-8 character). */
export function foldLine(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ''; size = 0; limit = 74; } // continuation lines start with a space
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const stamp = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * buildIcs(fixtures, { calendarName, site, now })
 * Each fixture: { id, kickoff_at, status, updated_at, home: {name}, away: {name},
 *   venue: {name}|null, competition: {short_name}, matchday }
 */
export function buildIcs(fixtures, { calendarName = 'Lobi Stars FC fixtures', site = 'https://lobistarsfc.com', now = new Date().toISOString() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lobi Stars FC//Fixtures//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calendarName)}`, 'X-WR-TIMEZONE:Africa/Lagos', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const f of fixtures) {
    if (!f.kickoff_at) continue;
    const comp = f.competition?.short_name || '';
    const where = [comp, f.matchday ? `Matchday ${f.matchday}` : ''].filter(Boolean).join(', ');
    const summary = `${f.home.name} vs ${f.away.name}${where ? ` (${where})` : ''}`;
    const cancelled = ['cancelled', 'abandoned', 'postponed'].includes(f.status);
    // SEQUENCE grows with every change so calendar apps replace the old copy.
    const seq = f.updated_at ? Math.max(0, Math.floor((Date.parse(f.updated_at.replace(' ', 'T') + (/Z$/.test(f.updated_at) ? '' : 'Z')) - Date.UTC(2026, 0, 1)) / 1000)) : 0;
    lines.push('BEGIN:VEVENT',
      `UID:fixture-${f.id}@lobistarsfc.com`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(f.kickoff_at)}`,
      'DURATION:PT2H',
      `SUMMARY:${icsEscape(summary)}`,
      ...(f.venue?.name ? [`LOCATION:${icsEscape(f.venue.name)}`] : []),
      `DESCRIPTION:${icsEscape(`${f.competition?.name || comp}${f.matchday ? `, Matchday ${f.matchday}` : ''}. Kick-off times are Nigerian time (WAT). Fixtures: ${site}/fixtures/`)}`,
      `URL:${site}/fixtures/`,
      `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      `SEQUENCE:${Number.isFinite(seq) ? seq : 0}`,
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
