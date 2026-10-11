// Two-step login for staff: 6-digit codes that change every 30 seconds
// (TOTP, RFC 6238), as shown by Google Authenticator, Microsoft
// Authenticator, Authy and similar apps. Web Crypto only.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

/** A new random secret (160 bits), as base32 text for the authenticator app. */
export const newTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

/** The 6-digit code for a 30-second time step. */
export async function totpCode(secret, step) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let s = step;
  for (let i = 7; i >= 0; i--) { msg[i] = s & 0xff; s = Math.floor(s / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Checks a code, allowing one step either side for clock differences.
 * Returns the matching time step (to stop the same code being used twice),
 * or null. `lastStep` = the step of the previous successful code.
 */
export async function verifyTotp(secret, code, lastStep = 0, now = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6 || !secret) return null;
  const step = Math.floor(now / 30000);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= (lastStep || 0)) continue;
    if ((await totpCode(secret, s)) === c) return s;
  }
  return null;
}

export const otpauthUri = (secret, account) =>
  `otpauth://totp/${encodeURIComponent(`Lobi Stars Admin:${account}`)}?secret=${secret}&issuer=${encodeURIComponent('Lobi Stars Admin')}&algorithm=SHA1&digits=6&period=30`;
