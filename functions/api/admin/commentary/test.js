import { requireAdminUser } from '../../_lib/adminEvents.js';
import { getSettings, probeStream, RELAY_PATH } from '../../_lib/commentary.js';
import { partnerSettings, fetchPartnerStatus, saveStatus, ensurePartnerSchema } from '../../_lib/partnerRadio.js';

// POST /api/admin/commentary/test -- "Test stream": checks from the server
// that the stream answers with audio. The partner's address is never sent
// back to the browser, only whether it worked.
export async function onRequestPost({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const s = await getSettings(env);
  const results = [];
  if (s.streamUrl && s.streamUrl !== RELAY_PATH) results.push({ name: 'Public stream (fans connect here)', ...(await probeStream(s.streamUrl)) });
  if (s.streamUrl === RELAY_PATH || s.relayConfigured) {
    results.push(env.PARTNER_ORIGIN_STREAM_URL
      ? { name: 'Partner feed behind /live/commentary', ...(await probeStream(env.PARTNER_ORIGIN_STREAM_URL)) }
      : { name: 'Partner feed behind /live/commentary', ok: false, error: 'PARTNER_ORIGIN_STREAM_URL is not set on the server yet.' });
  }
  if (s.backupUrl) results.push({ name: 'Backup stream', ...(await probeStream(s.backupUrl)) });
  if (!results.length) results.push({ name: 'Public stream', ok: false, error: 'No stream address is set yet.' });
  // The broadcast partner's status feed (Aeson Sports Radio): reachable, and on air or not.
  const ps = await partnerSettings(env);
  const st = await fetchPartnerStatus(ps.statusUrl);
  await ensurePartnerSchema(env.DB);
  await saveStatus(env.DB, { ok: st.ok, status: st.ok ? st.status : null, source: 'poll', error: st.error });
  results.push(st.ok
    ? { name: 'Aeson Sports Radio status feed', ok: true, contentType: `${st.status.onAir ? 'ON AIR' : 'off air'}${st.status.listeners !== null ? `, ${st.status.listeners} listening` : ''}`, ms: st.ms, onAir: st.status.onAir }
    : { name: 'Aeson Sports Radio status feed', ok: false, error: `can't be read (${st.error})`, ms: st.ms });
  if (!ps.secretSet) results.push({ name: 'Webhook secret', ok: false, error: 'not set yet: on-air changes show within 15 seconds instead of straight away.' });
  return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
}
