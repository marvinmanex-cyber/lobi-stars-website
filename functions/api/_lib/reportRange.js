// Date ranges for the analytics dashboard, in Nigerian time (WAT = UTC+1).
// Every range also has a "previous" range of the same length for % change.
const WAT_MS = 60 * 60 * 1000;
const DAY = 86_400_000;

/** WAT midnight of a YYYY-MM-DD date, as a UTC timestamp. */
const watMidnight = ymd => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) - WAT_MS;
const watToday = () => new Date(Date.now() + WAT_MS).toISOString().slice(0, 10);

export function resolveRange(url, seasonStart) {
  const p = url.searchParams;
  const key = ['today', '7d', '30d', 'season', 'custom'].includes(p.get('range')) ? p.get('range') : '30d';
  const tomorrow = watMidnight(watToday()) + DAY;
  let start, end = tomorrow;
  if (key === 'today') start = tomorrow - DAY;
  else if (key === '7d') start = tomorrow - 7 * DAY;
  else if (key === 'season' && /^\d{4}-\d{2}-\d{2}$/.test(seasonStart || '')) start = watMidnight(seasonStart);
  else if (key === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(p.get('from') || '') && /^\d{4}-\d{2}-\d{2}$/.test(p.get('to') || '')) {
    start = watMidnight(p.get('from'));
    end = watMidnight(p.get('to')) + DAY;
    if (end <= start) end = start + DAY;
  } else start = tomorrow - 30 * DAY;
  const len = end - start;
  return {
    key, start, end, prevStart: start - len, prevEnd: start,
    days: Math.round(len / DAY),
    label: `${new Date(start + WAT_MS).toISOString().slice(0, 10)} to ${new Date(end - DAY + WAT_MS).toISOString().slice(0, 10)}`,
  };
}

/** "YYYY-MM-DD HH:MM:SS" (UTC) -- the format SQLite's datetime('now') uses. */
export const sqlTs = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
/** ISO format, used by tables that store ISO timestamps. */
export const isoTs = ms => new Date(ms).toISOString();
