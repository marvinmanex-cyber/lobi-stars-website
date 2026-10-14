// Website health (uptime monitoring). Every 5 minutes (driven by the cron
// Worker) the site checks its own key pages, the database and, during a
// match's commentary window, the commentary stream. Each result is kept for
// 30 days; when something goes down an incident is opened (shown in the admin
// bell, emailed to Super Admins once email works) and closed when it is back.
import { probeStream, publicCommentaryState, getSettings } from './commentary.js';
import { ensureAdminSchema } from './adminSession.js';
import { sendEmail } from './email.js';

export const CHECKS = [
  { key: 'home', label: 'Homepage', path: '/' },
  { key: 'tickets', label: 'Tickets page', path: '/tickets/' },
  { key: 'programme', label: 'Match Day Programme', path: '/programme/' },
  { key: 'fixtures_api', label: 'Fixtures data', path: '/api/events' },
  { key: 'database', label: 'Database' },
  { key: 'stream', label: 'Commentary stream (match days)' },
];
export const INTERVAL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10000;
const SLOW_MS = 8000;

let ready = false;
export async function ensureUptimeSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS uptime_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_key TEXT NOT NULL,
      ok INTEGER NOT NULL,
      status INTEGER,
      ms INTEGER,
      error TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_uptime_checks ON uptime_checks (check_key, checked_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS uptime_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_key TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      error TEXT,
      alerted INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_uptime_incidents ON uptime_incidents (check_key, ended_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS uptime_meta (key TEXT PRIMARY KEY, value TEXT)`),
  ]);
  ready = true;
}

async function timed(fn) {
  const started = Date.now();
  try { return { ...(await fn()), ms: Date.now() - started }; }
  catch (err) { return { ok: false, status: 0, ms: Date.now() - started, error: err?.name === 'AbortError' ? `No answer within ${TIMEOUT_MS / 1000} seconds` : String(err?.message || err).slice(0, 200) }; }
}
async function checkPage(origin, path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(new URL(path, origin), { signal: ctrl.signal, headers: { 'User-Agent': 'LobiStarsFC-Health/1.0', 'Cache-Control': 'no-cache' }, redirect: 'manual' });
    try { await r.body?.cancel(); } catch {}
    return { ok: r.status < 400, status: r.status, error: r.status >= 400 ? `HTTP ${r.status}` : null };
  } finally { clearTimeout(t); }
}

/** One round of checks. Skipped (null) if the last round was under 5 minutes ago, unless force. */
export async function runChecks(env, origin, { force = false } = {}) {
  const db = env.DB;
  await ensureUptimeSchema(db);
  const now = Date.now();
  if (!force) {
    const last = await db.prepare(`SELECT value FROM uptime_meta WHERE key = 'last_run'`).first();
    if (last && now - Number(last.value) < INTERVAL_MS - 30000) return null;
  }
  // Claim this round so two callers at once don't both run it.
  const claim = await db.prepare(`INSERT INTO uptime_meta (key, value) VALUES ('last_run', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value
      WHERE ? OR CAST(uptime_meta.value AS INTEGER) < ?`).bind(String(now), force ? 1 : 0, now - INTERVAL_MS + 30000).run();
  if (!force && !claim.meta?.changes) return null;

  const results = {};
  await Promise.all(CHECKS.map(async c => {
    if (c.path) results[c.key] = await timed(() => checkPage(origin, c.path));
    else if (c.key === 'database') results[c.key] = await timed(async () => { await db.prepare('SELECT 1').first(); return { ok: true, status: 200 }; });
    else if (c.key === 'stream') {
      // Only during a match's commentary window (the stream is off between matches).
      const st = await publicCommentaryState(env).catch(() => null);
      if (st && st.state === 'live') {
        const s = await getSettings(env);
        const url = env.PARTNER_ORIGIN_STREAM_URL || (s.streamUrl ? new URL(s.streamUrl, origin).href : null);
        if (url) {
          const p = await probeStream(url);
          results[c.key] = { ok: p.ok, status: p.status, ms: p.ms, error: p.ok ? null : (p.error || `No audio (HTTP ${p.status})`) };
        }
      }
    }
  }));
  for (const r of Object.values(results)) if (r.ok && r.ms > SLOW_MS) r.error = `Slow: ${(r.ms / 1000).toFixed(1)} s`;

  const iso = new Date(now).toISOString();
  const open = (await db.prepare(`SELECT * FROM uptime_incidents WHERE ended_at IS NULL`).all()).results;
  const writes = [], opened = [], closed = [];
  for (const [key, r] of Object.entries(results)) {
    // checked_at uses the database clock format ("YYYY-MM-DD HH:MM:SS", UTC) so the 24h / 7-day windows compare correctly.
    writes.push(db.prepare(`INSERT INTO uptime_checks (check_key, ok, status, ms, error) VALUES (?, ?, ?, ?, ?)`).bind(key, r.ok ? 1 : 0, r.status ?? null, r.ms ?? null, r.error || null));
    const inc = open.find(i => i.check_key === key);
    if (!r.ok && !inc) { writes.push(db.prepare(`INSERT INTO uptime_incidents (check_key, started_at, error) VALUES (?, ?, ?)`).bind(key, iso, r.error || 'Down')); opened.push({ key, error: r.error }); }
    if (r.ok && inc) { writes.push(db.prepare(`UPDATE uptime_incidents SET ended_at = ? WHERE id = ?`).bind(iso, inc.id)); closed.push({ key, since: inc.started_at }); }
  }
  // The stream is only checked on match days: close its incident once the window ends.
  const streamInc = open.find(i => i.check_key === 'stream');
  if (streamInc && !results.stream) writes.push(db.prepare(`UPDATE uptime_incidents SET ended_at = ? WHERE id = ?`).bind(iso, streamInc.id));
  if (Math.random() < 0.05) writes.push(db.prepare(`DELETE FROM uptime_checks WHERE checked_at < datetime('now', '-30 days')`));
  await db.batch(writes);
  if (opened.length || closed.length) await alertStaff(env, origin, opened, closed).catch(err => console.error('[uptime] alert', err));
  return { checkedAt: iso, results, opened, closed };
}

const label = k => CHECKS.find(c => c.key === k)?.label || k;

/** Email Super Admins (when email is set up). Never throws. */
async function alertStaff(env, origin, opened, closed) {
  if (!env.RESEND_API_KEY) return;
  await ensureAdminSchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT email FROM admin_users WHERE active = 1 AND role = 'super_admin' AND email IS NOT NULL AND email != ''`).all();
  const to = [...new Set(results.map(r => r.email))];
  if (!to.length) return;
  const lines = [
    ...opened.map(o => `DOWN: ${label(o.key)} (${o.error || 'not responding'})`),
    ...closed.map(c => `Back up: ${label(c.key)} (down since ${new Date(c.since).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })})`),
  ];
  const subject = opened.length ? `Website problem: ${opened.map(o => label(o.key)).join(', ')}` : `Website back to normal: ${closed.map(c => label(c.key)).join(', ')}`;
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  await sendEmail(env, {
    to, subject,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>${lines.map(esc).join('<br>')}</p><p><a href="${origin}/admin/health/">Open Website Health</a></p></div>`,
    text: `${lines.join('\n')}\n\n${origin}/admin/health/`,
  });
}

/** Status, uptime percentages and incidents for the admin page and bell. */
export async function healthSummary(db) {
  await ensureUptimeSchema(db);
  const [latest, day, week, incidents, open, meta] = await db.batch([
    db.prepare(`SELECT c.* FROM uptime_checks c JOIN (SELECT check_key, MAX(id) AS id FROM uptime_checks GROUP BY check_key) m ON m.id = c.id`),
    db.prepare(`SELECT check_key, AVG(ok) AS up, AVG(ms) AS ms, COUNT(*) AS n FROM uptime_checks WHERE checked_at >= datetime('now', '-1 day') GROUP BY check_key`),
    db.prepare(`SELECT check_key, AVG(ok) AS up, COUNT(*) AS n FROM uptime_checks WHERE checked_at >= datetime('now', '-7 days') GROUP BY check_key`),
    db.prepare(`SELECT * FROM uptime_incidents ORDER BY id DESC LIMIT 30`),
    db.prepare(`SELECT * FROM uptime_incidents WHERE ended_at IS NULL ORDER BY id`),
    db.prepare(`SELECT value FROM uptime_meta WHERE key = 'last_run'`),
  ]);
  const by = (rows, k) => rows.results.find(r => r.check_key === k);
  return {
    lastRun: meta.results[0] ? new Date(Number(meta.results[0].value)).toISOString() : null,
    checks: CHECKS.map(c => {
      const l = by(latest, c.key), d = by(day, c.key), w = by(week, c.key);
      return { key: c.key, label: c.label, ok: l ? !!l.ok : null, status: l?.status ?? null, ms: l?.ms ?? null, error: l?.error || null, checkedAt: l?.checked_at || null,
        uptime24h: d ? d.up : null, avgMs24h: d ? Math.round(d.ms) : null, uptime7d: w ? w.up : null };
    }),
    incidents: incidents.results.map(i => ({ ...i, label: label(i.check_key) })),
    open: open.results.map(i => ({ ...i, label: label(i.check_key) })),
  };
}
