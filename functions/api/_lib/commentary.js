// "Lobi Stars FC Live" match commentary (white-label).
//
// The commentary is produced by our broadcast partner, but fans only ever
// see and hear "Lobi Stars FC Live" on lobistarsfc.com:
// - the browser only ever gets COMMENTARY_STREAM_URL (an address on our own
//   domain); the partner's real address (PARTNER_ORIGIN_STREAM_URL) is a
//   server-only secret used by the relay in functions/live/commentary;
// - the stream address is only handed out while a match's commentary window
//   is open (commentary start -> full time + 15 minutes), so nothing else is
//   ever played.
//
// Settings: environment variables give the defaults; staff can override the
// public ones on Admin -> Commentary (stored in commentary_settings).
import { ensureTable, autoCloseOverdue, isHomeGame, AUTO_CLOSE_MS } from './matchCentre.js';
import { matchSlug } from './matchSlug.js';

export const BRAND = 'Lobi Stars FC Live';
export const RELAY_PATH = '/live/commentary';
const DEFAULT_LEAD_MS = 15 * 60_000;   // commentary starts 15 minutes before kick-off
const AFTER_FT_MS = 15 * 60_000;       // and runs until 15 minutes after full time
const LISTENER_TTL_S = 90;             // a listener counts as "live" if their player checked in this recently

let ready = false;
export async function ensureCommentarySchema(db) {
  if (ready) return;
  await ensureTable(db);
  const cols = new Set((await db.prepare(`PRAGMA table_info(events)`).all()).results.map(r => r.name));
  if (!cols.has('commentary_enabled')) await db.prepare(`ALTER TABLE events ADD COLUMN commentary_enabled INTEGER NOT NULL DEFAULT 1`).run();
  if (!cols.has('commentary_start_at')) await db.prepare(`ALTER TABLE events ADD COLUMN commentary_start_at TEXT`).run();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS commentary_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT)`),
    // One row per listening session (a player in a browser tab), kept up to date by 60-second check-ins.
    db.prepare(`CREATE TABLE IF NOT EXISTS commentary_listeners (
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      first_seen INTEGER NOT NULL,      -- ms
      last_seen INTEGER NOT NULL,       -- ms
      heartbeats INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, event_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_commentary_listeners_live ON commentary_listeners(event_id, last_seen)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS commentary_peaks (event_id TEXT PRIMARY KEY, peak INTEGER NOT NULL, peak_at INTEGER NOT NULL)`),
  ]);
  ready = true;
}

// ── White-label safety ──

/** True for https addresses on lobistarsfc.com (or a subdomain), or our relay path. */
export function isOurDomain(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  if (url.startsWith('/')) return url.startsWith(RELAY_PATH);
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'lobistarsfc.com' || u.hostname.endsWith('.lobistarsfc.com'));
  } catch { return false; }
}

/** Effective settings (env defaults + staff overrides). Public URLs that aren't on our domain are dropped. */
export async function getSettings(env) {
  await ensureCommentarySchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT key, value FROM commentary_settings`).all();
  const o = Object.fromEntries(results.map(r => [r.key, r.value]));
  // A blank staff setting falls back to the server default.
  const pick = (key, envKey, fallback = '') => (o[key] !== undefined && o[key] !== null && o[key] !== '' ? o[key] : (env[envKey] ?? fallback));
  const enabledRaw = String(pick('enabled', 'COMMENTARY_ENABLED', 'on')).toLowerCase();
  const stream = String(pick('stream_url', 'COMMENTARY_STREAM_URL', env.PARTNER_ORIGIN_STREAM_URL ? RELAY_PATH : '')).trim();
  const backup = String(pick('backup_url', 'COMMENTARY_BACKUP_STREAM_URL', '')).trim();
  const max = Number.parseInt(pick('max_listeners', 'COMMENTARY_MAX_LISTENERS', '500'), 10);
  return {
    enabled: !['off', '0', 'false', 'no'].includes(enabledRaw),
    brand: String(env.COMMENTARY_BRAND_NAME || BRAND).replace(/aeson/gi, '').trim() || BRAND,
    streamUrl: isOurDomain(stream) ? stream : '',
    backupUrl: isOurDomain(backup) ? backup : '',
    commentators: String(pick('commentators', 'COMMENTARY_COMMENTATORS', '')).trim().slice(0, 200),
    maxListeners: Number.isFinite(max) && max > 0 ? max : 500,
    relayConfigured: !!env.PARTNER_ORIGIN_STREAM_URL,
  };
}

// ── When commentary is on air ──

/** Commentary window (ms) for a fixture, or null if it has no commentary. */
export function commentaryWindow(row) {
  if (row.commentary_enabled === 0 || row.status === 'postponed' || row.status === 'cancelled') return null;
  const ko = new Date(row.event_date).getTime();
  let start = row.commentary_start_at ? new Date(row.commentary_start_at).getTime() : ko - DEFAULT_LEAD_MS;
  // If staff press Start Match before the planned commentary start, commentary opens then.
  if (row.kickoff_at) start = Math.min(start, new Date(row.kickoff_at).getTime());
  let end;
  if (row.ended_at) end = new Date(row.ended_at).getTime() + AFTER_FT_MS;
  else if (row.status === 'full-time') end = ko + AUTO_CLOSE_MS + AFTER_FT_MS;
  else end = Math.max(ko, row.kickoff_at ? new Date(row.kickoff_at).getTime() : ko) + AUTO_CLOSE_MS + AFTER_FT_MS;
  return { start, end };
}

/** Fixtures (with Match Centre status) that have commentary, earliest first. */
export async function commentaryFixtures(db) {
  await ensureCommentarySchema(db);
  const { results } = await db.prepare(
    `SELECT e.*, m.event_id, m.status, m.home_score, m.away_score, m.kickoff_at, m.ended_at
     FROM events e LEFT JOIN match_centre m ON m.event_id = e.id
     WHERE e.active = 1 AND COALESCE(e.commentary_enabled, 1) = 1
     ORDER BY e.event_date ASC`
  ).all();
  await autoCloseOverdue(db, results.filter(r => r.event_id));
  return results;
}

const watDay = ms => new Date(ms + 3_600_000).toISOString().slice(0, 10);

/** 'live' | 'today' | 'off', plus the live or next fixture, at server time `now`. */
export function commentaryState(rows, now = Date.now()) {
  const withWindow = rows.map(r => ({ r, w: commentaryWindow(r) })).filter(x => x.w);
  const live = withWindow.find(x => now >= x.w.start && now < x.w.end);
  if (live) return { state: 'live', fixture: live.r, window: live.w };
  const next = withWindow.find(x => x.w.start > now && x.w.end > now);
  if (next && watDay(next.w.start) === watDay(now)) return { state: 'today', fixture: next.r, window: next.w };
  return { state: 'off', fixture: next?.r || null, window: next?.w || null };
}

export function publicFixture(r, w) {
  return {
    id: r.id, slug: matchSlug(r), home_team: r.home_team, away_team: r.away_team, competition: r.competition,
    venue: r.venue, event_date: r.event_date, is_home: isHomeGame(r), status: r.status || 'scheduled',
    home_score: r.home_score ?? null, away_score: r.away_score ?? null,
    commentaryStart: w ? new Date(w.start).toISOString() : null, commentaryEnd: w ? new Date(w.end).toISOString() : null,
  };
}

// ── Listeners ──

export async function liveListeners(db, eventId, now = Date.now()) {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM commentary_listeners WHERE event_id = ? AND last_seen > ?`)
    .bind(eventId, now - LISTENER_TTL_S * 1000).first()).n || 0;
}

/** Records a 60-second check-in from a playing player and keeps the per-match peak up to date. */
export async function recordHeartbeat(db, sessionId, eventId, now = Date.now()) {
  await db.prepare(
    `INSERT INTO commentary_listeners (session_id, event_id, first_seen, last_seen, heartbeats) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (session_id, event_id) DO UPDATE SET last_seen = excluded.last_seen, heartbeats = heartbeats + 1`
  ).bind(sessionId, eventId, now, now).run();
  const n = await liveListeners(db, eventId, now);
  await db.prepare(
    `INSERT INTO commentary_peaks (event_id, peak, peak_at) VALUES (?, ?, ?)
     ON CONFLICT (event_id) DO UPDATE SET peak = excluded.peak, peak_at = excluded.peak_at WHERE excluded.peak > commentary_peaks.peak`
  ).bind(eventId, n, now).run();
  return n;
}

// ── Relay helpers (Option B) ──

const PARTNER_HEADERS = /^(icy-|ice-|x-audiocast|x-powered-by|server$|via$|x-served-by|set-cookie$|access-control-|x-cache|cf-|report-to$|nel$|link$|x-amz|x-cdn|alt-svc$)/i;

/** Response headers safe to pass to fans: partner-identifying ones removed, our brand added. */
export function relayHeaders(upstream, brand = BRAND) {
  const h = new Headers();
  for (const [k, v] of upstream.entries()) {
    if (PARTNER_HEADERS.test(k)) continue;
    if (/^(content-type|content-length|accept-ranges|last-modified|etag)$/i.test(k)) h.set(k, v);
  }
  h.set('Cache-Control', 'no-store');
  h.set('icy-name', brand);
  h.set('icy-description', 'Live match commentary from Lobi Stars FC');
  h.set('icy-url', 'https://lobistarsfc.com/commentary');
  h.set('X-Content-Type-Options', 'nosniff');
  return h;
}

export const isPlaylist = (url, type = '') => /\.m3u8(\?|$)/i.test(url) || /mpegurl/i.test(type);

/**
 * Rewrites an HLS playlist so every URI points at our relay. URIs become
 * opaque tokens, so the partner's address never reaches the browser.
 */
export async function rewritePlaylist(text, playlistUrl, encode) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) { out.push(line); continue; }
    if (line.startsWith('#')) {
      // URIs inside tags, e.g. #EXT-X-KEY:...,URI="key.bin" or #EXT-X-MAP:URI="init.mp4"
      const parts = line.split(/URI="([^"]*)"/);
      if (parts.length > 1) {
        let rebuilt = '';
        for (let i = 0; i < parts.length; i++) rebuilt += i % 2 ? `URI="${RELAY_PATH}/x/${await encode(new URL(parts[i], playlistUrl).href)}"` : parts[i];
        out.push(rebuilt);
      } else out.push(line.replace(/(StreamTitle|TITLE)="[^"]*"/gi, `$1="${BRAND}"`));
      continue;
    }
    out.push(`${RELAY_PATH}/x/${await encode(new URL(line.trim(), playlistUrl).href)}`);
  }
  return out.join('\n');
}

// Opaque tokens for HLS segment addresses (AES-GCM with a key derived from
// SESSION_SECRET), so segment URLs never reveal the partner's address.
async function tokenKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SESSION_SECRET || ''}|commentary-relay`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export async function encodeToken(env, url) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), new TextEncoder().encode(url)));
  const all = new Uint8Array(iv.length + ct.length); all.set(iv); all.set(ct, iv.length);
  return b64u(all);
}
export async function decodeToken(env, token) {
  try {
    const all = unb64u(token);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await tokenKey(env), all.slice(12));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

// ── Broadcast report (analytics) ──

/**
 * Per-match listening figures for fixtures kicking off between two ISO times:
 * listens (Play presses), unique listeners (listening sessions), average
 * listening time (minutes) and peak concurrent listeners.
 */
export async function broadcastStats(db, fromIso, toIso) {
  await ensureCommentarySchema(db);
  const hasEvents = !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'track_events'`).first());
  const { results: fixtures } = await db.prepare(
    `SELECT id, home_team, away_team, event_date FROM events WHERE COALESCE(commentary_enabled, 1) = 1 AND event_date >= ? AND event_date < ? ORDER BY event_date DESC`
  ).bind(fromIso, toIso).all();
  const out = [];
  for (const f of fixtures) {
    const l = await db.prepare(
      `SELECT COUNT(*) AS sessions, AVG((last_seen - first_seen) / 60000.0 + 1) AS avg_min FROM commentary_listeners WHERE event_id = ?`
    ).bind(f.id).first();
    const peak = await db.prepare(`SELECT peak, peak_at FROM commentary_peaks WHERE event_id = ?`).bind(f.id).first();
    const ev = hasEvents ? (await db.prepare(`SELECT name, COUNT(*) AS n FROM track_events WHERE label = ? AND name IN ('commentary_play', 'commentary_error') GROUP BY name`).bind(f.id).all()).results : [];
    out.push({
      id: f.id, match: `${f.home_team} vs ${f.away_team}`, date: f.event_date,
      listens: ev.find(e => e.name === 'commentary_play')?.n || 0,
      uniqueListeners: l?.sessions || 0,
      avgMinutes: l?.avg_min ? Math.round(l.avg_min * 10) / 10 : 0,
      peak: peak?.peak || 0, peakAt: peak ? new Date(peak.peak_at).toISOString() : null,
      errors: ev.find(e => e.name === 'commentary_error')?.n || 0,
    });
  }
  return out;
}

/** Fetches the start of a stream server-side (staff "Test stream" button). Never returns the address. */
export async function probeStream(url, timeoutMs = 8000) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'LobiStarsFCLive/1.0 (stream test)', 'Icy-MetaData': '0' }, signal: ctrl.signal, redirect: 'follow' });
    let bytes = 0;
    if (res.body) {
      const reader = res.body.getReader();
      while (bytes < 16_384) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
      }
      try { await reader.cancel(); } catch {}
    }
    const type = res.headers.get('Content-Type') || '';
    const audio = /audio|mpegurl|octet-stream|ogg|aac/i.test(type);
    return { ok: res.ok && bytes > 0 && audio, status: res.status, contentType: type.split(';')[0] || 'unknown', bytes, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, status: 0, contentType: '', bytes: 0, ms: Date.now() - started, error: err?.name === 'AbortError' ? 'No response within 8 seconds' : 'Could not connect' };
  } finally {
    clearTimeout(timer);
  }
}
