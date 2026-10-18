import { requireAdminUser } from '../_lib/adminEvents.js';
import { syncEnquiries } from '../_lib/inbox.js';
import { canAccess } from '../_lib/adminRoles.js';
import { ensureAnalyticsSchema } from '../_lib/analytics.js';
import { ensureContactsSchema } from '../_lib/contacts.js';
import { listMatches, isMatchDay, toSummary } from '../_lib/matchCentre.js';
import { publicCommentaryState, liveListeners } from '../_lib/commentary.js';
import { resolveRange, sqlTs, isoTs } from '../_lib/reportRange.js';

const pct = (now, prev) => (prev ? Math.round(((now - prev) / prev) * 100) : null);
const isLobi = n => /lobi stars/i.test(n || '');

// GET /api/admin/dashboard -- the cards on the admin home page. Each card is
// only included when the signed-in person's role can see that area.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  const can = a => canAccess(admin, a);
  const url = new URL(request.url);
  const out = {};
  const one = async (sql, binds = []) => (await db.prepare(sql).bind(...binds).first()) || {};
  const tableExists = async n => !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).bind(n).first());

  // Next (or live) Lobi Stars match: everyone.
  try {
    const now = Date.now();
    const rows = (await listMatches(db)).filter(m => isLobi(m.home_team) || isLobi(m.away_team));
    const live = rows.find(m => m.status === 'live' || m.status === 'half-time');
    const next = live || rows.filter(m => m.status === 'scheduled' && new Date(m.event_date).getTime() > now - 3 * 3600e3)
      .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))[0];
    if (next) {
      const s = toSummary(next, next);
      out.nextMatch = {
        id: next.id, home: next.home_team, away: next.away_team, date: next.event_date, venue: next.venue,
        competition: next.competition, status: next.status, score: s.home_score != null ? `${s.home_score} – ${s.away_score}` : null,
        matchDay: isMatchDay(s, now), home_game: !!s.is_home,
        controlHref: can('matchday-content') ? `/admin/match-centre/?id=${encodeURIComponent(next.id)}` : null,
      };
    }
  } catch (err) { console.error('[dashboard] match', err); }

  // Messages (contact, sponsorship and hospitality enquiries) and how many wait for a reply in the Inbox.
  if (can('fans') || can('inbox')) {
    await ensureContactsSchema(db);
    await syncEnquiries(db);
    const week = Date.now() - 7 * 86400e3;
    const [n, p] = await Promise.all([
      one(`SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= ?`, [isoTs(week)]),
      one(`SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= ? AND created_at < ?`, [isoTs(week - 7 * 86400e3), isoTs(week)]),
    ]);
    const w = await one(`SELECT COUNT(*) AS n, SUM(unread) AS u FROM inbox_threads WHERE spam_at IS NULL AND status IN ('new', 'open')`);
    out.messages = { week: n.n || 0, change: pct(n.n || 0, p.n || 0), waiting: w.n || 0, unread: w.u || 0 };
  }

  // Backup reminder (Super Admins): the last data backup download.
  if (can('staff')) {
    try {
      const b = await one(`SELECT MAX(ts) AS ts FROM admin_log WHERE action = 'backup_download'`);
      out.lastBackup = b?.ts || null;
    } catch { /* activity log not created yet */ }
    // The automatic nightly backup: set up?, the last one, a failure.
    try {
      const { securitySettings } = await import('../_lib/adminSecurity.js');
      const s = await securitySettings(db);
      const parse = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
      out.autoBackup = { ready: !!(env.BACKUP_BUCKET && env.BACKUP_KEY), last: parse(s.auto_backup_last), error: parse(s.auto_backup_error) };
    } catch { /* settings not created yet */ }
  }

  // New contacts this week.
  if (can('fans') || can('analytics')) {
    await ensureContactsSchema(db);
    const week = Date.now() - 7 * 86400e3;
    const [n, p, t] = await Promise.all([
      one(`SELECT COUNT(*) AS n FROM contacts WHERE first_seen >= ?`, [isoTs(week)]),
      one(`SELECT COUNT(*) AS n FROM contacts WHERE first_seen >= ? AND first_seen < ?`, [isoTs(week - 7 * 86400e3), isoTs(week)]),
      one(`SELECT COUNT(*) AS n FROM contacts`),
    ]);
    out.contacts = { week: n.n || 0, change: pct(n.n || 0, p.n || 0), total: t.n || 0 };
  }

  // Page views today (Nigerian time) vs yesterday.
  if (can('analytics')) {
    await ensureAnalyticsSchema(db);
    const r = resolveRange(new URL('?range=today', url), '');
    const [n, p] = await Promise.all([
      one(`SELECT COUNT(*) AS n FROM pageviews WHERE ts >= ? AND ts < ?`, [sqlTs(r.start), sqlTs(r.end)]),
      one(`SELECT COUNT(*) AS n FROM pageviews WHERE ts >= ? AND ts < ?`, [sqlTs(r.prevStart), sqlTs(r.prevEnd)]),
    ]);
    out.pageViews = { today: n.n || 0, change: pct(n.n || 0, p.n || 0) };
  }

  // Live commentary listeners (only while a match is on air).
  if (can('matchday') || can('analytics')) {
    try {
      const c = await publicCommentaryState(env);
      if (c.state === 'live' && c.fixture) out.listeners = { now: await liveListeners(db, c.fixture.id), match: `${c.fixture.home_team} vs ${c.fixture.away_team}` };
    } catch (err) { console.error('[dashboard] listeners', err); }
  }

  // Latest Predict & Win winner and whether the prize has been paid.
  if (can('matchday') && await tableExists('prediction_results')) {
    const w = await db.prepare(
      `SELECT r.event_id, r.home_score, r.away_score, r.prize_amount, r.prize_paid, r.winner_member_id, r.calculated_at,
              m.first_name, m.last_name, e.home_team, e.away_team
       FROM prediction_results r LEFT JOIN members m ON m.id = r.winner_member_id LEFT JOIN events e ON e.id = r.event_id
       ORDER BY r.calculated_at DESC LIMIT 1`
    ).first();
    if (w) out.winner = {
      match: `${w.home_team} vs ${w.away_team}`, score: `${w.home_score} – ${w.away_score}`, prize: w.prize_amount,
      name: w.winner_member_id ? `${w.first_name || ''} ${w.last_name ? w.last_name.charAt(0) + '.' : ''}`.trim() : null,
      paid: !!w.prize_paid, href: `/admin/predictions/?id=${encodeURIComponent(w.event_id)}`,
    };
  }

  // In-seat food today (paid orders only).
  if ((can('commerce') || can('analytics')) && await tableExists('food_orders')) {
    try {
      const watNow = new Date(Date.now() + 3600e3);
      const start = new Date(Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth(), watNow.getUTCDate()) - 3600e3).toISOString();
      const { results } = await db.prepare(`SELECT items_json, total_kobo FROM food_orders WHERE payment_status = 'paid' AND order_status IN ('PAID','ACCEPTED','PREPARING','OUT_FOR_DELIVERY','DELIVERED') AND created_iso >= ?`).bind(start).all();
      const qty = {};
      for (const o of results) { try { for (const i of JSON.parse(o.items_json)) qty[i.name] = (qty[i.name] || 0) + i.qty; } catch {} }
      const top = Object.entries(qty).sort((a, b) => b[1] - a[1])[0];
      out.food = { orders: results.length, revenueKobo: results.reduce((s, o) => s + o.total_kobo, 0), top: top ? `${top[0]} (${top[1]})` : null, href: can('commerce') ? '/admin/food-orders/live/' : '/admin/food-orders/analytics/' };
    } catch (err) { console.error('[dashboard] food', err); }
  }

  out.quick = [
    can('content') && { label: 'New article', href: '/admin/#/collections/news/new', icon: '📝' },
    can('matchday-content') && { label: 'Update score', href: out.nextMatch?.controlHref || '/admin/match-centre/', icon: '⚽' },
    (can('fans') || can('inbox')) && { label: 'Reply to messages', href: '/admin/fans/?source=contact_form', icon: '✉️' },
    can('fans') && admin.canExport && { label: 'Download contacts', href: '/admin/fans/#exports', icon: '⬇️' },
    can('matchday') && { label: 'Add a match', href: '/admin/matches/', icon: '📅' },
  ].filter(Boolean);
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
