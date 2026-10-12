import { ensureShareSchema, programmeState, platforms, captionFor, shareUrl, shareVersion, configured, AUTO_CAPABLE } from './share.js';
import { postToPlatform } from './shareAdapters.js';
import { r2Keys } from './programme.js';

/**
 * Auto-posts a programme to the given platforms (Telegram / Facebook) and
 * records a social_posts row for each (posted or failed). One platform's
 * failure never stops the others. staff = null for the scheduler.
 * Returns [{ platform, ok, externalUrl?, error? }].
 */
export async function postProgramme(env, p, keys, staff = null) {
  const db = env.DB;
  await ensureShareSchema(db);
  const state = programmeState(p);
  const all = await platforms(db, false);
  const wanted = [...new Set(keys)].map(k => all.find(x => x.key === k)).filter(Boolean);
  const cardKey = p.share_assets_version > 0 ? r2Keys(p.slug, p.share_assets_version).share.card : null;
  const settled = await Promise.allSettled(wanted.map(async pl => {
    if (!AUTO_CAPABLE.includes(pl.key) || !configured(env, pl.key)) throw new Error('Auto-posting is not set up for this platform.');
    if (!pl.is_enabled) throw new Error('This platform is switched off in the Share Hub settings.');
    if (state === 'unavailable') throw new Error('The programme is not published or scheduled.');
    const caption = await captionFor(db, p, pl, state);
    const url = shareUrl(p.slug, pl.campaign_code, shareVersion(p));
    return postToPlatform(env, pl.key, { caption, programme: p, url, cardKey });
  }));
  const results = [];
  const writes = [];
  settled.forEach((r, i) => {
    const key = wanted[i].key;
    if (r.status === 'fulfilled') {
      results.push({ platform: key, ok: true, externalUrl: r.value.externalUrl || null });
      writes.push(db.prepare(`INSERT INTO social_posts (programme_id, platform_key, mode, status, external_id, external_url, staff_email) VALUES (?, ?, 'auto', 'posted', ?, ?, ?)`)
        .bind(p.id, key, r.value.externalId || null, r.value.externalUrl || null, staff));
    } else {
      const error = String(r.reason?.message || r.reason || 'Failed').slice(0, 300);
      results.push({ platform: key, ok: false, error });
      writes.push(db.prepare(`INSERT INTO social_posts (programme_id, platform_key, mode, status, error, staff_email) VALUES (?, ?, 'auto', 'failed', ?, ?)`)
        .bind(p.id, key, error, staff));
    }
  });
  if (writes.length) await db.batch(writes);
  return results;
}
