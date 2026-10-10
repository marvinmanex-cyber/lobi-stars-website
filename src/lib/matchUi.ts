// Browser helpers shared by the fixtures/results lists and the Match Centre.
import { TEAM_LOGOS } from '../../functions/api/_lib/teamLogos.js';
import { teamInitials } from './site';

export type Match = {
  id?: string; slug?: string; home_team: string; away_team: string; competition: string;
  event_date: string; venue: string; status?: string; home_score?: number | null; away_score?: number | null;
};

export const isLobi = (name: string) => /lobi stars/i.test(name);
export const hasScore = (m: Match) => m.home_score !== null && m.home_score !== undefined && m.away_score !== null && m.away_score !== undefined;

const TZ = 'Africa/Lagos';
export const fmtDate = (iso: string, long = false) => new Date(iso).toLocaleDateString('en-GB',
  long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }
       : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) + ' WAT';
export const monthKey = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: TZ });

export const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Upcoming', live: 'Live', 'half-time': 'Half-time', 'full-time': 'Full-time',
  postponed: 'Postponed', cancelled: 'Cancelled',
};

export function crest(name: string, size = 30, cls = 'crest'): HTMLElement {
  const src = (TEAM_LOGOS as Record<string, string>)[name];
  const fallback = () => {
    const s = document.createElement('span');
    s.className = `${cls} ${cls}--initials`;
    s.textContent = teamInitials(name);
    s.setAttribute('aria-hidden', 'true');
    return s;
  };
  if (!src) return fallback();
  const img = document.createElement('img');
  img.className = cls; img.src = src; img.alt = `${name} crest`; img.loading = 'lazy';
  img.width = size; img.height = size;
  img.onerror = () => img.replaceWith(fallback());
  return img;
}

// ── Calendar ──
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function window2h(m: Match) {
  const start = new Date(m.event_date);
  return { start, end: new Date(start.getTime() + 2 * 3600_000) };
}

export function matchUrl(m: Match) {
  return m.slug ? `${location.origin}/matches/${m.slug}/` : `${location.origin}/fixtures`;
}

export function downloadIcs(m: Match) {
  const { start, end } = window2h(m);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lobi Stars FC//Match//EN', 'BEGIN:VEVENT',
    `UID:${m.id || m.slug || start.getTime()}@lobistarsfc.com`, `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEsc(`${m.home_team} vs ${m.away_team}`)}`, `LOCATION:${icsEsc(m.venue)}`,
    `DESCRIPTION:${icsEsc(`${m.competition}. ${matchUrl(m)}`)}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `${(m.slug || 'lobi-stars-match')}.ics`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function googleCalUrl(m: Match) {
  const { start, end } = window2h(m);
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: `${m.home_team} vs ${m.away_team}`, dates: `${icsStamp(start)}/${icsStamp(end)}`,
    details: `${m.competition}. ${matchUrl(m)}`, location: m.venue, ctz: TZ,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export const SUBSCRIBE_URL = 'webcal://lobistarsfc.com/fixtures.ics';
export const FEED_URL = 'https://lobistarsfc.com/fixtures.ics';

/** "Match day" for Matchday Live buttons: 24 hours before kick-off until the end of the match day (WAT). */
export function isMatchDay(m: { status?: string; event_date: string }, now = Date.now()) {
  if (m.status === 'live' || m.status === 'half-time') return true;
  const ko = new Date(m.event_date).getTime();
  const endOfDay = Date.parse(new Date(ko + 3_600_000).toISOString().slice(0, 10) + 'T23:00:00Z');
  return now >= ko - 24 * 3_600_000 && now <= endOfDay;
}

export const watDay = (iso: string) => new Date(new Date(iso).getTime() + 3_600_000).toISOString().slice(0, 10);

/** { 'YYYY-MM-DD': previewSlug } -- embedded by the server, or read from the news index. */
let previewsPromise: Promise<Record<string, string>> | null = null;
export function loadPreviews(): Promise<Record<string, string>> {
  const el = document.getElementById('ssr-previews');
  if (el?.textContent) { try { return Promise.resolve(JSON.parse(el.textContent)); } catch { /* fetch */ } }
  previewsPromise ??= fetch('/data/news-index.json').then(r => (r.ok ? r.json() : [])).then((items: any[]) => {
    const out: Record<string, string> = {};
    for (const n of items) if (n.contentType === 'Preview' && n.matchDate && !out[n.matchDate]) out[n.matchDate] = n.slug;
    return out;
  }).catch(() => ({}));
  return previewsPromise;
}
