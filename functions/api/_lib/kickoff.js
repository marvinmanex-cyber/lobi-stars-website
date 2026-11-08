// The kick-off time used for Predict & Win and Man of the Match, on the official club clock
// (Africa/Lagos). If a match has a date but no kick-off time was entered (saved as midnight,
// Nigerian time), kick-off is taken as 4:00 pm Nigerian time that day.
export const DEFAULT_KICKOFF_HOUR = 16;
const LAGOS_OFFSET_MS = 3600e3; // Nigeria is UTC+1 all year (no summer time)

/** Kick-off as milliseconds since 1970. */
export function effectiveKickoff(eventDate) {
  const t = Date.parse(eventDate);
  if (!Number.isFinite(t)) return t;
  const local = new Date(t + LAGOS_OFFSET_MS);
  const noTime = local.getUTCHours() === 0 && local.getUTCMinutes() === 0 && local.getUTCSeconds() === 0 && local.getUTCMilliseconds() === 0;
  return noTime ? t + DEFAULT_KICKOFF_HOUR * 3600e3 : t;
}
