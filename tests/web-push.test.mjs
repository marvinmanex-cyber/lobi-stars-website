// Web Push encryption (RFC 8291 aes128gcm) used for kitchen alerts: checked
// against the example in the RFC (appendix A) and by decrypting a message the
// way a browser does. Runs without the dev server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, b64u, unb64u } from '../functions/api/_lib/webPush.js';

const subtle = globalThis.crypto.subtle;
const importEcdhPrivate = async (d, pub) => {
  const p = unb64u(pub);
  const jwk = { kty: 'EC', crv: 'P-256', d, x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), ext: true };
  return { privateKey: await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await subtle.importKey('raw', p, { name: 'ECDH', namedCurve: 'P-256' }, true, []) };
};
const hmac = async (key, data) => new Uint8Array(await subtle.sign('HMAC', await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
const hkdf = async (salt, ikm, info, len) => (await hmac(await hmac(salt, ikm), new Uint8Array([...info, 1]))).slice(0, len);
const te = new TextEncoder();

/** What the browser does with a push body. */
async function decrypt(body, uaKeys, uaPublic, authSecret) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic]), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']), cipher));
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return new TextDecoder().decode(plain.slice(0, -1));
}

test('matches the RFC 8291 example (appendix A)', async () => {
  const serverKeys = await importEcdhPrivate('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const body = await encryptPayload(
    { keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } },
    'When I grow up, I want to be a watermelon',
    { salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'), serverKeys },
  );
  assert.equal(b64u(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('a browser can decrypt a kitchen alert', async () => {
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const message = JSON.stringify({ title: '🍽️ NEW PAID ORDER FD-20261011-0042', body: '2× Beef Suya, 1× Water | Seat C14', ref: 'FD-20261011-0042', url: '/admin/kitchen/?order=FD-20261011-0042' });
  const body = await encryptPayload({ keys: { p256dh: b64u(uaPublic), auth: b64u(auth) } }, message);
  assert.equal(await decrypt(body, ua, uaPublic, auth), message);
  const again = await encryptPayload({ keys: { p256dh: b64u(uaPublic), auth: b64u(auth) } }, message);
  assert.notEqual(b64u(again), b64u(body), 'fresh keys and salt every time');
});
