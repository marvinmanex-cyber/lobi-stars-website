import { requireAdminUser } from '../../../_lib/adminEvents.js';
import { logAdminAction } from '../../../_lib/adminSession.js';
import { ensureQrSchema, qrStats, CHANNELS, RESERVED, CODE_RE, randomCode } from '../../../_lib/qr.js';
import { ensureFanSchema } from '../../../_lib/fans.js';
import { stripTags } from '../../../_lib/programme.js';

// GET  /api/admin/qr/campaigns?programme=&from=&to=  -- every campaign with its funnel numbers for the range
// POST /api/admin/qr/campaigns { label, channel, code?, notes }  -- new campaign (code made up if left empty)
function rangeFrom(url) {
  const q = url.searchParams;
  const iso = v => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  return { programmeId: Number(q.get('programme')) || null, from: iso(q.get('from')), to: iso(q.get('to')), campaignId: Number(q.get('campaign')) || null };
}

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureQrSchema(db);
    await ensureFanSchema(db);
    const f = rangeFrom(new URL(request.url));
    const { results } = await db.prepare(`SELECT * FROM qr_campaigns ORDER BY is_active DESC, id`).all();
    const st = await qrStats(db, { ...f, campaignId: null });
    const zero = { scan: 0, landing: 0, signin_started: 0, signin_completed: 0, download: 0, read: 0 };
    const campaigns = results.map(c => {
      const n = st.perCampaign[c.id] || zero;
      return { ...c, counts: n, newFans: st.newFansByCode[c.code] || 0, conversion: n.scan ? n.download / n.scan : 0 };
    });
    return Response.json({ campaigns, channels: CHANNELS, reserved: RESERVED, totals: st });
  } catch (err) {
    console.error('[admin qr] list', err);
    return Response.json({ error: 'Could not load the QR campaigns.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureQrSchema(db);
    const b = await request.json().catch(() => ({}));
    const label = stripTags(b.label).slice(0, 80);
    const channel = String(b.channel || '');
    const notes = stripTags(b.notes).slice(0, 500) || null;
    if (!label) return Response.json({ error: 'Please give the campaign a name, e.g. "Stadium gate posters".' }, { status: 400 });
    if (!CHANNELS.includes(channel)) return Response.json({ error: 'Please choose a channel.' }, { status: 400 });
    let code = String(b.code || '').trim().toLowerCase();
    if (code) {
      if (!CODE_RE.test(code)) return Response.json({ error: 'The short code must be 3 to 12 characters: lowercase letters, numbers or -.' }, { status: 400 });
      if (RESERVED.includes(code)) return Response.json({ error: `"${code}" is reserved. Please choose another code.` }, { status: 400 });
      if (await db.prepare(`SELECT 1 FROM qr_campaigns WHERE code = ?`).bind(code).first()) return Response.json({ error: `The code "${code}" is already used.` }, { status: 409 });
    } else {
      for (let i = 0; i < 20 && (!code || await db.prepare(`SELECT 1 FROM qr_campaigns WHERE code = ?`).bind(code).first()); i++) code = randomCode(5);
    }
    const row = await db.prepare(`INSERT INTO qr_campaigns (code, label, channel, notes, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *`)
      .bind(code, label, channel, notes, admin.name).first();
    await logAdminAction(db, admin, 'qr_campaign_create', `${label} (/p/${code}, ${channel})`);
    return Response.json({ ok: true, campaign: row });
  } catch (err) {
    console.error('[admin qr] create', err);
    return Response.json({ error: 'Could not create the campaign.' }, { status: 500 });
  }
}
