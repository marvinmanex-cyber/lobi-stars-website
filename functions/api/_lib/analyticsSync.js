// Analytics intelligence, Phase 2: copies Google Search Console and GA4 figures
// into the club's own database once a day (Admin › Analytics › Google & Search).
//
// Tables (one row per day and dimension; a re-sync updates the row):
//   gsc_daily (date, dim, value, clicks, impressions, ctr, position)
//     dim = total | page | query | country | device. Four separate views rather
//     than every combination: far fewer rows (D1 free plan write limit) and
//     Google hides rare queries in combinations anyway.
//   ga4_daily (date, page_path, channel, device, sessions, users, engagement_rate, avg_session_duration)
//   ga4_events_daily (date, event_name, event_count)  - the key events and page views
//
// A sync runs in steps (one page of Google results, up to 1,000 rows, per
// request) to stay within Cloudflare's per-request limits. The first sync takes
// 90 days; after that each daily sync re-reads the last 4 days (Search Console
// reports with a 2-3 day delay). Throttling (429) and server errors are retried;
// a failing part is recorded and skipped, never crashing the job. No personal
// data: Google only returns totals per page, query, country, device, channel.
import { accessToken, serviceAccount } from './googleAuth.js';
import { logAdminAction } from './adminSession.js';

export const KEY_EVENTS = ['page_view', 'ticket_purchase_start', 'ticket_purchase_complete', 'kitchen_order_start', 'kitchen_order_complete',
  'newsletter_signup', 'membership_signup', 'watch_live_click', 'whatsapp_channel_join_click', 'social_click', 'prediction_submitted'];
const GSC_DIMS = ['total', 'page', 'query', 'country', 'device'];
const PAGE = 1000;
const FIRST_DAYS = 90, DAILY_DAYS = 4, START_HOUR_LAGOS = 5;
const STALE_MS = 15 * 60 * 1000;

let ready = false;
export async function ensureAnalyticsSyncSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS gsc_daily (date TEXT NOT NULL, dim TEXT NOT NULL, value TEXT NOT NULL, clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0, ctr REAL NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0, PRIMARY KEY (date, dim, value))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ga4_daily (date TEXT NOT NULL, page_path TEXT NOT NULL, channel TEXT NOT NULL, device TEXT NOT NULL,
      sessions INTEGER NOT NULL DEFAULT 0, users INTEGER NOT NULL DEFAULT 0, engagement_rate REAL NOT NULL DEFAULT 0, avg_session_duration REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (date, page_path, channel, device))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ga4_events_daily (date TEXT NOT NULL, event_name TEXT NOT NULL, event_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, event_name))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS analytics_sync (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`),
  ]);
  ready = true;
}

const fake = env => String(env.ANALYTICS_SYNC_FAKE) === '1';
const siteUrl = env => String(env.GSC_SITE_URL || 'sc-domain:lobistarsfc.com').trim();
const propertyId = env => String(env.GA4_PROPERTY_ID || '').trim().replace(/^properties\//, '');

/** What is set up (names only, never values). */
export function syncConfig(env) {
  if (fake(env)) return { gsc: true, ga4: true, missing: [], fake: true };
  const sa = serviceAccount(env);
  const missing = [];
  if (sa.error) missing.push(sa.error);
  if (!/^\d{5,15}$/.test(propertyId(env))) missing.push('GA4_PROPERTY_ID is not set (the GA4 property number)');
  return { gsc: !sa.error && /^(sc-domain:|https?:\/\/)/.test(siteUrl(env)), ga4: !sa.error && /^\d{5,15}$/.test(propertyId(env)), missing, serviceAccount: sa.error ? null : sa.email };
}

const lagosDay = (t = Date.now()) => new Date(t + 3600e3).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const getState = async (db, key) => { const r = await db.prepare(`SELECT value FROM analytics_sync WHERE key = ?`).bind(key).first(); try { return r ? JSON.parse(r.value) : null; } catch { return null; } };
const setState = (db, key, v) => db.prepare(`INSERT INTO analytics_sync (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, JSON.stringify(v), new Date().toISOString()).run();

// ── Google calls (with retries) ──
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function google(env, url, body) {
  const f = fake(env) ? fakeFetch : fetch;
  const token = fake(env) ? 'fake' : await accessToken(env);
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await f(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    const t = await r.text().catch(() => '');
    last = `HTTP ${r.status}: ${t.replace(/\s+/g, ' ').slice(0, 200)}`;
    if (r.status === 429 || r.status >= 500) { await sleep(1000 * (attempt + 1) * (attempt + 1)); continue; }
    break; // 400/401/403: retrying won't help (wrong ID or no access)
  }
  throw new Error(last);
}

async function gscPage(env, task, start, end, offset) {
  const d = await google(env, `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl(env))}/searchAnalytics/query`, {
    startDate: start, endDate: end, dimensions: task.dim === 'total' ? ['date'] : ['date', task.dim], rowLimit: PAGE, startRow: offset, dataState: 'all', type: 'web',
  });
  const rows = (d.rows || []).map(r => [r.keys[0], task.dim, task.dim === 'total' ? '' : String(r.keys[1] || ''), r.clicks || 0, r.impressions || 0, r.ctr || 0, r.position || 0]);
  return { rows, more: (d.rows || []).length === PAGE };
}

async function ga4Page(env, task, start, end, offset) {
  const events = task.kind === 'ga4-events';
  const body = {
    dateRanges: [{ startDate: start, endDate: end }], limit: PAGE, offset, keepEmptyRows: false,
    dimensions: events ? [{ name: 'date' }, { name: 'eventName' }] : [{ name: 'date' }, { name: 'pagePath' }, { name: 'sessionDefaultChannelGroup' }, { name: 'deviceCategory' }],
    metrics: events ? [{ name: 'eventCount' }] : [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }, { name: 'averageSessionDuration' }],
    ...(events ? { dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: KEY_EVENTS } } } } : {}),
  };
  const d = await google(env, `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId(env) || '0'}:runReport`, body);
  const day = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const rows = (d.rows || []).map(r => {
    const dv = r.dimensionValues.map(x => x.value), mv = r.metricValues.map(x => Number(x.value) || 0);
    return events ? [day(dv[0]), dv[1], Math.round(mv[0])] : [day(dv[0]), dv[1] || '(not set)', dv[2] || '(not set)', dv[3] || '(not set)', Math.round(mv[0]), Math.round(mv[1]), mv[2], mv[3]];
  });
  return { rows, more: offset + rows.length < (Number(d.rowCount) || 0) };
}

// ── Saving (multi-row upserts; values from Google are escaped) ──
const s = v => `'${String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 400).replace(/'/g, "''")}'`;
const n = v => (Number.isFinite(Number(v)) ? String(Number(v)) : '0');
async function save(db, kind, rows) {
  if (!rows.length) return;
  const T = {
    gsc: ['gsc_daily (date, dim, value, clicks, impressions, ctr, position)', r => `(${s(r[0])}, ${s(r[1])}, ${s(r[2])}, ${n(r[3])}, ${n(r[4])}, ${n(r[5])}, ${n(r[6])})`,
      'ON CONFLICT (date, dim, value) DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions, ctr = excluded.ctr, position = excluded.position'],
    'ga4-traffic': ['ga4_daily (date, page_path, channel, device, sessions, users, engagement_rate, avg_session_duration)', r => `(${s(r[0])}, ${s(r[1])}, ${s(r[2])}, ${s(r[3])}, ${n(r[4])}, ${n(r[5])}, ${n(r[6])}, ${n(r[7])})`,
      'ON CONFLICT (date, page_path, channel, device) DO UPDATE SET sessions = excluded.sessions, users = excluded.users, engagement_rate = excluded.engagement_rate, avg_session_duration = excluded.avg_session_duration'],
    'ga4-events': ['ga4_events_daily (date, event_name, event_count)', r => `(${s(r[0])}, ${s(r[1])}, ${n(r[2])})`, 'ON CONFLICT (date, event_name) DO UPDATE SET event_count = excluded.event_count'],
  }[kind];
  const stmts = [];
  for (let i = 0; i < rows.length; i += 100) stmts.push(db.prepare(`INSERT INTO ${T[0]} VALUES ${rows.slice(i, i + 100).map(T[1]).join(', ')} ${T[2]}`));
  await db.batch(stmts);
}

// ── Runs ──
/** Starts a sync (unless one is running). days: how far back (default 90 the first time, else 4). */
export async function startSync(env, { trigger = 'manual', by = 'Automatic', days = null } = {}) {
  const db = env.DB;
  await ensureAnalyticsSyncSchema(db);
  const cfg = syncConfig(env);
  if (!cfg.gsc && !cfg.ga4) return { error: 'Not set up yet', missing: cfg.missing };
  const run = await getState(db, 'run');
  if (run && !run.done && Date.now() - Date.parse(run.updated) < STALE_MS) return { run, already: true };
  const have = await db.prepare(`SELECT (SELECT COUNT(*) FROM gsc_daily) + (SELECT COUNT(*) FROM ga4_daily) AS n`).first();
  const span = days || (have.n ? DAILY_DAYS : FIRST_DAYS);
  const end = lagosDay(), start = addDays(end, -(span - 1));
  const tasks = [...(cfg.gsc ? GSC_DIMS.map(dim => ({ kind: 'gsc', dim })) : []), ...(cfg.ga4 ? [{ kind: 'ga4-traffic' }, { kind: 'ga4-events' }] : [])];
  const next = { id: `as_${Date.now().toString(36)}`, trigger, by, start, end, tasks, idx: 0, offset: 0, rows: 0, failures: [], started: new Date().toISOString(), updated: new Date().toISOString(), done: false };
  await setState(db, 'run', next);
  return { run: next, already: false };
}

/** One step: one page of one task. Returns the run. */
export async function stepSync(env) {
  const db = env.DB;
  await ensureAnalyticsSyncSchema(db);
  const run = await getState(db, 'run');
  if (!run || run.done) return { run };
  const task = run.tasks[run.idx];
  try {
    const page = task.kind === 'gsc' ? await gscPage(env, task, run.start, run.end, run.offset) : await ga4Page(env, task, run.start, run.end, run.offset);
    await save(db, task.kind, page.rows);
    run.rows += page.rows.length;
    if (page.more) run.offset += PAGE; else { run.idx++; run.offset = 0; }
  } catch (err) {
    const msg = String(err.message || err).slice(0, 240);
    run.failures.push({ task: task.kind === 'gsc' ? `Search Console (${task.dim})` : task.kind === 'ga4-traffic' ? 'GA4 traffic' : 'GA4 key events', error: msg });
    // Sign-in or access problems stop the run; anything else skips this part.
    if (/sign-in failed|SERVICE_ACCOUNT|403|401/.test(msg)) run.idx = run.tasks.length; else { run.idx++; run.offset = 0; }
  }
  run.updated = new Date().toISOString();
  if (run.idx >= run.tasks.length) {
    run.done = true; run.finished = run.updated;
    const ok = run.failures.length === 0;
    await setState(db, ok ? 'last_success' : 'last_error', { at: run.finished, start: run.start, end: run.end, rows: run.rows, failures: run.failures, by: run.by });
    if (ok || run.rows) await setState(db, 'last_day', lagosDay());
    if (!ok) await logAdminAction(db, { id: 'system', name: 'Analytics sync' }, 'analytics_sync_failed', run.failures.map(f => `${f.task}: ${f.error}`).join(' | ').slice(0, 480));
    else await logAdminAction(db, { id: 'system', name: 'Analytics sync' }, 'analytics_sync', `${run.start} to ${run.end}: ${run.rows} rows (${run.by})`);
  }
  await setState(db, 'run', run);
  return { run };
}

/** Timer job (every minute): the next step of a running sync, or the daily sync from 05:00 Nigeria time. Returns { more }. */
export async function analyticsTick(env) {
  const cfg = syncConfig(env);
  if (!cfg.gsc && !cfg.ga4) return { more: false, off: true };
  const db = env.DB;
  await ensureAnalyticsSyncSchema(db);
  const run = await getState(db, 'run');
  if (run && !run.done && Date.now() - Date.parse(run.updated) < STALE_MS) { const r = await stepSync(env); return { more: !r.run.done }; }
  const lagosHour = new Date(Date.now() + 3600e3).getUTCHours();
  if (lagosHour >= START_HOUR_LAGOS && (await getState(db, 'last_day')) !== lagosDay()) {
    const s2 = await startSync(env, { trigger: 'daily', by: 'Daily sync' });
    return { more: !!s2.run && !s2.already };
  }
  return { more: false };
}

/** Status for the admin (no secret values). */
export async function syncStatus(env) {
  const db = env.DB;
  await ensureAnalyticsSyncSchema(db);
  const [run, ok, err, counts] = await Promise.all([getState(db, 'run'), getState(db, 'last_success'), getState(db, 'last_error'),
    db.prepare(`SELECT (SELECT COUNT(*) FROM gsc_daily) AS gsc, (SELECT MAX(date) FROM gsc_daily) AS gscLatest, (SELECT COUNT(*) FROM ga4_daily) AS ga4,
      (SELECT MAX(date) FROM ga4_daily) AS ga4Latest, (SELECT COUNT(*) FROM ga4_events_daily) AS events`).first()]);
  return { config: syncConfig(env), run: run ? { ...run, tasks: run.tasks.length } : null, lastSuccess: ok, lastError: err, counts };
}

// ── Test server only (ANALYTICS_SYNC_FAKE=1): pretend Google answers ──
async function fakeFetch(url, opts) {
  const body = JSON.parse(opts.body || '{}');
  const days = [];
  for (let d = (body.startDate || body.dateRanges?.[0]?.startDate); d && d <= (body.endDate || body.dateRanges?.[0]?.endDate); d = addDays(d, 1)) days.push(d);
  const h = str => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  let all = [];
  if (url.includes('searchconsole')) {
    const dim = (body.dimensions || [])[1];
    const vals = { page: ['https://lobistarsfc.com/', 'https://lobistarsfc.com/tickets/', 'https://lobistarsfc.com/fixtures/', 'https://lobistarsfc.com/kitchen/'],
      query: ['lobi stars', 'lobi stars fc', "lobi stars fc today's match", 'lobi stars tickets', 'mccarthy stadium'], country: ['nga', 'gbr', 'usa'], device: ['MOBILE', 'DESKTOP', 'TABLET'] }[dim] || [''];
    for (const d of days) for (const v of vals) { const k = h(d + v); all.push({ keys: dim ? [d, v] : [d], clicks: k % 40, impressions: 50 + (k % 400), ctr: ((k % 40) / (50 + (k % 400))), position: 1 + (k % 200) / 10 }); }
    const start = body.startRow || 0;
    return new Response(JSON.stringify({ rows: all.slice(start, start + body.rowLimit) }), { status: 200 });
  }
  const events = body.dimensions.length === 2;
  for (const d of days) {
    const ymd = d.replace(/-/g, '');
    if (events) for (const e of KEY_EVENTS) { const k = h(d + e); all.push({ dimensionValues: [{ value: ymd }, { value: e }], metricValues: [{ value: String(e === 'page_view' ? 200 + k % 300 : k % 25) }] }); }
    else for (const pth of ['/', '/tickets/', '/fixtures/', '/kitchen/']) for (const ch of ['Organic Search', 'Direct', 'Organic Social']) for (const dev of ['mobile', 'desktop']) {
      const k = h(d + pth + ch + dev); all.push({ dimensionValues: [{ value: ymd }, { value: pth }, { value: ch }, { value: dev }], metricValues: [{ value: String(k % 60) }, { value: String(k % 50) }, { value: String((k % 100) / 100) }, { value: String(k % 300) }] });
    }
  }
  const off = body.offset || 0;
  return new Response(JSON.stringify({ rows: all.slice(off, off + body.limit), rowCount: all.length }), { status: 200 });
}
