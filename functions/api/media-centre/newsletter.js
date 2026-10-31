import { json, getItem } from '../_lib/mediaCentre.js';
import { previewHtmlFor, missing } from '../_lib/mediaNewsletter.js';
import { KINDS } from '../_lib/mediaKinds.js';
import { ensureTable } from '../_lib/matchCentre.js';

// Media Centre › Lobi Stars Weekly helpers.
// POST { data, web?, id? } -- the email (or web) version for the live preview, and what is still missing.
// GET                      -- facts to fill in: the last Lobi Stars result and the next match.
export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  const { value } = await KINDS.newsletter.normalise(b.data || {});
  const r = b.id ? await getItem(env.DB, String(b.id)) : null;
  const html = await previewHtmlFor(env, value, { web: !!b.web, r });
  return json({ html, missing: missing(value) });
}

const lagos = (iso, o) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', ...o });
export async function onRequestGet({ env }) {
  const db = env.DB;
  await ensureTable(db);
  const lobi = e => /lobi stars/i.test(e.home_team);
  const past = await db.prepare(`SELECT e.*, c.status AS mc_status, c.home_score, c.away_score, c.timeline_json, c.lineups_json, c.squad_json FROM events e LEFT JOIN match_centre c ON c.event_id = e.id
    WHERE e.active = 1 AND e.event_date < ? AND (e.home_team LIKE '%Lobi Stars%' OR e.away_team LIKE '%Lobi Stars%') ORDER BY e.event_date DESC LIMIT 1`).bind(new Date().toISOString()).first();
  const next = await db.prepare(`SELECT * FROM events WHERE active = 1 AND event_date > ? AND (home_team LIKE '%Lobi Stars%' OR away_team LIKE '%Lobi Stars%') ORDER BY event_date LIMIT 1`).bind(new Date().toISOString()).first();
  let lastMatch = null;
  if (past) {
    const home = lobi(past), us = home ? past.home_score : past.away_score, them = home ? past.away_score : past.home_score;
    const side = home ? 'home' : 'away';
    let tl = []; try { tl = JSON.parse(past.timeline_json || '[]'); } catch { /* none */ }
    let lu = null; try { lu = JSON.parse(past.lineups_json || 'null'); } catch { /* none */ }
    let squad = null; try { squad = JSON.parse(past.squad_json || 'null'); } catch { /* none */ }
    const scorers = tl.filter(t => ['goal', 'penalty'].includes(t.type) && t.team === side).map(t => `${t.player} ${t.minute}'`).join(', ');
    const lineup = (squad?.starting?.length ? squad.starting.map(p => p.name) : lu?.[side]?.starting || []).join(', ');
    lastMatch = { eventId: past.id, date: lagos(past.event_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), competition: past.competition || 'Nigeria National League',
      opponent: home ? past.away_team : past.home_team, venue: past.venue || '', score: us != null && them != null ? `${us}-${them}` : '', scorers, lineup, played: past.mc_status === 'full-time' };
  }
  const nextMatch = next ? { opponent: lobi(next) ? next.away_team : next.home_team, date: lagos(next.event_date, { weekday: 'long', day: 'numeric', month: 'long' }), kickoff: lagos(next.event_date, { hour: '2-digit', minute: '2-digit' }),
    venue: next.venue || '', isHome: lobi(next), ticketLink: lobi(next) ? '/tickets/' : '/fixtures/' } : null;
  return json({ lastMatch, nextMatch });
}
