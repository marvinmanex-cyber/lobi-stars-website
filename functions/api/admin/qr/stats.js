import { requireAdminUser } from '../../_lib/adminEvents.js';
import { qrStats } from '../../_lib/qr.js';
import { ensureFanSchema } from '../../_lib/fans.js';

// GET /api/admin/qr/stats?campaign=&programme=&from=&to=
// The funnel (scans -> landings -> sign-ins started / completed -> downloads,
// reads), new fans gained, devices, in-app share, per campaign and per day.
// Conversion = downloads / scans. Counts only; no personal data.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    await ensureFanSchema(env.DB);
    const q = new URL(request.url).searchParams;
    const iso = v => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
    const f = { campaignId: Number(q.get('campaign')) || null, programmeId: Number(q.get('programme')) || null, from: iso(q.get('from')), to: iso(q.get('to')) };
    const st = await qrStats(env.DB, f);
    let newFans = 0;
    if (f.campaignId) {
      const c = await env.DB.prepare(`SELECT code FROM qr_campaigns WHERE id = ?`).bind(f.campaignId).first();
      newFans = c ? st.newFansByCode[c.code] || 0 : 0;
    } else newFans = Object.values(st.newFansByCode).reduce((a, b) => a + b, 0);
    return Response.json({ ...st, newFans });
  } catch (err) {
    console.error('[admin qr] stats', err);
    return Response.json({ error: 'Could not load the stats.' }, { status: 500 });
  }
}
