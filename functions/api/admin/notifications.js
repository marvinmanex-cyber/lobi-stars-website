import { requireAdminUser } from '../_lib/adminEvents.js';
import { canAccess, inboxSources, can } from '../_lib/adminRoles.js';
import { pendingCount, pendingStatements } from '../_lib/approvals.js';
import { recentAlerts } from '../_lib/activityLog.js';
import { syncEnquiries, maybeDailySummary } from '../_lib/inbox.js';
import { ensureAnalyticsSchema } from '../_lib/analytics.js';
import { sqlTs, isoTs } from '../_lib/reportRange.js';
import { healthSummary } from '../_lib/uptime.js';
import { scoreBellItems } from '../_lib/scores/bell.js';
import { unseenDevices, getPortalSettings, resetRequest } from '../_lib/squadPortal.js';
import { counts as squadCounts } from '../_lib/squadProfiles.js';

// GET /api/admin/notifications -- the admin bell: unread / overdue Inbox messages,
// Predict & Win prizes not yet paid, commentary stream errors today, and
// website health problems (Website Health monitoring).
export async function onRequestGet({ request, env, waitUntil }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  const items = [];
  const tableExists = async n => !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).bind(n).first());

  if (canAccess(admin, 'inbox')) {
    await syncEnquiries(db);
    const scope = inboxSources(admin); // null = every kind of message; Media: only the media@ mailbox
    const r = await db.prepare(
      `SELECT SUM(unread) AS unread, SUM(status IN ('new', 'open') AND COALESCE(last_in_at, created_at) < ?) AS late
       FROM inbox_threads WHERE spam_at IS NULL AND deleted_at IS NULL ${scope ? `AND source IN (${scope.map(() => '?').join(',') || "''"})` : ''}`
    ).bind(isoTs(Date.now() - 48 * 3600e3), ...(scope || [])).first();
    if (r.unread) items.push({ icon: '✉️', title: `${r.unread} unread message${r.unread === 1 ? '' : 's'} in the Inbox`, sub: scope?.length === 1 && scope[0] === 'media_email' ? 'Emails to media@lobistarsfc.com' : 'Contact, sponsorship, hospitality and media emails', href: '/admin/inbox/?tab=unread' });
    if (r.late) items.push({ icon: '⏰', title: `${r.late} message${r.late === 1 ? '' : 's'} waiting over 48 hours`, sub: 'Please reply or close them', href: '/admin/inbox/' });
    // The daily summary email goes out the first time staff open the admin after 8am.
    if (waitUntil) waitUntil(maybeDailySummary(env));
  }
  if (canAccess(admin, 'matchday') && await tableExists('prediction_results')) {
    const { results } = await db.prepare(
      `SELECT r.event_id, e.home_team, e.away_team, r.prize_amount FROM prediction_results r LEFT JOIN events e ON e.id = r.event_id
       WHERE r.winner_member_id IS NOT NULL AND r.prize_paid = 0 ORDER BY r.calculated_at DESC LIMIT 5`
    ).all();
    for (const w of results) items.push({ icon: '🏆', title: `Predict & Win prize not paid yet`, sub: `${w.home_team} vs ${w.away_team} · ₦${Number(w.prize_amount).toLocaleString('en-NG')}`, href: `/admin/predictions/?id=${encodeURIComponent(w.event_id)}` });
  }
  if (canAccess(admin, 'matchday')) {
    await ensureAnalyticsSchema(db);
    const since = sqlTs(Date.now() - 24 * 3600e3);
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM track_events WHERE name = 'commentary_error' AND ts >= ?`).bind(since).first()).n || 0;
    if (n) items.push({ icon: '📻', title: `Commentary stream problems: ${n} in the last 24 hours`, sub: 'Fans saw "Reconnecting". Check the stream on Live Commentary.', href: '/admin/commentary/' });
  }
  if (canAccess(admin, 'settings') && await tableExists('uptime_incidents')) {
    const h = await healthSummary(db);
    for (const i of h.open) items.push({ icon: '🚨', title: `Website problem: ${i.label}`, sub: `${i.error || 'Not responding'} since ${new Date(i.started_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, href: '/admin/health/' });
  }
  // Squad & Staff Data Portal: signed in from a device never seen before (Super Admins).
  if (can(admin, 'squad.portal.manage')) {
    const dev = await unseenDevices(db).catch(() => []);
    const req = resetRequest(await getPortalSettings(db).catch(() => ({})));
    if (req) items.unshift({ icon: '🔑', title: `Squad Data Portal: ${req.name} ${req.emailed ? 'needs the new password' : 'asked for a new password'}`, sub: req.emailed ? `The new password is in your email. Give it to them on ${req.contact}` : `Reach them on ${req.contact}`, href: '/admin/squad-portal/' });
    if (dev.length) items.unshift({ icon: '🔐', title: `Squad Data Portal: signed in from ${dev.length === 1 ? 'a new device' : `${dev.length} new devices`}`, sub: dev.slice(0, 3).map(d => `${d.first_name} on ${d.device}`).join(' · '), href: '/admin/squad-portal/' });
  }
  // Squad profiles submitted from the portal, waiting for club review.
  if (can(admin, 'squad.review')) {
    const c = await squadCounts(db, 'all').catch(() => null);
    if (c?.submitted) items.push({ icon: '🧾', title: `${c.submitted} squad profile${c.submitted === 1 ? '' : 's'} waiting for review`, sub: 'Submitted from the Squad & Staff Data Portal', href: '/admin/squad-profiles/' });
  }
  // Score verification: things waiting for the Website & Data Officer.
  if (can(admin, 'matchday.scores')) items.push(...await scoreBellItems(env).catch(err => { console.error('[bell] scores', err); return []; }));
  // Security alerts from the last day (Super Admins).
  if (can(admin, 'staff.manage')) {
    for (const a of (await recentAlerts(db).catch(() => [])).slice(0, 5)) items.unshift({ icon: '🛡️', title: a.title, sub: `${new Date(a.ts).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${String(a.detail || '').slice(0, 90)}`, href: '/admin/activity/' });
  }
  if (can(admin, 'approvals.approve')) {
    const n = await pendingCount(db).catch(() => 0);
    const st = (await pendingStatements(env, new URL(request.url).origin).catch(() => [])).length;
    if (n + st) items.unshift({ icon: '✅', title: `${n + st} request${n + st === 1 ? '' : 's'} waiting for approval`, sub: [n && `${n} staff or points request${n === 1 ? '' : 's'}`, st && `${st} official statement${st === 1 ? '' : 's'}`].filter(Boolean).join(' · '), href: '/admin/approvals/' });
  }
  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}
