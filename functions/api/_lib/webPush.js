// Web Push with content (RFC 8291 "aes128gcm" encryption + RFC 8292 VAPID),
// written with the Web Crypto API (crypto.subtle) so it runs on Cloudflare
// Workers. No npm library is used at runtime.
//
// Each message is encrypted for one browser: a fresh P-256 key pair is made,
// ECDH with the browser's public key (p256dh) gives a shared secret, which is
// mixed with the browser's auth secret (HKDF) into the content key and nonce
// for AES-128-GCM. Only that browser can read it; the push service can't.
import { vapidAuth } from './foodAlerts.js';

const enc = new TextEncoder();
export const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
// HKDF with a single output block (all lengths here are <= 32 bytes).
const hkdf = async (salt, ikm, info, len) => (await hmac(await hmac(salt, ikm), concat(info, new Uint8Array([1])))).slice(0, len);

/**
 * Encrypts `payload` (string) for one subscription { keys: { p256dh, auth } }.
 * Returns the request body (header + ciphertext) as a Uint8Array.
 * `opts` (tests only): { salt, serverKeys } to make the output repeatable.
 */
export async function encryptPayload(subscription, payload, opts = {}) {
  const uaPublic = unb64u(subscription.keys.p256dh);   // 65 bytes
  const authSecret = unb64u(subscription.keys.auth);   // 16 bytes
  const serverKeys = opts.serverKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256));
  // RFC 8291 section 3.4: IKM from the auth secret and both public keys.
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  // One record: the message followed by the 0x02 "last record" delimiter.
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  // Header: salt (16) | record size (4, big-endian) | key id length (1) | key id = our public key (65).
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/**
 * Sends an encrypted push to one subscription. Returns the HTTP status
 * (0 when the push service could not be reached).
 */
export async function sendEncryptedPush(env, subscription, payload, { ttl = 300, urgency = 'high', topic } = {}) {
  const body = await encryptPayload(subscription, typeof payload === 'string' ? payload : JSON.stringify(payload));
  const headers = {
    Authorization: await vapidAuth(env, subscription.endpoint),
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    TTL: String(ttl), Urgency: urgency,
  };
  // Topic replaces an older undelivered push with the same topic (e.g. repeat alerts for one order).
  if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  try {
    const r = await fetch(subscription.endpoint, { method: 'POST', headers, body });
    return r.status;
  } catch (err) {
    console.error('[push] send', err);
    return 0;
  }
}
