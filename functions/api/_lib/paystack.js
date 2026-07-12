// Minimal Paystack REST client using fetch (no SDK needed).
// Docs: https://paystack.com/docs/api/transaction/

const PAYSTACK_BASE = 'https://api.paystack.co';

export async function initializeTransaction(secretKey, { email, amountKobo, reference, callbackUrl, metadata }) {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: amountKobo,
      reference,
      callback_url: callbackUrl,
      metadata,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Paystack initialize failed');
  }
  return data.data; // { authorization_url, access_code, reference }
}

export async function verifyTransaction(secretKey, reference) {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Paystack verify failed');
  }
  return data.data; // { status: 'success'|'failed'|..., amount, reference, ... }
}

// Verifies the X-Paystack-Signature header on incoming webhook requests:
// HMAC-SHA512 of the raw request body, keyed with the secret key, hex-encoded.
export async function verifyWebhookSignature(secretKey, rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sigBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === signatureHeader;
}
