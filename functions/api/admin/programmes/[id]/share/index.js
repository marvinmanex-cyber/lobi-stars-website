import { requireAdminUser } from '../../../../_lib/adminEvents.js';
import { ensureFanSchema } from '../../../../_lib/fans.js';
import {
  ensureShareSchema, platforms, programmeState, captionFor, captionLength, intentUrl, shareUrl, bioUrl,
  shareVersion, effectiveMode, configured, AUTO_CAPABLE, SITE,
} from '../../../../_lib/share.js';

// GET /api/admin/programmes/:id/share -- everything the Share Hub shows: the
// programme, its share images, and per enabled platform the tracked link,
// caption, character count, post window, last post and totals (visits,
// sign-ins, downloads, new fans for this programme and platform). No
// personal data.
export async function onRequestGet({ request, env, params }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureShareSchema(db);
    await ensureFanSchema(db);
    const p = await db.prepare(`SELECT * FROM programmes WHERE id = ?`).bind(Number(params.id) || 0).first();
    if (!p) return Response.json({ error: 'Programme not found' }, { status: 404 });
    const state = programmeState(p);
    const list = await platforms(db, true);
    const v = shareVersion(p);
    const [posts, events, fans, history] = await db.batch([
      db.prepare(`SELECT s.* FROM social_posts s WHERE s.programme_id = ? AND s.id = (SELECT MAX(id) FROM social_posts t WHERE t.programme_id = s.programme_id AND t.platform_key = s.platform_key)`).bind(p.id),
      db.prepare(`SELECT c.code, e.type, COUNT(*) AS n FROM qr_events e JOIN qr_campaigns c ON c.id = e.campaign_id WHERE e.programme_id = ? GROUP BY c.code, e.type`).bind(p.id),
      db.prepare(`SELECT first_src AS code, COUNT(*) AS n FROM members WHERE first_programme = ? AND first_src IS NOT NULL GROUP BY first_src`).bind(String(p.id)),
      db.prepare(`SELECT platform_key, mode, status, external_url, error, staff_email, created_at FROM social_posts WHERE programme_id = ? ORDER BY id DESC LIMIT 50`).bind(p.id),
    ]);
    const ev = {};
    for (const r of events.results) (ev[r.code] ||= {})[r.type] = r.n;
    const newFans = Object.fromEntries(fans.results.map(r => [r.code, r.n]));
    const out = [];
    for (const pl of list) {
      const caption = await captionFor(db, p, pl, state);
      const url = shareUrl(p.slug, pl.campaign_code, v);
      const last = posts.results.find(x => x.platform_key === pl.key);
      const e = ev[pl.campaign_code] || {};
      out.push({
        key: pl.key, name: pl.name, profileUrl: pl.profile_url, mode: pl.share_mode, effectiveMode: effectiveMode(env, pl),
        autoCapable: AUTO_CAPABLE.includes(pl.key), configured: configured(env, pl.key),
        shareUrl: url, bioUrl: bioUrl(pl.campaign_code), caption, ...captionLength(pl.key, caption), intentUrl: intentUrl(pl.key, caption, url),
        lastPost: last ? { status: last.status, mode: last.mode, at: last.created_at, staff: last.staff_email, externalUrl: last.external_url, error: last.error } : null,
        stats: { visits: e.scan || 0, signedIn: e.signin_completed || 0, downloads: e.download || 0, newFans: newFans[pl.campaign_code] || 0 },
      });
    }
    return Response.json({
      programme: { id: p.id, slug: p.slug, title: p.title, competition: p.competition, venue: p.venue, kickoffAt: p.kickoff_at, publishAt: p.publish_at, status: p.status, version: p.version, hasFiles: !!p.pdf_key },
      state, shareVersion: v,
      assetsReady: p.share_assets_version > 0, assetsStale: p.share_assets_version > 0 && p.share_assets_version !== p.version,
      cardUrl: `${SITE}/m/${p.slug}/card.jpg?v=${v}`,
      fanShareUrl: shareUrl(p.slug, 'fanshare', v),
      debuggerUrl: `https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(shareUrl(p.slug, 'facebook', v))}`,
      platforms: out,
      schedule: { at: p.social_autopost_at, platforms: JSON.parse(p.social_autopost_platforms || '[]'), done: !!p.social_autopost_done },
      history: history.results,
    });
  } catch (err) {
    console.error('[share] hub', err);
    return Response.json({ error: 'Could not load the Share Hub.' }, { status: 500 });
  }
}
