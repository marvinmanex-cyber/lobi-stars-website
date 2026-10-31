// Media Centre › Content Calendar: match days (from the fixtures), newsletter
// Wednesdays and the stories the team plans, each assigned to a person with a
// due date and a status (planned, drafting, waiting for approval, published).
// A planned entry linked to a Media Centre item follows that item's status.
import { ensureMediaSchema, oneLine, clean, newId, mcLog, mcSettings } from './mediaCentre.js';
import { nextWeekly } from './mediaDeadlines.js';

export const CAL_STATUSES = { planned: 'Planned', drafting: 'Drafting', waiting: 'Waiting for approval', published: 'Published' };
export const CAL_TYPES = { news: 'News story', newsletter: 'Lobi Stars Weekly', press: 'Press release', album: 'Photo album', social: 'Social media', video: 'Video', other: 'Other' };
const nowIso = () => new Date().toISOString();

let ready = false;
export async function ensureCalendarSchema(db) {
  if (ready) return;
  await ensureMediaSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS mc_calendar (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'news', notes TEXT,
    assignee_id TEXT, due_at TEXT, status TEXT NOT NULL DEFAULT 'planned', item_id TEXT, event_id TEXT,
    created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  ready = true;
}
const ITEM_TO_CAL = { draft: 'drafting', returned: 'drafting', submitted: 'waiting', scheduled: 'waiting', published: 'published' };

/** Everything between two dates: match days, newsletter Wednesdays, planned items. */
export async function calendar(db, from, to) {
  await ensureCalendarSchema(db);
  const settings = await mcSettings(db);
  const users = (await db.prepare(`SELECT id, full_name FROM mc_users WHERE is_active = 1 ORDER BY full_name`).all()).results.map(u => ({ id: u.id, name: u.full_name }));
  const matches = (await db.prepare(`SELECT id, home_team, away_team, event_date, venue FROM events WHERE active = 1 AND event_date >= ? AND event_date <= ? ORDER BY event_date`).bind(from, to).all().catch(() => ({ results: [] }))).results
    .filter(e => /lobi stars/i.test(`${e.home_team} ${e.away_team}`)).map(e => ({ kind: 'match', id: e.id, title: `${e.home_team} v ${e.away_team}`, at: e.event_date, home: /lobi stars/i.test(e.home_team), venue: e.venue }));
  const wednesdays = [];
  for (let t = Date.parse(from) - 1; wednesdays.length < 10;) { const w = nextWeekly(settings.newsletter_publish, t); if (w > to) break; wednesdays.push({ kind: 'newsletter', title: 'Lobi Stars Weekly goes out', at: w }); t = Date.parse(w) + 60e3; }
  const planned = (await db.prepare(`SELECT c.*, i.status AS item_status, i.correction AS item_correction FROM mc_calendar c LEFT JOIN mc_items i ON i.id = c.item_id WHERE c.due_at IS NULL OR (c.due_at >= ? AND c.due_at <= ?) ORDER BY c.due_at`).bind(from, to).all()).results
    .map(c => ({ kind: 'planned', id: c.id, title: c.title, type: c.type, notes: c.notes, assigneeId: c.assignee_id, assignee: users.find(u => u.id === c.assignee_id)?.name || null, at: c.due_at,
      status: c.item_status ? (ITEM_TO_CAL[c.item_status] || c.status) : c.status, itemId: c.item_id, eventId: c.event_id }));
  return { from, to, matches, wednesdays, planned, users, statuses: CAL_STATUSES, types: CAL_TYPES };
}
export async function saveEntry(env, request, user, b) {
  const db = env.DB;
  await ensureCalendarSchema(db);
  const v = { title: oneLine(b.title, 160), type: CAL_TYPES[b.type] ? b.type : 'other', notes: clean(b.notes, 1000), assignee: oneLine(b.assigneeId, 60) || null,
    due: b.dueAt && Date.parse(b.dueAt) ? new Date(b.dueAt).toISOString() : null, status: CAL_STATUSES[b.status] ? b.status : 'planned', itemId: oneLine(b.itemId, 60) || null, eventId: oneLine(b.eventId, 80) || null };
  if (b.action === 'delete') {
    await db.prepare(`DELETE FROM mc_calendar WHERE id = ?`).bind(String(b.id || '')).run();
    await mcLog(db, { kind: 'media', id: user.id, name: `${user.fullName} (${user.loginId})` }, 'calendar_delete', { section: 'calendar', itemId: b.id, request });
    return { ok: true };
  }
  if (v.title.length < 3) return { error: 'Write what is planned.' };
  const at = nowIso();
  if (b.id) {
    await db.prepare(`UPDATE mc_calendar SET title = ?, type = ?, notes = ?, assignee_id = ?, due_at = ?, status = ?, item_id = ?, event_id = ?, updated_at = ? WHERE id = ?`).bind(v.title, v.type, v.notes || null, v.assignee, v.due, v.status, v.itemId, v.eventId, at, String(b.id)).run();
  } else {
    b.id = newId('cal');
    await db.prepare(`INSERT INTO mc_calendar (id, title, type, notes, assignee_id, due_at, status, item_id, event_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(b.id, v.title, v.type, v.notes || null, v.assignee, v.due, v.status, v.itemId, v.eventId, user.fullName, at, at).run();
  }
  await mcLog(db, { kind: 'media', id: user.id, name: `${user.fullName} (${user.loginId})` }, 'calendar_save', { section: 'calendar', itemType: 'calendar', itemId: b.id, itemTitle: v.title, details: `${CAL_STATUSES[v.status]}${v.due ? `, due ${v.due}` : ''}`, request });
  return { ok: true, id: b.id };
}
