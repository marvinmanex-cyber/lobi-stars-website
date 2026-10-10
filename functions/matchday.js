import { publicMatches, upcomingLobi } from './api/_lib/ssr.js';

// /matchday -- "Matchday Live" in the Matches menu: goes to the live or next
// Lobi Stars home game's Matchday Live page (or the fixtures if none).
export async function onRequestGet({ request, env }) {
  const next = upcomingLobi(await publicMatches(env)).find(m => m.is_home);
  const to = next ? `/matches/${next.slug}/live/` : '/fixtures/';
  return Response.redirect(new URL(to, request.url).toString(), 302);
}
