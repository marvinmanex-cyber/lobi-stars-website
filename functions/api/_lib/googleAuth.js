// Google service-account sign-in for the analytics sync (Search Console and the
// GA4 Data API), with no Google library: a JWT signed with RS256 (WebCrypto) is
// swapped for an access token at Google's token endpoint. The key comes from the
// GOOGLE_SERVICE_ACCOUNT_JSON secret and is never logged or returned.
export const SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = s => b64url(new TextEncoder().encode(s));

/** The service account from the secret: { email, key } (key = PEM), or { error }. */
export function serviceAccount(env) {
  const raw = String(env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not set' };
  try {
    const j = JSON.parse(raw);
    if (!j.client_email || !/BEGIN PRIVATE KEY/.test(j.private_key || '')) return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not a service account key (client_email / private_key missing)' };
    return { email: j.client_email, key: j.private_key, tokenUri: j.token_uri || TOKEN_URL };
  } catch { return { error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON' }; }
}

async function importKey(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** A signed JWT assertion for the token endpoint (exported for tests). */
export async function signedAssertion(sa, now = Math.floor(Date.now() / 1000), scope = SCOPES) {
  const head = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlText(JSON.stringify({ iss: sa.email, scope, aud: sa.tokenUri || TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(sa.key), new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

let cached = null; // { token, until, email } for this worker instance
/** An access token (reused until 5 minutes before it expires). */
export async function accessToken(env, fetcher = fetch) {
  const sa = serviceAccount(env);
  if (sa.error) throw new Error(sa.error);
  if (cached && cached.email === sa.email && cached.until > Date.now() + 300000) return cached.token;
  const r = await fetcher(sa.tokenUri, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signedAssertion(sa) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google sign-in failed (${r.status}): ${String(d.error_description || d.error || '').slice(0, 160)}`);
  cached = { token: d.access_token, until: Date.now() + (Number(d.expires_in) || 3600) * 1000, email: sa.email };
  return cached.token;
}
