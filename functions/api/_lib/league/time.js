// Times for the league: everything is stored as UTC ISO strings and shown in
// Nigerian time (Africa/Lagos, WAT, UTC+1 all year: Nigeria has no daylight
// saving). Pure functions, used by Functions, Astro pages and Node tests.
const TZ = 'Africa/Lagos';
const OFFSET_MS = 60 * 60 * 1000;

/** { date: 'YYYY-MM-DD', time: 'HH:MM', weekday: 0-6 (Sunday 0) } in Nigerian time. */
export function toLagos(iso) {
  const d = new Date(new Date(iso).getTime() + OFFSET_MS);
  if (Number.isNaN(d.getTime())) return null;
  const s = d.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16), weekday: d.getUTCDay() };
}

/** "Sunday 8 November 2026" */
export const formatDate = iso => new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '');
/** "Sun 8 Nov" */
export const formatShortDate = iso => new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
/** "4:00 PM" */
export const formatTime = iso => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
/** "22 Nov 2026, 7:05 PM" */
export const formatDateTime = iso => `${new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' })}, ${formatTime(iso)}`;

/**
 * Nigerian date + time to a UTC ISO string ("2026-11-08", "16:00" ->
 * "2026-11-08T15:00:00Z"). Accepts YYYY-MM-DD or DD/MM/YYYY and HH:MM (24 h).
 * Returns null when either is not a real date or time.
 */
export function lagosDateTimeToUtcIso(date, time = '16:00') {
  let d = String(date || '').trim();
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d);
  if (dm) d = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  const t = String(time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  const local = Date.parse(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  if (Number.isNaN(local)) return null;
  const back = new Date(local).toISOString().slice(0, 10);
  if (back !== d) return null; // e.g. 31/02
  return new Date(local - OFFSET_MS).toISOString().replace('.000Z', 'Z');
}

/** Same calendar day in Nigeria? */
export const lagosDay = iso => toLagos(iso)?.date || null;
