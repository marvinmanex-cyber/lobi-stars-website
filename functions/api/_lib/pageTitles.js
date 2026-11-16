// Titles and descriptions for pages assembled on the server (match pages, Matchday Live): the one approved in
// the SEO Scanner (src/data/seo.json, saved by AI Fix or by hand) when there is one, otherwise a default that
// fits Google's limits (title at most 60 characters, description 70-160). Without this, the server's own title
// replaced the approved one, so "Title too long" fixes never reached the page (Nov 2026).
import seoOverrides from '../../../src/data/seo.json';

const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/[\s,.;:–-]+\S*$/, '')}…`);
/** The first candidate that fits in 60 characters (else the last one, shortened). */
export function fitTitle(candidates) {
  const ok = candidates.find(t => t && t.length <= 60);
  return ok || clip(candidates[candidates.length - 1] || '', 60);
}
const shortTeam = n => String(n || '').replace(/\s+F\.?C\.?$/i, '').trim();

/** { title, description } for a server-assembled page at `path` (approved override first). */
export function pageMeta(path, { title, description }) {
  const o = seoOverrides[path] || seoOverrides[path.replace(/\/$/, '')] || {};
  let d = o.description || description || '';
  if (d.length > 160) d = clip(d, 160);
  return { title: o.title || title, description: d };
}
/** Default match titles that fit: "Home vs Away | Match Centre", shorter forms when names are long. */
export function matchTitle(home, away, label) {
  return fitTitle([`${home} vs ${away} | ${label}`, `${shortTeam(home)} vs ${shortTeam(away)} | ${label}`, `${home} vs ${away}`, `${shortTeam(home)} vs ${shortTeam(away)} | Lobi Stars`]);
}
