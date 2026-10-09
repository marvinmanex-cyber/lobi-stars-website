// Match Centre URL slug, e.g. "2026-10-23-lobi-stars-fc-vs-kada-warriors-fc".
// Shared by the Pages Functions and the browser code, so keep it dependency-free.
const slugPart = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Kick-off date in Nigerian time (WAT, UTC+1) as YYYY-MM-DD. */
export function watDate(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function matchSlug(event) {
  return `${watDate(event.event_date)}-${slugPart(event.home_team)}-vs-${slugPart(event.away_team)}`;
}
