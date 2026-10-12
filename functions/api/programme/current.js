import { getCurrentProgramme, programmeSettings, toPublic, bucket } from '../_lib/programme.js';

// GET /api/programme/current -- the programme to show now, or the next one's
// publish time for a countdown. { enabled: false } until the file storage (R2)
// is connected or the programme is switched off.
export async function onRequestGet({ env }) {
  const headers = { 'Cache-Control': 'public, max-age=30' };
  const serverTime = new Date().toISOString();
  try {
    const s = await programmeSettings(env.DB);
    if (!s.enabled || !bucket(env)) return Response.json({ enabled: false, serverTime }, { headers });
    const { current, next } = await getCurrentProgramme(env.DB);
    return Response.json({
      enabled: true, serverTime, homepageBanner: s.homepageBanner, scanAutoDownload: s.scanAutoDownload,
      programme: current ? toPublic(current) : null,
      upcoming: next ? { title: next.title, publishAt: next.publish_at, kickoffAt: next.kickoff_at } : null,
    }, { headers });
  } catch (err) {
    console.error('[programme] current', err);
    return Response.json({ enabled: false, serverTime }, { headers });
  }
}
