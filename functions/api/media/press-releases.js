import { publishedReleases, prDate } from '../_lib/mediaPress.js';
import { mcSettings } from '../_lib/mediaCentre.js';

// GET /api/media/press-releases -- the latest published press releases (headline,
// date, link) and the media contact, for the Media page. Public; cached briefly.
export async function onRequestGet({ env }) {
  const [list, settings] = await Promise.all([publishedReleases(env.DB), mcSettings(env.DB)]);
  const latest = list.slice(0, 4).map(r => ({ slug: r.slug, headline: r.headline || '', subheadline: r.subheadline || '', date: prDate(r.date || r.publishedAt), statement: !!r.statement, url: `/media/press-releases/${r.slug}/` }));
  return Response.json({ latest, total: list.length, contact: settings.press_contact || '' }, { headers: { 'Cache-Control': 'public, max-age=120' } });
}
