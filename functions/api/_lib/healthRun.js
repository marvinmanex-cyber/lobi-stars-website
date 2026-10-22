// Website Health: runs, steps, the current state of each check, alerts and history.
//
// A run is a list of steps (healthChecks.js); each request does one step, so no
// request goes over Cloudflare's limits. The admin page drives a manual run step
// by step (with a progress bar); the timer job drives the automatic runs:
//   - a full check every hour,
//   - a quick check (payments, matchday, background tasks) every 15 minutes on home matchdays,
//   - the daily summary of warnings at 08:00 Nigeria time.
// When a check turns FAIL the security contact is emailed and the bell shows it
// (not again for 6 hours unless it gets worse, nor while it is acknowledged); when
// it is fixed a short "Resolved" email follows. Results are kept for 90 days.
import {
  CATEGORIES, INFO, stepSite, stepPages, stepLinks, linkChunks, stepPagesFinal, stepContent, stepFans,
  stepPayments, stepEmail, stepMatchday, stepTasks, stepSecurity, stepOutside, stepSpeed, PAGES_PER_STEP,
} from './healthChecks.js';
import { alertAddresses, securitySettings, saveSecuritySetting } from './adminSecurity.js';
import { sendEmail } from './email.js';

const LOCK_MS = 90 * 1000;
const STALE_MS = 5 * 60 * 1000;
const FULL_EVERY_MS = 60 * 60 * 1000;
const QUICK_EVERY_MS = 15 * 60 * 1000;
const REPEAT_MS = 6 * 3600 * 1000;
const KEEP_DAYS = 90;

let ready = false;
export async function ensureHealthSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS health_runs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, only TEXT, trigger TEXT NOT NULL, started_by TEXT,
      started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
      steps TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT '{}', lock_until INTEGER, totals TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_health_runs_started ON health_runs (started_at)`),
    // The run in progress and the last full run are looked up every minute (22 Oct 2026).
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_health_runs_open ON health_runs (finished_at, started_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_health_runs_kind ON health_runs (kind, started_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS health_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, check_id TEXT NOT NULL, category TEXT NOT NULL,
      status TEXT NOT NULL, result TEXT NOT NULL, checked_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_health_results_check ON health_results (check_id, checked_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_health_results_run ON health_results (run_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS health_state (
      check_id TEXT PRIMARY KEY, status TEXT NOT NULL, since TEXT NOT NULL, result TEXT NOT NULL, updated_at TEXT NOT NULL,
      alerted_at TEXT, alerted_status TEXT, ack_until TEXT, ack_note TEXT, ack_by TEXT)`),
  ]);
  ready = true;
}

const STEP_FN = {
  site: stepSite, pages_final: stepPagesFinal, content: stepContent, fans: stepFans, payments: stepPayments,
  email: stepEmail, matchday: stepMatchday, tasks: stepTasks, security: stepSecurity, outside: stepOutside,
};
const FULL = ['site', 'pages_final', 'content', 'fans', 'payments', 'email', 'matchday', 'tasks', 'security', 'outside', 'speed:0', 'finish'];
const QUICK = ['payments', 'matchday', 'tasks', 'finish'];
const CATEGORY_STEPS = { pages: ['site', 'pages_final', 'content'], speed: ['site', 'speed:0'] };
const stepsFor = (kind, only) => kind === 'full' ? FULL : kind === 'quick' ? QUICK : [...(CATEGORY_STEPS[only] || [only]), 'finish'];
const stepLabel = s => ({ site: 'Reading the sitemap', pages_final: 'Pages', content: 'Fixtures, shop and partners', fans: 'Fan journeys', payments: 'Payments', email: 'Email', matchday: 'Matchday and broadcast', tasks: 'Background tasks', security: 'Security', outside: 'Outside services', finish: 'Finishing', links_plan: 'Links and pictures' }[s]
  || (s.startsWith('pages:') ? `Pages (group ${Number(s.slice(6)) + 1})` : s.startsWith('links:') ? `Links and pictures (group ${Number(s.slice(6)) + 1})` : s.startsWith('speed:') ? 'Speed' : s));

const rid = () => `hr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const iso = () => new Date().toISOString();
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

/** The run in progress, if any (a run silent for 5 minutes is given up). */
async function activeRun(db) {
  const r = await db.prepare(`SELECT * FROM health_runs WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1`).first();
  if (!r) return null;
  if (Date.now() - Date.parse(r.updated_at) > STALE_MS) {
    await db.prepare(`UPDATE health_runs SET finished_at = ?, totals = ? WHERE id = ?`).bind(iso(), JSON.stringify({ abandoned: true }), r.id).run();
    return null;
  }
  return r;
}

export function progressOf(r) {
  const steps = parse(r.steps, []);
  return { id: r.id, kind: r.kind, only: r.only, trigger: r.trigger, startedBy: r.started_by, startedAt: r.started_at, finishedAt: r.finished_at,
    done: !!r.finished_at, step: Math.min(r.idx, steps.length), steps: steps.length, current: r.finished_at ? null : stepLabel(steps[r.idx] || 'finish'), totals: parse(r.totals) };
}

/** Starts a run, unless one is already running (then that one is returned: never two at once). */
export async function startRun(env, { kind = 'full', only = null, trigger = 'manual', by = null } = {}) {
  const db = env.DB;
  await ensureHealthSchema(db);
  if (kind === 'category' && !CATEGORIES.some(c => c.key === only)) throw new Error('Unknown category');
  const busy = await activeRun(db);
  if (busy) return { run: progressOf(busy), already: true };
  const id = rid(), now = iso();
  await db.prepare(`INSERT INTO health_runs (id, kind, only, trigger, started_by, started_at, updated_at, steps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, kind, only, trigger, by, now, now, JSON.stringify(stepsFor(kind, only))).run();
  return { run: progressOf(await db.prepare(`SELECT * FROM health_runs WHERE id = ?`).bind(id).first()), already: false };
}

/** Does the next step of a run. Returns its progress ({ busy } if another request is doing a step). */
export async function stepRun(env, origin, id) {
  const db = env.DB;
  await ensureHealthSchema(db);
  const now = Date.now();
  const claim = await db.prepare(`UPDATE health_runs SET lock_until = ? WHERE id = ? AND finished_at IS NULL AND (lock_until IS NULL OR lock_until < ?)`).bind(now + LOCK_MS, id, now).run();
  const r = await db.prepare(`SELECT * FROM health_runs WHERE id = ?`).bind(id).first();
  if (!r) return { error: 'Not found' };
  if (!claim.meta?.changes) return { run: progressOf(r), busy: !r.finished_at };
  const steps = parse(r.steps, []);
  const state = parse(r.state, {});
  const step = steps[r.idx] || 'finish';
  const ctx = { env, origin, state, db };
  let results = [], insert = [];
  try {
    if (step === 'finish') {
      const totals = await finishRun(env, origin, r);
      await db.prepare(`UPDATE health_runs SET finished_at = ?, updated_at = ?, idx = ?, totals = ?, state = '{}', lock_until = NULL WHERE id = ?`).bind(iso(), iso(), r.idx + 1, JSON.stringify(totals), id).run();
      return { run: progressOf(await db.prepare(`SELECT * FROM health_runs WHERE id = ?`).bind(id).first()) };
    }
    if (step.startsWith('pages:')) results = await stepPages(ctx, Number(step.slice(6)));
    else if (step === 'links_plan') { const n = linkChunks(state); insert = Array.from({ length: n }, (_, i) => `links:${i}`); }
    else if (step.startsWith('links:')) results = await stepLinks(ctx, Number(step.slice(6)));
    else if (step.startsWith('speed:')) { const o = await stepSpeed(ctx, Number(step.slice(6))); results = o.results; if (o.more) insert = [`speed:${Number(step.slice(6)) + 1}`]; }
    else if (STEP_FN[step]) results = await STEP_FN[step](ctx);
    if (step === 'site' && (r.kind === 'full' || r.only === 'pages')) {
      const n = Math.ceil((state.urls || []).length / PAGES_PER_STEP);
      insert = [...Array.from({ length: n }, (_, i) => `pages:${i}`), 'links_plan'];
    }
  } catch (err) {
    console.error('[health] step', step, err);
    // The step's checks are recorded as "could not check" rather than stopping the run.
    results = Object.entries(INFO).filter(([, i]) => i.category === (step.split(':')[0] === 'pages' || step === 'site' || step === 'pages_final' || step === 'content' ? 'pages' : step.split(':')[0])).slice(0, 1)
      .map(([cid, i]) => ({ id: cid, category: i.category, name: i.name, status: 'WARNING', problem: `This check could not run: ${String(err.message || err).slice(0, 160)}.`, why: i.why, fix: ['Press "Check again". If it keeps happening, send the details to the developer.'], who: 'Developer', fixId: null, details: { step, error: String(err.stack || err).slice(0, 600) }, checkedAt: iso() }));
  }
  const nextSteps = insert.length ? [...steps.slice(0, r.idx + 1), ...insert, ...steps.slice(r.idx + 1)] : steps;
  const writes = results.map(x => db.prepare(`INSERT INTO health_results (run_id, check_id, category, status, result, checked_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, x.id, x.category, x.status, JSON.stringify(x), x.checkedAt));
  writes.push(db.prepare(`UPDATE health_runs SET idx = ?, steps = ?, state = ?, updated_at = ?, lock_until = NULL WHERE id = ?`).bind(r.idx + 1, JSON.stringify(nextSteps), JSON.stringify(state), iso(), id));
  await db.batch(writes);
  return { run: progressOf(await db.prepare(`SELECT * FROM health_runs WHERE id = ?`).bind(id).first()) };
}

const RANK = { PASS: 0, SKIPPED: 0, WARNING: 1, FAIL: 2 };

/** End of a run: update each check's state, send alerts, tidy old results. */
async function finishRun(env, origin, run) {
  const db = env.DB;
  const { results } = await db.prepare(`SELECT result FROM health_results WHERE run_id = ? ORDER BY id`).bind(run.id).all();
  const latest = new Map();
  for (const row of results) { const x = parse(row.result); if (x) latest.set(x.id, x); }
  const prev = new Map((await db.prepare(`SELECT * FROM health_state`).all()).results.map(s => [s.check_id, s]));
  const now = iso(), nowMs = Date.now();
  const failNow = [], resolved = [], writes = [];
  for (const x of latest.values()) {
    const p = prev.get(x.id);
    const acked = p?.ack_until && Date.parse(p.ack_until) > nowMs;
    const since = !p || p.status !== x.status ? now : p.since;
    let alertedAt = p?.alerted_at || null, alertedStatus = p?.alerted_status || null;
    if (x.status === 'FAIL' && !acked && (alertedStatus !== 'FAIL' || !alertedAt || nowMs - Date.parse(alertedAt) > REPEAT_MS)) { failNow.push(x); alertedAt = now; alertedStatus = 'FAIL'; }
    if (x.status === 'PASS' && alertedStatus === 'FAIL') { resolved.push(x); alertedStatus = null; alertedAt = null; }
    const ackUntil = x.status === 'PASS' ? null : p?.ack_until || null;
    writes.push(db.prepare(`INSERT INTO health_state (check_id, status, since, result, updated_at, alerted_at, alerted_status, ack_until, ack_note, ack_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (check_id) DO UPDATE SET status = excluded.status, since = excluded.since, result = excluded.result, updated_at = excluded.updated_at,
      alerted_at = excluded.alerted_at, alerted_status = excluded.alerted_status, ack_until = excluded.ack_until, ack_note = excluded.ack_note, ack_by = excluded.ack_by`)
      .bind(x.id, x.status, since, JSON.stringify(x), now, alertedAt, alertedStatus, ackUntil, ackUntil ? p?.ack_note || null : null, ackUntil ? p?.ack_by || null : null));
  }
  for (const x of failNow) writes.push(db.prepare(`INSERT INTO admin_alerts (kind, title, detail, email_pending) VALUES ('health', ?, ?, 0)`).bind(`Website Health: ${x.name}`, String(x.problem).slice(0, 400)));
  if (Math.random() < 0.1 || run.kind === 'full') {
    writes.push(db.prepare(`DELETE FROM health_results WHERE checked_at < ?`).bind(new Date(nowMs - KEEP_DAYS * 864e5).toISOString()));
    writes.push(db.prepare(`DELETE FROM health_runs WHERE started_at < ?`).bind(new Date(nowMs - KEEP_DAYS * 864e5).toISOString()));
  }
  if (writes.length) await db.batch(writes);
  if (failNow.length || resolved.length) await healthEmail(env, origin, failNow, resolved).catch(err => console.error('[health] email', err));
  const all = [...latest.values()];
  const count = st => all.filter(x => x.status === st).length;
  return { checks: all.length, pass: count('PASS'), warning: count('WARNING'), fail: count('FAIL'), skipped: count('SKIPPED'), alerted: failNow.length, resolved: resolved.length };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wrap = (origin, body) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#14171c;max-width:600px">
  <p style="font-size:13px;color:#5b6470;margin:0 0 12px">Lobi Stars FC admin · Website Health</p>${body}
  <p style="margin:18px 0 0"><a href="${origin}/admin/health/" style="display:inline-block;padding:12px 20px;background:#C11A1F;color:#fff;border-radius:8px;font-weight:700;text-decoration:none">Open Website Health</a></p></div>`;
const block = x => `<div style="border-left:4px solid ${x.status === 'FAIL' ? '#C11A1F' : x.status === 'WARNING' ? '#D97706' : '#15803D'};padding:6px 12px;margin:0 0 12px">
  <strong>${esc(x.name)}</strong><br>${esc(x.problem)}${x.fix?.length ? `<br><span style="color:#5b6470">How to fix: ${x.fix.map((f, i) => `${i + 1}) ${esc(f)}`).join(' ')}</span>` : ''}<br><span style="color:#5b6470">Who: ${esc(x.who)}</span></div>`;

/** "Something broke" / "Resolved" email to the security contact (Settings › Login & Security). */
async function healthEmail(env, origin, failNow, resolved) {
  if (!env.RESEND_API_KEY) return;
  const to = await alertAddresses(env);
  if (!to.length) return;
  if (failNow.length) await sendEmail(env, { to, subject: failNow.length === 1 ? `Website problem: ${failNow[0].name}` : `Website problems: ${failNow.length} things are broken`,
    html: wrap(origin, `<p>Website Health found ${failNow.length === 1 ? 'a problem' : `${failNow.length} problems`}:</p>${failNow.map(block).join('')}`) });
  if (resolved.length) await sendEmail(env, { to, subject: `Resolved: ${resolved.map(x => x.name).join(', ').slice(0, 120)}`,
    html: wrap(origin, `<p>Fixed and working again:</p>${resolved.map(x => `<p>✅ <strong>${esc(x.name)}</strong></p>`).join('')}`) });
}

/** The daily summary (08:00 Nigeria time) of everything that still needs attention. */
export async function maybeDailySummary(env, origin) {
  const db = env.DB;
  const lagos = new Date(Date.now() + 3600e3);
  const today = lagos.toISOString().slice(0, 10);
  if (lagos.getUTCHours() < 8) return false;
  const s = await securitySettings(db);
  if (s.health_summary_day === today) return false;
  await saveSecuritySetting(db, 'health_summary_day', today, 'Website Health');
  const { results } = await db.prepare(`SELECT result FROM health_state WHERE status IN ('WARNING', 'FAIL') AND (ack_until IS NULL OR ack_until < ?)`).bind(iso()).all();
  const items = results.map(r => parse(r.result)).filter(Boolean).sort((a, b) => RANK[b.status] - RANK[a.status]);
  if (!items.length || !env.RESEND_API_KEY) return false;
  const to = await alertAddresses(env);
  await sendEmail(env, { to, subject: `Website Health: ${items.length} ${items.length === 1 ? 'thing needs' : 'things need'} attention`,
    html: wrap(origin, `<p>Good morning. ${items.length === 1 ? 'One thing needs' : `${items.length} things need`} attention on the website:</p>${items.map(block).join('')}`) });
  return true;
}

/** Timer job, every minute: one step of the run in progress, or start the hourly / matchday runs. Returns { more }. */
export async function healthTick(env, origin) {
  const db = env.DB;
  await ensureHealthSchema(db);
  const busy = await activeRun(db);
  if (busy) { const r = await stepRun(env, origin, busy.id); return { more: !!r.run && !r.run.done && !r.busy, run: r.run }; }
  try { await maybeDailySummary(env, origin); } catch (err) { console.error('[health] summary', err); }
  // Fixes a Super Admin switched to "fix automatically from now on" (Website Health › Teach AI).
  try { await (await import('./healthAi.js')).runAutoFixes(env, origin); } catch (err) { console.error('[health] auto fixes', err); }
  const lastFull = await db.prepare(`SELECT started_at FROM health_runs WHERE kind = 'full' ORDER BY started_at DESC LIMIT 1`).first();
  if (!lastFull || Date.now() - Date.parse(lastFull.started_at) > FULL_EVERY_MS) {
    const { run } = await startRun(env, { kind: 'full', trigger: 'auto', by: 'Automatic check' });
    return { more: true, run };
  }
  // Home matchday: a quick check every 15 minutes.
  const day = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const { results } = await db.prepare(`SELECT event_date FROM events WHERE active = 1 AND is_home = 1`).all().catch(() => ({ results: [] }));
  const matchday = results.some(e => new Date(Date.parse(e.event_date) + 3600e3).toISOString().slice(0, 10) === day);
  if (matchday) {
    const lastAny = await db.prepare(`SELECT started_at FROM health_runs ORDER BY started_at DESC LIMIT 1`).first();
    if (!lastAny || Date.now() - Date.parse(lastAny.started_at) > QUICK_EVERY_MS) {
      const { run } = await startRun(env, { kind: 'quick', trigger: 'auto', by: 'Matchday quick check' });
      return { more: true, run };
    }
  }
  return { more: false };
}

/** Everything the Website Health page shows. */
export async function healthOverview(env) {
  const db = env.DB;
  await ensureHealthSchema(db);
  const nowMs = Date.now();
  const [states, lastRun, running] = await db.batch([
    db.prepare(`SELECT * FROM health_state`),
    db.prepare(`SELECT * FROM health_runs WHERE finished_at IS NOT NULL AND (totals IS NULL OR totals NOT LIKE '%abandoned%') ORDER BY finished_at DESC LIMIT 1`),
    db.prepare(`SELECT * FROM health_runs WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1`),
  ]);
  const checks = states.results.map(s => ({ ...parse(s.result, {}), status: s.status, since: s.since, ack: s.ack_until && Date.parse(s.ack_until) > nowMs ? { until: s.ack_until, note: s.ack_note, by: s.ack_by } : null }))
    .filter(c => INFO[c.id]);
  const order = Object.keys(INFO);
  checks.sort((a, b) => RANK[b.status] - RANK[a.status] || order.indexOf(a.id) - order.indexOf(b.id));
  const cats = CATEGORIES.map(c => {
    const mine = checks.filter(x => x.category === c.key);
    const n = st => mine.filter(x => x.status === st).length;
    return { ...c, pass: n('PASS'), warning: n('WARNING'), fail: n('FAIL'), skipped: n('SKIPPED'), status: n('FAIL') ? 'FAIL' : n('WARNING') ? 'WARNING' : mine.length ? 'PASS' : null };
  });
  // Uptime (homepage) over 30 days from the 5-minute checks.
  let uptime30 = null;
  try { const u = await db.prepare(`SELECT SUM(ok) * 1.0 / SUM(n) AS up, SUM(n) AS n FROM uptime_hourly WHERE check_key = 'home' AND hour >= ?`).bind(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 13).replace('T', ' ')).first(); if (u?.n) uptime30 = u.up; } catch {}
  const open = checks.filter(c => c.status === 'FAIL' || c.status === 'WARNING');
  return {
    checks, categories: cats, uptime30,
    problems: { fail: checks.filter(c => c.status === 'FAIL').length, warning: checks.filter(c => c.status === 'WARNING').length, unacknowledged: open.filter(c => !c.ack).length },
    lastRun: lastRun.results[0] ? progressOf(lastRun.results[0]) : null,
    running: running.results[0] && nowMs - Date.parse(running.results[0].updated_at) < STALE_MS ? progressOf(running.results[0]) : null,
  };
}

/** When one check failed and was fixed, over the kept 90 days (only the changes). */
export async function checkHistory(db, id) {
  await ensureHealthSchema(db);
  const { results } = await db.prepare(`SELECT status, checked_at FROM health_results WHERE check_id = ? ORDER BY checked_at`).bind(id).all();
  const changes = [];
  for (const r of results) if (!changes.length || changes[changes.length - 1].status !== r.status) changes.push({ status: r.status, from: r.checked_at });
  return { id, checks: results.length, changes: changes.slice(-60) };
}

/** Acknowledge a problem: it stays visible but no repeat alerts for 24 hours. */
export async function acknowledge(db, id, note, by) {
  await ensureHealthSchema(db);
  const until = new Date(Date.now() + 24 * 3600e3).toISOString();
  const r = await db.prepare(`UPDATE health_state SET ack_until = ?, ack_note = ?, ack_by = ? WHERE check_id = ?`).bind(until, String(note || '').slice(0, 300) || null, by, id).run();
  return r.meta?.changes ? until : null;
}
