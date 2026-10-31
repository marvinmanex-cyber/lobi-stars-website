// Squad milestones as they happen (Phase 6). Every 10 minutes (from the every-
// minute timer) each current player's career is worked out from the official
// match records; a milestone not seen before (debut, first goal, 50
// appearances…) is recorded and, if it happened in the last 14 days, a DRAFT
// story suggestion is added to the Media Centre's Latest News for the media
// team ("Musa Adeyemi reaches 50 appearances for Lobi Stars"). Nothing is ever
// published automatically. Recorded milestones are also in the media partner's
// Data Package (verified facts).
import { careerData, careerFor } from './squadCareer.js';
import { ensureProfileSchema, parseJson } from './squadProfiles.js';
import { ensureMediaSchema, createItem, mcLog, SYSTEM, mcSettings, setMcSetting } from './mediaCentre.js';
import { profileName } from '../../../src/lib/squadFields.js';

export const SUGGESTER = { id: 'system', fullName: 'Milestone suggestion' };
const RECENT_MS = 14 * 86400e3, EVERY_MS = 10 * 60e3;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ready = false;
async function ensureMilestoneSchema(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS squad_milestones (
    person_key TEXT NOT NULL, key TEXT NOT NULL, slug TEXT, name TEXT, label TEXT, happened_at TEXT, event_id TEXT,
    suggestion_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY (person_key, key))`).run();
  ready = true;
}
function headline(name, m) {
  const k = m.key;
  if (k === 'debut') return `${name} makes Lobi Stars debut ${m.match || ''}`.trim();
  if (k === 'first_goal') return `${name} scores first Lobi Stars goal ${m.match || ''}`.trim();
  if (k === 'first_assist') return `First Lobi Stars assist for ${name}`;
  if (k === 'first_clean_sheet') return `First Lobi Stars clean sheet for ${name}`;
  if (k === 'first_motm') return `${name} wins first Man of the Match award`;
  if (k === 'first_award') return `${name}: ${m.label.replace(/^First award: /, '')}`;
  if (k.startsWith('apps_')) return `${name} reaches ${k.slice(5)} appearances for Lobi Stars`;
  if (k.startsWith('goals_')) return `${name} reaches ${k.slice(6)} goals for Lobi Stars`;
  if (k.startsWith('hattrick_')) return `Hat-trick for ${name} ${m.match || ''}`.trim();
  if (k.startsWith('season10_')) return `${name} hits 10 goals this season`;
  return `${name}: ${m.label}`;
}

/** Records new milestones; suggests stories for recent ones. Returns { checked, recorded, suggested }. */
export async function detectMilestones(env, { now = Date.now(), force = false } = {}) {
  const db = env.DB;
  await ensureProfileSchema(db); await ensureMilestoneSchema(db); await ensureMediaSchema(db);
  const settings = await mcSettings(db);
  if (!force && settings.milestones_last && now - Date.parse(settings.milestones_last) < EVERY_MS) return { skipped: true };
  await setMcSetting(db, 'milestones_last', new Date(now).toISOString(), 'timer');
  const data = await careerData(db);
  const players = (await db.prepare(`SELECT id, person_id, public_slug, old_slugs, data_json FROM squad_profiles WHERE type = 'player' AND status IN ('LIVE', 'ON_LOAN') AND public_slug IS NOT NULL`).all()).results;
  const known = new Set((await db.prepare(`SELECT person_key || '|' || key AS k FROM squad_milestones`).all()).results.map(r => r.k));
  let recorded = 0, suggested = 0;
  for (const p of players) {
    const d = parseJson(p.data_json, {}), name = profileName(d) || p.public_slug, pk = p.person_id || p.id;
    const c = careerFor(data, [p.public_slug, ...parseJson(p.old_slugs, [])], { goalkeeper: d.positionGroup === 'Goalkeeper' });
    for (const m of c.milestones) {
      if (known.has(`${pk}|${m.key}`)) continue;
      let suggestion = null;
      if (m.date && now - Date.parse(m.date) <= RECENT_MS) {
        const match = m.eventId ? data.byId.get(m.eventId) : null;
        const title = headline(name, m);
        suggestion = await createItem(db, SUGGESTER, 'news', { title, data: {
          category: 'First Team News', headline: title.slice(0, 150),
          summary: `${name}: ${m.label}${m.match ? ` (${m.match})` : ''}. A milestone from the club's official match records.`.slice(0, 320),
          body: `<p><b>Suggested story (milestone):</b> ${esc(name)} – ${esc(m.label)}${m.match ? `, ${esc(m.match)}` : ''}.</p><p>Write the story here: the moment, a quote from the player or coach, and what it means for the club.</p>`,
          players: [p.public_slug], match: match ? { id: match.id, date: new Date(Date.parse(match.date) + 3600e3).toISOString().slice(0, 10), label: `Lobi Stars ${match.home ? 'v' : 'at'} ${match.opponent}` } : null,
          gallery: [], staff: [],
        } });
        suggested++;
        await mcLog(db, SYSTEM, 'milestone_suggestion', { section: 'news', itemType: 'news', itemId: suggestion, itemTitle: title, details: 'Draft story suggestion for the media team (not published)' });
      }
      await db.prepare(`INSERT OR IGNORE INTO squad_milestones (person_key, key, slug, name, label, happened_at, event_id, suggestion_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(pk, m.key, p.public_slug, name, m.label, m.date, m.eventId, suggestion, new Date(now).toISOString()).run();
      known.add(`${pk}|${m.key}`); recorded++;
    }
  }
  return { checked: players.length, recorded, suggested };
}
