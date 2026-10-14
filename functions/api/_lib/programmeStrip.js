// The homepage "Match Day Programme" strip (src/components/programme/ProgrammeBanner.astro):
//   MATCH DAY PROGRAMME
//   Lobi Stars FC vs <next opponent>  HOME|AWAY        Read free →
// The match is THE next Lobi Stars match (nextLobiMatch, the same one as the
// homepage Upcoming Matches card), and the opponent is that fixture's other
// club, never a typed programme title. Built on the server for each homepage
// request (functions/index.js; the page is cached for 30 seconds).
import { nextLobiMatch, opponentOf, lobiAtHome } from './tickets/rules.js';
import { programmeSettings, bucket, LIVE_SQL } from './programme.js';
import { esc } from './fixtureCard.js';

const SAME_MATCH_MS = 12 * 3600e3;

/**
 * { opponent, home, kickoff, programmeSlug|null } for the strip, or null to hide it:
 * no match left, the programme feature is off, or "Homepage banner" is off in
 * Admin › Matchday Programme. While the file storage (R2) isn't connected no
 * programme can be published, so the strip shows "Programme coming soon".
 * A programme belongs to the match when it is published (or its scheduled
 * publish time has come) and its kick-off is within 12 hours of the match's.
 */
export async function programmeStripData(env, matches, now = new Date()) {
  const next = nextLobiMatch(matches, now.getTime());
  if (!next) return null;
  const s = await programmeSettings(env.DB);
  if (!s.enabled || !s.homepageBanner) return null;
  const base = { opponent: opponentOf(next), home: lobiAtHome(next), kickoff: next.event_date };
  if (!bucket(env)) return { ...base, programmeSlug: null };
  const ko = Date.parse(next.event_date);
  const p = await env.DB.prepare(`SELECT slug FROM programmes WHERE ${LIVE_SQL} AND kickoff_at BETWEEN ? AND ? ORDER BY kickoff_at LIMIT 1`)
    .bind(now.toISOString(), new Date(ko - SAME_MATCH_MS).toISOString(), new Date(ko + SAME_MATCH_MS).toISOString()).first();
  return { ...base, programmeSlug: p?.slug || null };
}

/** The strip's inside (escaped). With a programme: a link "Read free →"; without: "Programme coming soon". */
export function programmeStripHtml(d) {
  if (!d) return '';
  const match = `Lobi Stars FC vs ${esc(d.opponent)}`;
  const text = `<span class="pgb-txt"><span class="pgb-k">Match Day Programme</span><span class="pgb-t">${match} <span class="pgb-ha">${d.home ? 'Home' : 'Away'}</span></span></span>`;
  const key = esc(d.programmeSlug || `soon-${d.kickoff}`);
  const main = d.programmeSlug
    ? `<a class="pgb-link" href="/programme/?src=homepage" aria-label="Read the match day programme: ${match}">${text}<span class="pgb-go">Read free &rarr;</span></a>`
    : `<div class="pgb-link pgb-link--soon">${text}<span class="pgb-soon">Programme coming soon</span></div>`;
  return `<div class="pgb-in" data-key="${key}">${main}<button type="button" class="pgb-x" aria-label="Close the programme banner">&times;</button></div>`;
}
