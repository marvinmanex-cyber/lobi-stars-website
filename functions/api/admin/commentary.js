import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { getSettings, ensureCommentarySchema, isOurDomain, commentaryFixtures, commentaryState, publicFixture, liveListeners, RELAY_PATH } from '../_lib/commentary.js';

// GET /api/admin/commentary -- Lobi Stars FC Live settings, delivery option,
// on-air state and live listener count for Admin -> Commentary.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const s = await getSettings(env);
  const st = commentaryState(await commentaryFixtures(env.DB));
  const live = st.state === 'live' ? st.fixture : null;
  const peak = live ? await env.DB.prepare(`SELECT peak FROM commentary_peaks WHERE event_id = ?`).bind(live.id).first() : null;
  return Response.json({
    settings: { enabled: s.enabled, streamUrl: s.streamUrl, backupUrl: s.backupUrl, commentators: s.commentators, maxListeners: s.maxListeners },
    delivery: s.streamUrl === RELAY_PATH ? 'relay' : s.streamUrl ? 'own-domain' : 'not-set',
    relayConfigured: s.relayConfigured,
    state: st.state,
    fixture: st.fixture ? publicFixture(st.fixture, st.window) : null,
    listeners: live ? await liveListeners(env.DB, live.id) : 0,
    peak: peak?.peak || 0,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// PUT /api/admin/commentary { enabled, streamUrl, backupUrl, commentators, maxListeners }
// Stream addresses must be on lobistarsfc.com (or the /live/commentary relay).
export async function onRequestPut({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const stream = str(b.streamUrl), backup = str(b.backupUrl);
  const notOurs = 'Stream addresses must be on lobistarsfc.com (for example https://stream.lobistarsfc.com/live) or /live/commentary, so fans only ever see a Lobi Stars address.';
  if (stream && !isOurDomain(stream)) return Response.json({ error: notOurs }, { status: 400 });
  if (backup && !isOurDomain(backup)) return Response.json({ error: notOurs }, { status: 400 });
  const max = Number.parseInt(b.maxListeners, 10);
  if (b.maxListeners !== undefined && b.maxListeners !== '' && (!Number.isFinite(max) || max < 1 || max > 100000)) {
    return Response.json({ error: 'Maximum listeners must be a number from 1 to 100,000.' }, { status: 400 });
  }
  await ensureCommentarySchema(env.DB);
  const now = new Date().toISOString();
  const rows = {
    enabled: b.enabled === false ? 'off' : 'on',
    stream_url: stream, backup_url: backup,
    commentators: str(b.commentators).replace(/aeson/gi, '').slice(0, 200),
    max_listeners: Number.isFinite(max) ? String(max) : '500',
  };
  await env.DB.batch(Object.entries(rows).map(([k, v]) =>
    env.DB.prepare(`INSERT INTO commentary_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
                    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(k, v, now, admin.name)));
  await logAdminAction(env.DB, admin, 'commentary_settings', `on=${rows.enabled} stream=${stream || '(default)'}`);
  // Fans see the change within seconds (the public state is cached for 15s).
  try { await caches.default.delete(new Request(new URL('/api/commentary', request.url).toString())); } catch {}
  return Response.json({ ok: true });
}
