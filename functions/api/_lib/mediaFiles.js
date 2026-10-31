// Media Centre files: photos and documents uploaded by media staff (and by the
// public accreditation / interview forms), kept in R2 (SQUAD_BUCKET, under
// media-centre/). Images are resized in the browser before upload (longest
// side at most 1600 px, WebP or JPEG); the server checks the real file type
// (its first bytes) and the size.
//   images:    JPG, PNG, WebP up to 5 MB
//   documents: PDF, JPG up to 5 MB
// Files are private (staff only) until marked public (press kit, press releases).
import { ensureMediaSchema, newId } from './mediaCentre.js';

export const MAX_BYTES = 5 * 1024 * 1024;
const nowIso = () => new Date().toISOString();
let colsReady = false;
async function ensureFileCols(db) {
  if (colsReady) return;
  await ensureMediaSchema(db);
  const have = new Set((await db.prepare(`PRAGMA table_info(mc_files)`).all()).results.map(r => r.name));
  for (const [n, t] of [['committed_path', 'TEXT'], ['owner', 'TEXT']]) if (!have.has(n)) await db.prepare(`ALTER TABLE mc_files ADD COLUMN ${n} ${t}`).run().catch(() => {});
  colsReady = true;
}

/** The real type from the first bytes: 'jpg' | 'png' | 'webp' | 'pdf' | null. */
export function sniff(b) {
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2D) return 'pdf';
  return null;
}
export const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
const ALLOWED = { image: ['jpg', 'png', 'webp'], document: ['pdf', 'jpg'], photo: ['jpg', 'png', 'webp'] };

/**
 * Stores an uploaded file. kind: image | document | photo (passport photo).
 * Returns { file: { id, url, mime, bytes, width, height } } or { error }.
 */
export async function storeFile(env, { blob, kind = 'image', name = '', width = null, height = null, by = null, byName = null, owner = null, isPublic = false }) {
  const db = env.DB;
  await ensureFileCols(db);
  if (!env.SQUAD_BUCKET) return { error: 'File storage is not set up on this website.' };
  if (!blob || typeof blob.arrayBuffer !== 'function') return { error: 'No file was received.' };
  if (blob.size > MAX_BYTES) return { error: 'The file is larger than 5 MB.' };
  if (blob.size < 100) return { error: 'The file is empty.' };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = sniff(bytes);
  if (!type || !(ALLOWED[kind] || []).includes(type)) return { error: kind === 'document' ? 'Only PDF or JPG files can be uploaded here.' : 'Only JPG, PNG or WebP pictures can be uploaded.' };
  const id = newId('f').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const key = `media-centre/${new Date().toISOString().slice(0, 7)}/${id}.${type}`;
  await env.SQUAD_BUCKET.put(key, bytes, { httpMetadata: { contentType: MIME[type] } });
  const w = Number.isInteger(Number(width)) && Number(width) > 0 && Number(width) < 20000 ? Number(width) : null;
  const h = Number.isInteger(Number(height)) && Number(height) > 0 && Number(height) < 20000 ? Number(height) : null;
  await db.prepare(`INSERT INTO mc_files (id, r2_key, kind, mime, bytes, name, width, height, is_public, uploaded_by, uploaded_by_name, created_at, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, key, kind, MIME[type], bytes.length, String(name || '').slice(0, 120), w, h, isPublic ? 1 : 0, by, byName, nowIso(), owner).run();
  return { file: { id, url: `/api/media-file/${id}`, mime: MIME[type], bytes: bytes.length, width: w, height: h, ext: type } };
}
export async function fileRow(db, id) {
  await ensureFileCols(db);
  if (!/^[a-z0-9_]{4,40}$/.test(String(id || ''))) return null;
  return db.prepare(`SELECT * FROM mc_files WHERE id = ?`).bind(id).first();
}
export async function fileBytes(env, row) {
  const obj = row ? await env.SQUAD_BUCKET?.get(row.r2_key) : null;
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}
export async function setPublic(db, ids, on = true) {
  await ensureFileCols(db);
  for (const id of ids) await db.prepare(`UPDATE mc_files SET is_public = ? WHERE id = ?`).bind(on ? 1 : 0, id).run();
}
export async function setCommitted(db, id, path) {
  await ensureFileCols(db);
  await db.prepare(`UPDATE mc_files SET committed_path = ? WHERE id = ?`).bind(path, id).run();
}
/** File ids referenced as /api/media-file/<id> anywhere in a value. */
export function fileIdsIn(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value || '');
  return [...new Set([...s.matchAll(/\/api\/media-file\/([a-z0-9_]{4,40})/g)].map(m => m[1]))];
}
