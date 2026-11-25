// The ticketing engine (Partner API) client: server to server only, never from the
// browser. Signs every request as in docs/INTEGRATION_CONTRACT.md (C2), sends an
// Idempotency-Key on every POST, uses timeouts, retries only safe calls and turns
// errors into the neutral messages fans already see on this site.
// Credentials come from environment variables (Cloudflare secrets):
//   TICKETING_API_BASE_URL, TICKETING_API_KEY, TICKETING_API_SECRET (calls to the engine)
//   TICKETING_CALLBACK_SECRET (+ optional TICKETING_CALLBACK_SECRET_PREVIOUS) for callbacks.
// Works in Cloudflare Workers and in Node 18+ (Web Crypto + fetch).

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const API_PREFIX = '/api/partner/v1';
export const MAX_SKEW_SECONDS = 300;
export const NONCE_TTL_SECONDS = 600;

export async function sha256Hex(data) {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}
export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
/** Constant-time comparison of two strings (no early exit on the first difference). */
export function safeEqual(a, b) {
  const x = String(a || ''), y = String(b || '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}
export const randomNonce = () => hex(crypto.getRandomValues(new Uint8Array(16)));
export const uuid = () => crypto.randomUUID();

/** The string that is signed (C2). */
export async function signingString({ timestamp, nonce, method, pathWithQuery, body = '' }) {
  return `${timestamp}.${nonce}.${String(method).toUpperCase()}.${pathWithQuery}.${await sha256Hex(body)}`;
}
/** Headers for a signed request. */
export async function signRequest({ key, secret, method, pathWithQuery, body = '', timestamp = Math.floor(Date.now() / 1000), nonce = randomNonce() }) {
  const signature = await hmacHex(secret, await signingString({ timestamp, nonce, method, pathWithQuery, body }));
  return { 'X-Partner-Key': key, 'X-Timestamp': String(timestamp), 'X-Nonce': nonce, 'X-Signature': signature };
}

/**
 * Checks a signed request (the engine's callbacks). secrets: the active secrets (two during a rotation).
 * nonceSeen(nonce) -> true if it was used in the last 10 minutes (and records it otherwise).
 * Returns { ok: true } or { ok: false, code }.
 */
export async function verifySigned({ secrets, expectedKey = null, method, pathWithQuery, rawBody = '', headers, now = Math.floor(Date.now() / 1000), nonceSeen }) {
  const h = name => (typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()]) || '';
  const ts = Number(h('X-Timestamp')), nonce = h('X-Nonce'), sig = h('X-Signature').toLowerCase(), key = h('X-Partner-Key');
  const active = (secrets || []).filter(Boolean);
  if (!active.length) return { ok: false, code: 'not_configured' };
  if (!Number.isInteger(ts) || Math.abs(now - ts) > MAX_SKEW_SECONDS) return { ok: false, code: 'invalid_signature', why: 'timestamp' };
  if (nonce.length < 16 || nonce.length > 128) return { ok: false, code: 'invalid_signature', why: 'nonce' };
  if (expectedKey && !safeEqual(key, expectedKey)) return { ok: false, code: 'invalid_signature', why: 'key' };
  const base = await signingString({ timestamp: ts, nonce, method, pathWithQuery, body: rawBody });
  let good = false;
  for (const s of active) if (safeEqual(await hmacHex(s, base), sig)) good = true; // every secret is tried (same time either way)
  if (!good) return { ok: false, code: 'invalid_signature', why: 'signature' };
  if (nonceSeen && await nonceSeen(nonce)) return { ok: false, code: 'invalid_signature', why: 'replay' };
  return { ok: true };
}

export class EngineError extends Error {
  constructor(message, { status = 0, code = 'engine_error', retryable = false } = {}) { super(message); this.status = status; this.code = code; this.retryable = retryable; }
  /** True when the engine could not be reached or answered 5xx (the gate shows "cannot verify"). */
  get unreachable() { return this.status === 0 || this.status >= 500; }
}

/** The engine's base URL (no trailing slash), or '' when not set. */
export const engineBase = env => String(env.TICKETING_API_BASE_URL || '').trim().replace(/\/+$/, '');
export const engineSecretsSet = env => ['TICKETING_API_BASE_URL', 'TICKETING_API_KEY', 'TICKETING_API_SECRET', 'TICKETING_CALLBACK_SECRET'].filter(k => !String(env[k] || '').trim());

const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * One call to the engine. path: '/orders', '/orders?client_reference=…'.
 * GET is retried (twice) on network errors and 5xx. POST is retried once on a network error only,
 * with the SAME Idempotency-Key, so the engine returns the original result instead of a duplicate.
 */
export async function engineFetch(env, method, path, { body = null, idempotencyKey = null, timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const base = engineBase(env);
  if (!base || !env.TICKETING_API_KEY || !env.TICKETING_API_SECRET) throw new EngineError('The ticket system is not set up.', { code: 'not_configured' });
  const url = new URL(`${base}${API_PREFIX}${path}`);
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw new EngineError('The ticket system address must use https.', { code: 'not_configured' });
  const m = method.toUpperCase();
  const raw = body === null ? '' : JSON.stringify(body);
  const key = m === 'POST' ? (idempotencyKey || uuid()) : null;
  const attempts = m === 'GET' ? 3 : 2;
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i) await wait(250 * 3 ** (i - 1));
    const headers = { Accept: 'application/json', ...(await signRequest({ key: env.TICKETING_API_KEY, secret: env.TICKETING_API_SECRET, method: m, pathWithQuery: url.pathname + url.search, body: raw })) };
    if (raw) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    let res;
    try {
      res = await fetchImpl(url.toString(), { method: m, headers, body: raw || undefined, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      last = new EngineError('The ticket system could not be reached.', { status: 0, code: 'unreachable', retryable: true });
      continue; // network error / timeout: safe to repeat (GET, or POST with the same key)
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = null; }
    if (res.ok && data) return data;
    const code = data?.error?.code || (res.ok ? 'bad_response' : `http_${res.status}`);
    last = new EngineError(String(data?.error?.message || 'The ticket system answered with an error.').slice(0, 200), { status: res.status, code, retryable: res.status >= 500 });
    if (!(m === 'GET' && res.status >= 500)) break; // 4xx, or a POST that reached the engine: never repeated
  }
  throw last;
}

/** The Partner API calls (C3). */
export const engine = {
  events: env => engineFetch(env, 'GET', '/events'),
  season: env => engineFetch(env, 'GET', '/season'),
  createOrder: (env, order, idempotencyKey) => engineFetch(env, 'POST', '/orders', { body: order, idempotencyKey, timeoutMs: 15000 }),
  getOrder: (env, orderId) => engineFetch(env, 'GET', `/orders/${encodeURIComponent(orderId)}`),
  orderByReference: (env, ref) => engineFetch(env, 'GET', `/orders?client_reference=${encodeURIComponent(ref)}`),
  lookup: (env, email, orderReference) => engineFetch(env, 'POST', '/tickets/lookup', { body: { email, order_reference: orderReference } }),
  validate: (env, token) => engineFetch(env, 'POST', '/tickets/validate', { body: { token }, timeoutMs: 6000 }),
  scan: (env, scan) => engineFetch(env, 'POST', '/tickets/scan', { body: scan, idempotencyKey: scan.scan_id, timeoutMs: 6000 }),
  scanBatch: (env, scans, idempotencyKey) => engineFetch(env, 'POST', '/tickets/scan/batch', { body: { scans }, idempotencyKey, timeoutMs: 20000 }),
};

/** The site's own wording for an engine problem (never the engine's internals). */
export function fanMessage(err) {
  const c = err?.code || '';
  if (/sold_out|not_available|insufficient|capacity/.test(c)) return 'Sorry, those tickets have just sold out. Check your order and try again.';
  if (/sale_closed|not_on_sale|sale_not_open/.test(c)) return 'Tickets for this match are not on sale.';
  if (/expired|hold/.test(c)) return 'Your reserved tickets have expired. Please start again.';
  if (/invalid_adjustment/.test(c)) return 'The discount could not be applied just now. Please try again.';
  if (/invalid_(buyer|phone|email)/.test(c)) return 'Please check your name, email and phone number.';
  return 'Payment could not be started. Please try again.';
}
