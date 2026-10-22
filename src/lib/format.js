// Dates, ages and heights for the Squad pages (one place, used by the pages,
// the age refresher script and the tests). Times are Africa/Lagos.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2007-04-24" → "24 April, 2007"; "2025-08" → "August 2025". */
export function longDate(iso) {
  const d = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(iso || ''));
  if (!d) return '';
  const m = MONTHS[Number(d[2]) - 1];
  if (!m) return '';
  return d[3] ? `${Number(d[3])} ${m}, ${d[1]}` : `${m} ${d[1]}`;
}

/** Today's date in Lagos as "YYYY-MM-DD". */
export const lagosToday = (now = new Date()) => new Date(now.getTime() + 3600e3).toISOString().slice(0, 10);

/** Whole years from a date of birth ("YYYY-MM-DD") on a day (default: today in Lagos). */
export function ageFrom(dob, today = lagosToday()) {
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob || '')), t = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(today || ''));
  if (!b || !t) return null;
  let a = Number(t[1]) - Number(b[1]);
  if (Number(t[2]) < Number(b[2]) || (Number(t[2]) === Number(b[2]) && Number(t[3]) < Number(b[3]))) a--;
  return a >= 0 && a < 120 ? a : null;
}

/** "24 April, 2007 (age 19)". */
export const birthLine = (dob, today) => { const a = ageFrom(dob, today); return longDate(dob) + (a === null ? '' : ` (age ${a})`); };

/** 178 → "1.78m (5ft 10in)". Inches are rounded; 12 inches carry over to a foot. */
export function heightText(cm) {
  const c = Number(cm);
  if (!Number.isFinite(c) || c < 100 || c > 250) return '';
  let inches = Math.round(c / 2.54), ft = Math.floor(inches / 12);
  inches -= ft * 12;
  return `${(c / 100).toFixed(2)}m (${ft}ft ${inches}in)`;
}

/** Old free-text heights ("1.80 m", "180cm", "180") → centimetres, or null. */
export function heightToCm(text) {
  const s = String(text ?? '').replace(',', '.').trim();
  const m = /^(\d+(?:\.\d+)?)\s*(m|cm)?$/i.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  const cm = (m[2] || '').toLowerCase() === 'm' || v < 3 ? Math.round(v * 100) : Math.round(v);
  return cm >= 100 && cm <= 250 ? cm : null;
}
