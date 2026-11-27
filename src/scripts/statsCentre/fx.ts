// One way to show a fixture everywhere in the Statistics Center (owner's request, 27 Nov 2026):
//   Wikki Tourists FC
//          VS            (or the score, e.g. 3–1)
//   Lobi Stars FC
// Each club name stays on one line (never split); VS (or the score) is centred between them, same font and size.
const e = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
export function fx(home: unknown, away: unknown, mid = 'VS', extra = '') {
  const isScore = mid !== 'VS';
  return `<span class="sx-fx${isScore ? ' sx-fx--score' : ''}${extra ? ` ${extra}` : ''}"><span class="sx-club">${e(home)}</span><span class="${isScore ? 'sx-fx-score' : 'sx-vs'}">${e(mid)}</span><span class="sx-club">${e(away)}</span></span>`;
}
/** One club's name on one line (opponent columns, head-to-head and similar). */
export const club = (name: unknown) => `<span class="sx-club sx-club1">${e(name)}</span>`;
/** Plain text (for drop-down options, file names and shared messages, where no layout is possible). */
export const fxText = (home: unknown, away: unknown) => `${String(home ?? '')} vs ${String(away ?? '')}`;
