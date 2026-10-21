// Broadcast partner: Aeson Sports Radio, behind "Lobi Stars FC Live".
//
// Aeson publishes its radio state at a status address (JSON):
//   { onAir, isLiveDJ, listeners, listenUrl, backupListenUrl, broadcast, updatedAt, stale }
// and can push the same JSON to POST /api/aeson-webhook, signed with a shared
// secret. The website reads it server-side only; fans get a cleaned copy:
// never Aeson's own addresses (listenUrl etc.), never partner names, AzuraCast
// or any link. The audio address fans play stays the lobistarsfc.com one set
// in Admin › Live Commentary (white-label, see commentary.js).
//
// Settings (D1 commentary_settings, Admin › Live Commentary › Broadcast partner):
//   partner_status_url     the status address (default DEFAULT_STATUS_URL)
//   partner_webhook_secret the webhook secret, AES-GCM encrypted with a key
//                          derived from SESSION_SECRET; never returned. The
//                          AESON_WEBHOOK_SECRET Cloudflare secret, if set, wins.
// Cache (D1 partner_status): the last status read or pushed, used for 15 s.
import { ensureCommentarySchema } from './commentary.js';

export const DEFAULT_STATUS_URL = 'https://www.aesonsports.com/api/radio/status';
export const STATUS_TTL_MS = 15_000;
const FETCH_TIMEOUT_MS = 4000;
const WEBHOOK_WINDOW_S = 300;
const PARTNER = 'aeson';

let ready = false;
export async function ensurePartnerSchema(db) {
  await ensureCommentarySchema(db);
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS partner_status (
    partner TEXT PRIMARY KEY,
    status_json TEXT,          -- the cleaned status (see cleanStatus)
    ok INTEGER NOT NULL DEFAULT 0,
    source TEXT,               -- 'poll' | 'webhook'
    error TEXT,
    fetched_at INTEGER NOT NULL,     -- ms
    last_ok_at INTEGER               -- ms of the last good read or push
  )`).run();
  ready = true;
}

// ── Settings ──

/** A usable status address: https anywhere, or http on localhost (local tests). */
export function validStatusUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname);
  } catch { return false; }
}

async function secretKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SESSION_SECRET || ''}|partner-webhook-secret`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const toB64 = bytes => btoa(String.fromCharCode(...bytes));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** Encrypts the webhook secret for storage (iv + ciphertext, base64). */
export async function sealSecret(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await secretKey(env), new TextEncoder().encode(plain)));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  return toB64(all);
}
async function openSecret(env, sealed) {
  try {
    const all = fromB64(sealed);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await secretKey(env), all.slice(12)));
  } catch { return ''; } // SESSION_SECRET changed: treat as not set
}

/** { statusUrl, isDefault, secret, secretSet, secretFromEnv }. `secret` is for server use only. */
export async function partnerSettings(env) {
  await ensurePartnerSchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT key, value FROM commentary_settings WHERE key IN ('partner_status_url', 'partner_webhook_secret')`).all();
  const o = Object.fromEntries(results.map(r => [r.key, r.value]));
  const saved = String(o.partner_status_url || '').trim();
  const statusUrl = validStatusUrl(saved) ? saved : String(env.AESON_STATUS_URL || '').trim() || DEFAULT_STATUS_URL;
  const fromEnv = String(env.AESON_WEBHOOK_SECRET || '').trim();
  const secret = fromEnv || (o.partner_webhook_secret ? await openSecret(env, o.partner_webhook_secret) : '');
  return { statusUrl, isDefault: statusUrl === DEFAULT_STATUS_URL, secret, secretSet: !!secret, secretFromEnv: !!fromEnv };
}

// ── Cleaning Aeson's status (white-label) ──

/** Text safe to show fans: no partner or software names, no links, no markup, short. */
export function cleanText(v, max = 80) {
  if (v === null || v === undefined || typeof v === 'object') return '';
  return String(v)
    .replace(/https?:\/\/\S+|www\.\S+|\S+\.(com|net|org|fm|io|co|ng)\b\S*/gi, '')
    .replace(/aeson(\s*sports)?(\s*radio)?|azuracast|icecast|shoutcast/gi, '')
    .replace(/[<>]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–:|·]+|[\s\-–:|·]+$/g, '')
    .slice(0, max);
}
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));
const iso = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const list = (v, max = 4) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*(?:,|&| and )\s*/i) : []).map(x => cleanText(typeof x === 'object' && x ? x.name : x, 40)).filter(Boolean).slice(0, max);

/** The live-match part, if Aeson sends one (top level or inside broadcast). Field names are taken leniently. */
function cleanMatch(m) {
  if (!m || typeof m !== 'object') return null;
  const home = cleanText(m.home ?? m.homeTeam ?? m.home_team, 40), away = cleanText(m.away ?? m.awayTeam ?? m.away_team, 40);
  if (!home || !away) return null;
  const scorers = (Array.isArray(m.scorers ?? m.goals) ? (m.scorers ?? m.goals) : []).slice(0, 12).map(g => ({
    player: cleanText(g?.player ?? g?.name, 40), minute: cleanText(g?.minute, 8), team: /away/i.test(g?.team ?? g?.side ?? '') ? 'away' : 'home',
  })).filter(g => g.player);
  return {
    home, away,
    homeScore: num(m.homeScore ?? m.home_score ?? m.score?.home),
    awayScore: num(m.awayScore ?? m.away_score ?? m.score?.away),
    minute: cleanText(m.minute ?? m.clock, 8) || null,
    status: cleanText(m.status, 20) || null,
    scorers,
  };
}

/** Aeson's JSON → what the website keeps and shows. Unknown fields are dropped (listenUrl included). */
export function cleanStatus(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const b = r.broadcast && typeof r.broadcast === 'object' ? r.broadcast : null;
  return {
    onAir: r.onAir === true || r.on_air === true || r.live === true,
    listeners: num(r.listeners ?? r.listenerCount),
    broadcast: b ? {
      title: cleanText(b.title ?? b.name ?? b.show, 80) || null,
      commentators: list(b.commentators ?? b.presenters ?? b.djs ?? b.dj),
      startedAt: iso(b.startedAt ?? b.started_at ?? b.start),
    } : null,
    liveMatch: cleanMatch(r.liveMatch ?? r.match ?? b?.liveMatch ?? b?.match),
    partnerStale: r.stale === true,
    partnerUpdatedAt: iso(r.updatedAt),
  };
}

// ── Reading the status (server-side, cached 15 s in D1) ──

/** One read of the status address. Never throws; never returns the address. */
export async function fetchPartnerStatus(url) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'LobiStarsFCLive/1.0 (status)' }, signal: ctrl.signal, redirect: 'follow' });
    const ms = Date.now() - started;
    if (!res.ok) { try { await res.body?.cancel(); } catch {} return { ok: false, ms, error: `HTTP ${res.status}` }; }
    const text = (await res.text()).slice(0, 20_000);
    let data;
    try { data = JSON.parse(text); } catch { return { ok: false, ms, error: 'Not JSON' }; }
    if (!data || typeof data !== 'object' || !('onAir' in data || 'on_air' in data || 'live' in data)) return { ok: false, ms, error: 'No onAir field' };
    return { ok: true, ms, status: cleanStatus(data) };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err?.name === 'AbortError' ? `No answer within ${FETCH_TIMEOUT_MS / 1000} s` : 'Could not connect' };
  } finally { clearTimeout(timer); }
}

export async function saveStatus(db, { ok, status, source, error }, now = Date.now()) {
  await db.prepare(`INSERT INTO partner_status (partner, status_json, ok, source, error, fetched_at, last_ok_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (partner) DO UPDATE SET status_json = COALESCE(excluded.status_json, partner_status.status_json), ok = excluded.ok,
      source = excluded.source, error = excluded.error, fetched_at = excluded.fetched_at, last_ok_at = COALESCE(excluded.last_ok_at, partner_status.last_ok_at)`)
    .bind(PARTNER, status ? JSON.stringify(status) : null, ok ? 1 : 0, source, error || null, now, ok ? now : null).run();
}

export async function readCached(db) {
  return db.prepare(`SELECT * FROM partner_status WHERE partner = ?`).bind(PARTNER).first();
}

/**
 * The partner's state, at most 15 s old: { onAir, listeners, broadcast, liveMatch, stale, updatedAt }.
 * Unreachable (or a bad answer) → onAir false, stale true; the last good details are not shown as live.
 */
export async function partnerStatus(env, { now = Date.now(), force = false } = {}) {
  await ensurePartnerSchema(env.DB);
  let row = await readCached(env.DB);
  if (force || !row || now - row.fetched_at >= STATUS_TTL_MS) {
    const { statusUrl } = await partnerSettings(env);
    const r = await fetchPartnerStatus(statusUrl);
    await saveStatus(env.DB, { ok: r.ok, status: r.ok ? r.status : null, source: 'poll', error: r.error }, now);
    row = await readCached(env.DB);
  }
  const s = row?.ok && row.status_json ? JSON.parse(row.status_json) : null;
  if (!s) return { onAir: false, listeners: null, broadcast: null, liveMatch: null, stale: true, updatedAt: row?.last_ok_at ? new Date(row.last_ok_at).toISOString() : null };
  return { onAir: s.onAir, listeners: s.listeners, broadcast: s.broadcast, liveMatch: s.liveMatch, stale: false, updatedAt: new Date(row.fetched_at).toISOString() };
}

// ── Webhook signature ──

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
/** sha256 HMAC of `${timestamp}.${body}`, as lowercase hex. */
export async function signPayload(secret, timestamp, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
}
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** Checks X-Aeson-Timestamp + X-Aeson-Signature ("sha256=<hex>") against the raw body. Returns an error text or null. */
export async function verifySignature(secret, timestamp, signature, body, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret) return 'Webhook secret not set';
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowS - ts) > WEBHOOK_WINDOW_S) return 'Timestamp missing or outside 5 minutes';
  const given = String(signature || '').trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return 'Signature missing';
  return sameText(given, await signPayload(secret, ts, body)) ? null : 'Signature does not match';
}
