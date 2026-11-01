import { categories, mcSettings, json } from '../_lib/mediaCentre.js';
import { publicSquad } from '../_lib/squadPublish.js';
import { matchSlug } from '../_lib/matchSlug.js';
import { isHomeGame } from '../_lib/matchCentre.js';

// GET /api/media-centre/meta -- what the editors choose from: news categories,
// the squad (players and coaching staff, for tags), Lobi Stars fixtures (last
// 60 days and the next 120) and the settings that matter on screen.
export async function onRequestGet({ env }) {
  const [cats, squad, settings] = await Promise.all([
    categories(env.DB),
    publicSquad(env).catch(() => ({ players: [], staff: [] })),
    mcSettings(env.DB),
  ]);
  const from = new Date(Date.now() - 60 * 86400e3).toISOString(), to = new Date(Date.now() + 120 * 86400e3).toISOString();
  const events = (await env.DB.prepare(`SELECT * FROM events WHERE active = 1 AND event_date >= ? AND event_date <= ? ORDER BY event_date`).bind(from, to).all().catch(() => ({ results: [] }))).results
    .filter(e => /lobi stars/i.test(`${e.home_team} ${e.away_team}`))
    .map(e => ({ id: e.id, slug: matchSlug(e), label: `${e.home_team} v ${e.away_team}`, home: e.home_team, away: e.away_team, date: e.event_date,
      day: new Date(Date.parse(e.event_date) + 3600e3).toISOString().slice(0, 10), venue: e.venue || '', isHome: isHomeGame(e), competition: e.competition || '' }));
  return json({
    categories: cats.map(c => c.name),
    players: (squad.players || []).map(p => ({ slug: p.slug, name: p.name, number: p.number ?? null, position: p.position || '' })),
    staff: (squad.staff || []).map(s => ({ slug: s.slug, name: s.name, role: s.role || '' })),
    matches: events,
    settings: { newsletterDeadline: settings.newsletter_deadline, newsletterPublish: settings.newsletter_publish, accreditationCloseHours: Number(settings.accreditation_close_hours), whatsappChannel: settings.whatsapp_channel_url || '' },
  });
}
