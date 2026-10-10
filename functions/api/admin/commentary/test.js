import { requireAdminUser } from '../../_lib/adminEvents.js';
import { getSettings, probeStream, RELAY_PATH } from '../../_lib/commentary.js';

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
  return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
}
