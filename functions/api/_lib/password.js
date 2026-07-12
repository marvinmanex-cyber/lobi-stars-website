// Password hashing via Web Crypto's PBKDF2 -- Workers runtime has no
// bcrypt/scrypt, and PBKDF2-SHA256 with a high iteration count is a solid,
// dependency-free standard. Stored format: "iterations:saltHex:hashHex".
const ITERATIONS = 100000;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function deriveHashHex(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await deriveHashHex(password, salt, ITERATIONS);
  return `${ITERATIONS}:${toHex(salt)}:${hashHex}`;
}

export async function verifyPassword(password, stored) {
  const [iterationsStr, saltHex, hashHex] = (stored || '').split(':');
  if (!iterationsStr || !saltHex || !hashHex) return false;
  const computed = await deriveHashHex(password, fromHex(saltHex), Number.parseInt(iterationsStr, 10));
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}
