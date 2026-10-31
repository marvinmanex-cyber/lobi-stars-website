// Media Centre: upcoming deadlines for the dashboard (and the reminder emails).
// Times are Lagos time (UTC+1, no daylight saving).
import { ensureMediaSchema } from './mediaCentre.js';

const LAGOS = 3600e3;
/** The next date (UTC ISO) of weekday `dow` (0 = Sunday) at "HH:MM" Lagos time, after `from`. */
export function nextWeekly(spec, from = Date.now()) {
  const [dowS, hm = '00:00'] = String(spec || '').split('|');
  const dow = Number(dowS), [h, m] = hm.split(':').map(Number);
  const local = new Date(from + LAGOS);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h || 0, m || 0) - LAGOS);
  let add = (dow - local.getUTCDay() + 7) % 7;
  if (add === 0 && d.getTime() <= from) add = 7;
  return new Date(d.getTime() + add * 86400e3).toISOString();
}
/** The Monday 00:00 (Lagos) that starts the newsletter week containing `t`. */
export function weekStart(t = Date.now()) {
  const local = new Date(t + LAGOS);
  const back = (local.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - back) - LAGOS).toISOString();
}

export async function upcomingDeadlines(env, user, settings) {
  const db = env.DB;
  await ensureMediaSchema(db);
  const out = [];
  // Lobi Stars Weekly: submit by Tuesday 6 PM.
  const due = nextWeekly(settings.newsletter_deadline);
  const nl = await db.prepare(`SELECT id, status FROM mc_items WHERE kind = 'newsletter' AND created_at >= ? ORDER BY created_at DESC LIMIT 1`).bind(weekStart()).first();
  out.push({ kind: 'newsletter', title: 'Lobi Stars Weekly: submit for approval', due, state: nl ? nl.status : 'not started', itemId: nl?.id || null });
  // Content calendar items assigned to this user (phase 5 table; absent before then).
  try {
    const rows = (await db.prepare(`SELECT id, title, due_at, status FROM mc_calendar WHERE assignee_id = ? AND status <> 'published' AND due_at IS NOT NULL ORDER BY due_at LIMIT 10`).bind(user.id).all()).results;
    for (const r of rows) out.push({ kind: 'calendar', title: r.title, due: r.due_at, state: r.status, calendarId: r.id });
  } catch { /* the calendar does not exist yet */ }
  // Accreditation requests waiting for a decision (phase 3 table).
  try {
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM mc_accreditations WHERE status IN ('pending', 'info')`).first())?.n || 0;
    if (n) out.push({ kind: 'accreditation', title: `${n} accreditation request${n === 1 ? '' : 's'} to decide`, due: null, state: 'waiting' });
  } catch { /* not built yet */ }
  return out.sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
}
