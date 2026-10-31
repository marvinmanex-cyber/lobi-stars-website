// Media Centre › Photo & Video Library: albums by match or event, each photo
// with a caption, photographer credit and player tags, plus video links. An
// album appears in the public Gallery only after a Super Admin approves it:
// its photos are written into the Gallery (src/content/gallery, the site's
// existing gallery) in one GitHub commit, and the site rebuilds (~3 minutes).
// Unpublishing hides the photos again (kept, never deleted). Every uploaded
// picture can be reused in news stories and newsletters ("From library").
import { githubReady, commitFiles } from './github.js';
import { slugify } from './mediaNews.js';
import { fileRow, fileBytes, setCommitted, fileIdsIn } from './mediaFiles.js';
import { oneLine, ensureMediaSchema, parseJson } from './mediaCentre.js';
import { VIDEO_RE } from './mediaNews.js';

const FILE_URL = /^\/api\/media-file\/[a-z0-9_]{4,40}$/;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yaml = v => JSON.stringify(v);

async function normalise(d) {
  d = d || {};
  return { value: {
    title: oneLine(d.title, 120), eventId: oneLine(d.eventId, 80), eventLabel: oneLine(d.eventLabel, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || '')) ? String(d.date) : '',
    credit: oneLine(d.credit, 100),
    photos: (Array.isArray(d.photos) ? d.photos : []).filter(p => FILE_URL.test(String(p?.url || ''))).slice(0, 60).map(p => ({
      url: String(p.url), id: String(p.url).split('/').pop(), caption: oneLine(p.caption, 200), credit: oneLine(p.credit, 100),
      players: (Array.isArray(p.players) ? p.players : []).map(s => String(s).toLowerCase()).filter(s => /^[a-z0-9-]{2,80}$/.test(s)).slice(0, 8) })),
    videos: (Array.isArray(d.videos) ? d.videos : []).map(v => ({ url: String(v?.url || '').trim(), caption: oneLine(v?.caption, 200) })).filter(v => VIDEO_RE.test(v.url)).slice(0, 10),
  } };
}
function validate(v) {
  if (v.title.length < 3) return 'Give the album a title (e.g. "Lobi Stars 2-1 Kada City").';
  if (!v.photos.length) return 'Add at least one photo.';
  const noCap = v.photos.findIndex(p => !p.caption);
  if (noCap >= 0) return `Photo ${noCap + 1} needs a caption.`;
  if (!v.credit && v.photos.some(p => !p.credit)) return 'Add the photographer credit (for the album or each photo).';
  return null;
}
const previewHtml = v => `<h3 style="margin:0 0 6px">${esc(v.title)}</h3><p style="font-size:13px;color:#4A505C">${esc(v.eventLabel || '')} ${esc(v.date)} · Photos: ${esc(v.credit || 'see each photo')}</p>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">${v.photos.map(p => `<figure style="margin:0"><img src="${esc(p.url)}" alt="" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px"><figcaption style="font-size:12px">${esc(p.caption)}${p.credit ? ` (${esc(p.credit)})` : ''}${p.players.length ? `<br><i>${esc(p.players.join(', '))}</i>` : ''}</figcaption></figure>`).join('')}</div>
  ${v.videos.length ? `<p><b>Videos:</b> ${v.videos.map(x => esc(x.url)).join(', ')}</p>` : ''}`;

function galleryFiles(r, v, slug, paths, hidden = false) {
  return v.photos.map((p, i) => ({ path: `src/content/gallery/${slug}-${String(i + 1).padStart(2, '0')}.md`, text: [
    '---', `caption: ${yaml(`${v.title}: ${p.caption}`)}`, `photo: ${yaml(paths[p.id] || p.url)}`, `album: ${yaml(v.title)}`,
    `credit: ${yaml(p.credit || v.credit || '')}`, p.players.length ? `players: ${yaml(p.players)}` : null, i === 0 && v.videos?.length ? `videos: ${yaml(v.videos.map(x => ({ url: x.url, caption: x.caption || null })))}` : null, `mcId: ${yaml(r.id)}`, `hidden: ${hidden ? 'true' : 'false'}`, '---', '',
  ].filter(l => l !== null).join('\n') }));
}
async function publish(env, r, v) {
  if (!githubReady(env)) return { error: 'Publishing to the Gallery needs the GitHub connection (GITHUB_TOKEN in Cloudflare).' };
  const slug = r.slug || `${v.date || new Date(Date.now() + 3600e3).toISOString().slice(0, 10)}-${slugify(v.title)}`.slice(0, 80);
  const files = [], paths = {};
  for (const p of v.photos) {
    const row = await fileRow(env.DB, p.id);
    if (!row) return { error: 'A photo in this album is missing. Please upload it again.' };
    const ext = row.mime === 'image/png' ? 'png' : row.mime === 'image/webp' ? 'webp' : 'jpg';
    const repoPath = `public/images/gallery/mc/${p.id}.${ext}`;
    paths[p.id] = `/images/gallery/mc/${p.id}.${ext}`;
    if (row.committed_path === repoPath) continue;
    const bytes = await fileBytes(env, row);
    if (!bytes) return { error: 'A photo could not be read. Please upload it again.' };
    files.push({ path: repoPath, bytes, id: p.id });
  }
  files.push(...galleryFiles(r, v, slug, paths));
  await commitFiles(env, files, `Gallery: ${v.title} (Media Centre, approved)`);
  for (const f of files) if (f.id) await setCommitted(env.DB, f.id, f.path);
  return { ok: true, slug, note: `${v.photos.length} photo${v.photos.length === 1 ? '' : 's'} go into the Gallery in about 3 minutes.` };
}
async function unpublish(env, r) {
  if (!githubReady(env)) return { error: 'Needs the GitHub connection (GITHUB_TOKEN).' };
  const v = parseJson(r.live_json || r.data_json, {});
  const paths = {};
  for (const p of v.photos || []) { const row = await fileRow(env.DB, p.id); if (row?.committed_path) paths[p.id] = row.committed_path.replace(/^public/, ''); }
  await commitFiles(env, galleryFiles(r, v, r.slug, paths, true), `Gallery: hid ${v.title} (Media Centre)`);
  return { ok: true };
}
export const ALBUM = {
  label: 'Photo album', section: 'library', schedulable: false,
  normalise, validate, previewHtml, publish, unpublish,
  titleOf: v => v.title || '(untitled album)',
  adminFields: [{ key: 'title', label: 'Album title', type: 'text' }, { key: 'credit', label: 'Photographer', type: 'text' }, { key: 'photos', label: 'Photos (captions, credits, tags)', type: 'json' }],
};

/** Pictures for "From library": every uploaded picture, newest first, with the album it is in. */
export async function libraryImages(db, { q = '', limit = 120 } = {}) {
  await ensureMediaSchema(db);
  const rows = (await db.prepare(`SELECT id, name, width, height, uploaded_by_name, created_at FROM mc_files WHERE kind = 'image' AND (owner IS NULL OR owner <> 'accreditation') ORDER BY created_at DESC LIMIT ?`).bind(Math.min(400, limit)).all()).results;
  const albums = (await db.prepare(`SELECT title, data_json FROM mc_items WHERE kind = 'album' ORDER BY updated_at DESC LIMIT 100`).all()).results;
  const inAlbum = {};
  for (const a of albums) for (const id of fileIdsIn(parseJson(a.data_json, {}))) inAlbum[id] ||= a.title;
  const needle = q.toLowerCase();
  return rows.map(r => ({ id: r.id, url: `/api/media-file/${r.id}`, name: r.name, width: r.width, height: r.height, by: r.uploaded_by_name, at: r.created_at, album: inAlbum[r.id] || null }))
    .filter(x => !needle || `${x.name} ${x.album || ''}`.toLowerCase().includes(needle));
}
