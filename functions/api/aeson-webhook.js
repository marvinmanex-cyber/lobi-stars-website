import { partnerSettings, verifySignature, cleanStatus, saveStatus, fetchPartnerStatus, ensurePartnerSchema } from './_lib/partnerRadio.js';

// POST /api/aeson-webhook -- the broadcast partner tells us its radio state
// changed (on air, off air, listeners, match details), so players update within
// seconds instead of waiting for the next 15-second read.
//
// Signed with the shared webhook secret (Admin › Live Commentary › Broadcast partner):
//   X-Aeson-Timestamp: <unix seconds>            (must be within 5 minutes)
//   X-Aeson-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">
// Body: the same JSON as the status feed ({ onAir, listeners, broadcast, ... }).
// A body without onAir (e.g. {"event":"changed"}) makes the site read the feed now.
const json = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_BODY = 20_000;

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'Body too large' }, 413);
  const { secret, statusUrl } = await partnerSettings(env);
  const problem = await verifySignature(secret, request.headers.get('X-Aeson-Timestamp'), request.headers.get('X-Aeson-Signature'), raw);
  if (problem) {
    console.warn('[aeson-webhook] refused:', problem);
    // One answer for every failure, so the response says nothing about the secret.
    return json({ error: 'Invalid signature' }, secret ? 401 : 503);
  }
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { return json({ error: 'Body is not JSON' }, 400); }
  await ensurePartnerSchema(env.DB);
  if (data && typeof data === 'object' && ('onAir' in data || 'on_air' in data || 'live' in data)) {
    const status = cleanStatus(data);
    await saveStatus(env.DB, { ok: true, status, source: 'webhook' });
    return json({ ok: true, onAir: status.onAir });
  }
  const r = await fetchPartnerStatus(statusUrl);
  await saveStatus(env.DB, { ok: r.ok, status: r.ok ? r.status : null, source: 'webhook', error: r.error });
  return r.ok ? json({ ok: true, onAir: r.status.onAir, refreshed: true }) : json({ ok: false, error: 'Status feed could not be read' }, 502);
}

export const onRequestGet = () => json({ error: 'Use POST' }, 405);
