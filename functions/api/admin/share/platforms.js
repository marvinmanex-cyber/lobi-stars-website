import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logAdminAction } from '../../_lib/adminSession.js';
import { platforms, cleanCaption, httpsUrl, configured, effectiveMode } from '../../_lib/share.js';

// GET   /api/admin/share/platforms  -- the club's social platforms and their caption templates
// PATCH /api/admin/share/platforms { key, profile_url?, caption_live?, caption_upcoming?, hashtags?, is_enabled?, sort_order? }
// The key and campaign code can never change (tracked links and stats use them).
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const list = await platforms(env.DB, false);
    return Response.json({ platforms: list.map(p => ({ ...p, configured: configured(env, p.key), effectiveMode: effectiveMode(env, p) })) });
  } catch (err) {
    console.error('[share] platforms', err);
    return Response.json({ error: 'Could not load the platforms.' }, { status: 500 });
  }
}

export async function onRequestPatch({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const b = await request.json().catch(() => ({}));
    const p = (await platforms(db, false)).find(x => x.key === b.key);
    if (!p) return Response.json({ error: 'Unknown platform.' }, { status: 404 });
    if ((b.campaign_code !== undefined && b.campaign_code !== p.campaign_code) || (b.newKey !== undefined)) return Response.json({ error: 'The platform key and campaign code can never change.' }, { status: 400 });
    const next = { ...p };
    if (b.profile_url !== undefined) {
      if (String(b.profile_url).trim() === '') next.profile_url = null;
      else { next.profile_url = httpsUrl(b.profile_url); if (!next.profile_url) return Response.json({ error: 'The profile link must start with https://' }, { status: 400 }); }
    }
    for (const f of ['caption_live', 'caption_upcoming']) {
      if (b[f] !== undefined) { next[f] = cleanCaption(b[f]).trim(); if (!next[f]) return Response.json({ error: 'A caption template cannot be empty.' }, { status: 400 }); }
    }
    if (b.hashtags !== undefined) next.hashtags = cleanCaption(b.hashtags).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (b.is_enabled !== undefined) next.is_enabled = b.is_enabled ? 1 : 0;
    if (b.sort_order !== undefined) next.sort_order = Math.max(0, Math.min(99, Number(b.sort_order) || 0));
    await db.prepare(`UPDATE social_platforms SET profile_url = ?, caption_live = ?, caption_upcoming = ?, hashtags = ?, is_enabled = ?, sort_order = ? WHERE key = ?`)
      .bind(next.profile_url, next.caption_live, next.caption_upcoming, next.hashtags, next.is_enabled, next.sort_order, p.key).run();
    const changed = ['profile_url', 'caption_live', 'caption_upcoming', 'hashtags', 'is_enabled', 'sort_order'].filter(k => next[k] !== p[k]);
    if (changed.length) await logAdminAction(db, admin, 'share_platform', `${p.name}: ${changed.join(', ')} changed`);
    return Response.json({ ok: true, platform: next });
  } catch (err) {
    console.error('[share] platform patch', err);
    return Response.json({ error: 'Could not save the platform.' }, { status: 500 });
  }
}
