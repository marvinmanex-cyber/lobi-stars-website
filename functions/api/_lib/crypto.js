// HMAC-SHA256 signing/verification using the Web Crypto API (Workers runtime
// has no Node `crypto` module). Used to sign ticket IDs so the QR payload
// can't be forged without TICKET_HMAC_SECRET.

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export async function sign(value, secret) {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return toBase64Url(signature);
}

export async function verify(value, signature, secret) {
  const expected = await sign(value, secret);
  if (expected.length !== signature.length) return false;
  // Constant-time-ish comparison
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function randomId(prefix, length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return `${prefix}-${out}`;
}
