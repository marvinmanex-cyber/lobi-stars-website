// Match-day alerts for fans: phone / computer notifications (Web Push) for
//   radio    🎙️ the pre-match radio show / commentary goes on air (Lobi Stars FC Live)
//   match    ⚽ kick-off, half-time, second half, full time
//   goals    🥅 goals
// plus any alert staff send by hand (Admin › Matchday › Fan Match Alerts).
// Fans turn them on with "🔔 Match alerts" on the commentary, match and
// fixtures pages and the homepage; no account or personal details needed.
//
// Sending: an alert becomes a job; subscribers are sent in batches of 40
// (Cloudflare's free plan allows about 50 outgoing requests per request).
// The first batch goes straight away; the rest are sent by the next requests
// (open admin pages ask every few seconds, the cron Worker every minute, and
// the site asks itself to continue). Each automatic alert is sent once per
// match (fan_alert_once).
import { pushReady } from './foodAlerts.js';
import { sendEncryptedPush } from './webPush.js';
import { matchSlug } from './matchSlug.js';

export const CATEGORIES = { radio: 'Radio show & commentary', match: 'Kick-off, half-time & full time', goals: 'Goals' };
export const AUTO_KINDS = {
  radio_live: { category: 'radio', label: 'Pre-match radio show / commentary on air' },
  kickoff: { category: 'match', label: 'Kick-off' },
  halftime: { category: 'match', label: 'Half-time' },
  second_half: { category: 'match', label: 'Second half' },
  fulltime: { category: 'match', label: 'Full time' },
  goal: { category: 'goals', label: 'Goals' },
};
const BATCH = 40;
const nowIso = () => new Date().toISOString();

let ready = false;
export async function ensureMatchAlertsSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS fan_push_subs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL UNIQUE,
      keys_json TEXT NOT NULL,
      prefs TEXT NOT NULL,                 -- JSON { radio, match, goals }
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT, last_ok_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fan_push_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL, category TEXT NOT NULL, event_id TEXT,
      title TEXT NOT NULL, body TEXT, url TEXT,
      created_at TEXT NOT NULL, created_by TEXT,
      cursor INTEGER NOT NULL DEFAULT 0,  -- last subscriber id handled
      sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
      done_at TEXT, claimed_until TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fan_alert_once (event_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (event_id, kind))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fan_alert_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
  ]);
  ready = true;
}

/** Which automatic alerts are switched on (all by default). */
export async function alertSettings(db) {
  await ensureMatchAlertsSchema(db);
  const { results } = await db.prepare(`SELECT key, value FROM fan_alert_settings`).all();
  const s = Object.fromEntries(Object.keys(AUTO_KINDS).map(k => [k, true]));
  for (const r of results) if (r.key in s) s[r.key] = r.value === '1';
  return s;
}
export async function saveAlertSettings(db, values, by) {
  await ensureMatchAlertsSchema(db);
  const now = nowIso();
  await db.batch(Object.keys(AUTO_KINDS).map(k => db.prepare(`INSERT INTO fan_alert_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(k, values[k] ? '1' : '0', now, by || '')));
  return alertSettings(db);
}

const short = n => String(n || '').replace(/\s+F\.?C\.?$/i, '');
const scoreLine = (e, h, a) => `${short(e.home_team)} ${h}–${a} ${short(e.away_team)}`;
const matchUrl = e => { try { return `/matches/${matchSlug(e)}/`; } catch { return '/fixtures/'; } };

/** The text for an automatic alert. */
export function alertText(kind, event, extra = {}) {
  const vs = `${short(event.home_team)} vs ${short(event.away_team)}`;
  switch (kind) {
    case 'radio_live': return extra.preMatch
      ? { title: '🎙️ Pre-match show is live', body: `Lobi Stars FC Live: build-up and analysis before ${vs}. Tap to listen.`, url: '/commentary/' }
      : { title: '🎙️ Live commentary has started', body: `Lobi Stars FC Live: ${vs}. Tap to listen.`, url: '/commentary/' };
    case 'kickoff': return { title: `⚽ Kick-off! ${vs}`, body: 'Follow live updates, listen to the commentary and vote for Man of the Match.', url: matchUrl(event) };
    case 'halftime': return { title: `⏸️ Half-time: ${scoreLine(event, extra.home, extra.away)}`, body: 'Tap for the first-half updates.', url: matchUrl(event) };
    case 'second_half': return { title: `▶️ Second half under way: ${scoreLine(event, extra.home, extra.away)}`, body: 'Follow it live.', url: matchUrl(event) };
    case 'fulltime': return { title: `🏁 Full time: ${scoreLine(event, extra.home, extra.away)}`, body: 'Tap for the match report, Man of the Match and Predict & Win.', url: matchUrl(event) };
    case 'goal': {
      const lobi = /lobi stars/i.test(extra.scorerTeam || '');
      return { title: `${lobi ? '⚽ GOAL for Lobi Stars!' : '⚽ Goal'} ${scoreLine(event, extra.home, extra.away)}`, body: `${short(extra.scorerTeam)} score${extra.minute ? ` (${extra.minute}')` : ''}. Tap to follow live.`, url: matchUrl(event) };
    }
    default: return null;
  }
}

/** Creates a job (an alert to every subscriber who wants this category). Returns its id. */
export async function createJob(db, { kind, category, eventId = null, title, body = '', url = '/', by = 'Automatic' }) {
  await ensureMatchAlertsSchema(db);
  const r = await db.prepare(`INSERT INTO fan_push_jobs (kind, category, event_id, title, body, url, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(kind, category, eventId, String(title).slice(0, 120), String(body || '').slice(0, 240), url, nowIso(), by).first();
  return r.id;
}

/**
 * An automatic alert for a match, sent at most once per match and kind
 * (`onceKey`, e.g. 'goal:2-1'). Starts sending straight away. Never throws.
 */
export async function autoAlert(env, kind, event, extra = {}, { onceKey, waitUntil, origin } = {}) {
  try {
    const db = env.DB;
    await ensureMatchAlertsSchema(db);
    if (!AUTO_KINDS[kind] || !(await alertSettings(db))[kind]) return null;
    const claim = await db.prepare(`INSERT INTO fan_alert_once (event_id, kind, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).bind(String(event.id), onceKey || kind, nowIso()).run();
    if (!claim.meta?.changes) return null;
    const t = alertText(kind, event, extra);
    if (!t) return null;
    const id = await createJob(db, { kind, category: AUTO_KINDS[kind].category, eventId: event.id, ...t });
    const job = runFanPush(env, { origin });
    if (waitUntil) waitUntil(job); else await job;
    return id;
  } catch (err) {
    console.error('[match alerts] auto', err);
    return null;
  }
}

/**
 * Sends the next batch of the oldest unfinished job. Returns
 * { sent, failed, pending } (pending = jobs still to finish). Never throws.
 * With `origin` and CRON_SECRET, asks the site to continue straight away.
 */
export async function runFanPush(env, { origin } = {}) {
  const db = env.DB;
  try {
    await ensureMatchAlertsSchema(db);
    const now = nowIso();
    const job = await db.prepare(`SELECT * FROM fan_push_jobs WHERE done_at IS NULL AND (claimed_until IS NULL OR claimed_until < ?) ORDER BY id LIMIT 1`).bind(now).first();
    if (!job) return { sent: 0, failed: 0, pending: 0 };
    // Claim this batch for 30 seconds so two requests don't send the same people.
    const claim = await db.prepare(`UPDATE fan_push_jobs SET claimed_until = ? WHERE id = ? AND cursor = ? AND (claimed_until IS NULL OR claimed_until < ?)`)
      .bind(new Date(Date.now() + 30000).toISOString(), job.id, job.cursor, now).run();
    if (!claim.meta?.changes) return { sent: 0, failed: 0, pending: 1 };
    if (!pushReady(env)) {
      await db.prepare(`UPDATE fan_push_jobs SET done_at = ?, claimed_until = NULL WHERE id = ?`).bind(now, job.id).run();
      return { sent: 0, failed: 0, pending: 0, error: 'Push not set up (VAPID keys missing)' };
    }
    const { results: subs } = await db.prepare(`SELECT id, endpoint, keys_json, prefs FROM fan_push_subs WHERE active = 1 AND id > ? ORDER BY id LIMIT ?`).bind(job.cursor, BATCH * 3).all();
    const wanted = subs.filter(s => { try { return JSON.parse(s.prefs)[job.category] !== false; } catch { return true; } }).slice(0, BATCH);
    // A full batch: continue after the last person sent. Otherwise everyone fetched was handled;
    // the job is finished when there were no more subscribers to fetch.
    const full = wanted.length === BATCH;
    const last = full ? wanted[wanted.length - 1].id : (subs.length ? subs[subs.length - 1].id : job.cursor);
    const finished = !full && subs.length < BATCH * 3;
    const payload = { kind: 'match', title: job.title, body: job.body, url: job.url, tag: `match-${job.event_id || job.id}-${job.kind}` };
    const out = await Promise.all(wanted.map(async s => {
      try { return { id: s.id, status: await sendEncryptedPush(env, { endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload, { ttl: 900, urgency: 'high', topic: payload.tag }) }; }
      catch { return { id: s.id, status: 0 }; }
    }));
    const ok = out.filter(r => r.status >= 200 && r.status < 300);
    const gone = out.filter(r => r.status === 404 || r.status === 410);
    const stmts = [db.prepare(`UPDATE fan_push_jobs SET cursor = ?, sent = sent + ?, failed = failed + ?, claimed_until = NULL, done_at = ? WHERE id = ?`)
      .bind(last, ok.length, out.length - ok.length, finished ? nowIso() : null, job.id)];
    if (gone.length) stmts.push(db.prepare(`UPDATE fan_push_subs SET active = 0 WHERE id IN (${gone.map(() => '?').join(',')})`).bind(...gone.map(g => g.id)));
    if (ok.length) stmts.push(db.prepare(`UPDATE fan_push_subs SET last_ok_at = ? WHERE id IN (${ok.map(() => '?').join(',')})`).bind(nowIso(), ...ok.map(g => g.id)));
    await db.batch(stmts);
    const pending = (await db.prepare(`SELECT COUNT(*) AS n FROM fan_push_jobs WHERE done_at IS NULL`).first()).n;
    // Ask the site to send the next batch straight away (a new request, with its own limits).
    if (pending && origin && env.CRON_SECRET) {
      fetch(`${origin}/api/internal/fan-push-run`, { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }).catch(() => {});
    }
    return { sent: ok.length, failed: out.length - ok.length, pending };
  } catch (err) {
    console.error('[match alerts] run', err);
    return { sent: 0, failed: 0, pending: 0, error: err.message };
  }
}

/**
 * Radio show / commentary on air: sends the alert once when Lobi Stars FC
 * Live goes on air for a match ("Pre-match show is live" if before kick-off).
 * Called by the commentary page data and the cron Worker. Never throws.
 */
const radioDone = new Set();
export async function checkRadioOnAir(env, { waitUntil, origin } = {}) {
  try {
    const c = await import('./commentary.js');
    const s = await c.getSettings(env);
    if (!s.enabled || !s.streamUrl) return;
    const st = c.commentaryState(await c.commentaryFixtures(env.DB));
    if (st.state !== 'live' || !st.fixture || radioDone.has(st.fixture.id)) return;
    radioDone.add(st.fixture.id);
    const f = st.fixture;
    const preMatch = !f.kickoff_at && Date.now() < new Date(f.event_date).getTime();
    await autoAlert(env, 'radio_live', f, { preMatch }, { waitUntil, origin });
  } catch (err) { console.error('[match alerts] radio', err); }
}
