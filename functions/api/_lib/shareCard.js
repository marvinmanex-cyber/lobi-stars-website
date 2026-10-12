import { ensureShareSchema, validSlug, programmeState } from './share.js';
import { r2Keys, streamObject } from './programme.js';

/**
 * The public link card of a live or scheduled programme (falls back to the
 * cover until share images are saved). 404 for drafts, hidden or unknown.
 */
export async function serveShareCard(env, rawSlug) {
  try {
    const slug = validSlug(String(rawSlug || '').toLowerCase());
    if (!slug) return new Response('Not found', { status: 404 });
    await ensureShareSchema(env.DB);
    const p = await env.DB.prepare(`SELECT * FROM programmes WHERE slug = ?`).bind(slug).first();
    if (programmeState(p) === 'unavailable') return new Response('Not found', { status: 404 });
    const key = p.share_assets_version > 0 ? r2Keys(p.slug, p.share_assets_version).share.card : p.cover_key;
    return streamObject(env, key, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
  } catch (err) {
    console.error('[share] card', err);
    return new Response('Not found', { status: 404 });
  }
}
