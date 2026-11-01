// Media Centre › Latest News: the story's fields, checks, the Approval Queue
// preview, and publishing. An approved story is written as a news file
// (src/content/news/<slug>.md, the same format the content editor uses) with
// its photos (public/images/news/mc/), in one commit to the website's GitHub
// repository. Cloudflare then rebuilds the site (about 3 minutes) and the
// story appears on the News page, the homepage latest news and, when tagged,
// the player and match pages, using the site's existing templates.
// Unpublishing turns the file into a draft (hidden everywhere; never deleted).
import { githubReady, commitFiles } from './github.js';
import { sanitizeHtml, textOf } from './mediaSanitize.js';
import { fileRow, fileBytes, setCommitted, fileIdsIn } from './mediaFiles.js';
import { oneLine, clean } from './mediaCentre.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FILE_URL = /^\/api\/media-file\/[a-z0-9_]{4,40}$/;
export const VIDEO_RE = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|facebook\.com|fb\.watch)\/[^\s"'<>]{3,300}$/i;
// The /news "content type" behind matchday features (match page links, admin checklist).
const CONTENT_TYPE = { 'Match Preview': 'Preview', 'Match Report': 'Match Report', 'Team News & Line-ups': 'Line-ups', 'Post-Match Reaction': 'Reaction/Interview' };
export const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'story';

async function normalise(d, ctx = {}) {
  d = d || {};
  const pic = p => (p && FILE_URL.test(String(p.url || '')) ? { url: String(p.url), id: String(p.url).split('/').pop() } : null);
  const v = {
    category: oneLine(d.category, 40),
    headline: oneLine(d.headline, 150),
    summary: oneLine(d.summary, 320),
    cover: pic(d.cover),
    caption: oneLine(d.caption, 200),
    credit: oneLine(d.credit, 100),
    body: await sanitizeHtml(d.body, { max: 80000 }),
    gallery: (Array.isArray(d.gallery) ? d.gallery : []).map(g => { const p = pic(g); return p ? { ...p, caption: oneLine(g.caption, 200) } : null; }).filter(Boolean).slice(0, 24),
    video: VIDEO_RE.test(String(d.video || '').trim()) ? String(d.video).trim() : '',
    players: (Array.isArray(d.players) ? d.players : []).map(s => String(s).toLowerCase()).filter(s => /^[a-z0-9-]{2,80}$/.test(s)).slice(0, 12),
    staff: (Array.isArray(d.staff) ? d.staff : []).map(s => String(s).toLowerCase()).filter(s => /^[a-z0-9-]{2,80}$/.test(s)).slice(0, 6),
    match: d.match && /^[\w-]{1,80}$/.test(String(d.match.id || '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(d.match.date || '')) ? { id: String(d.match.id), date: String(d.match.date), label: oneLine(d.match.label, 120) } : null,
    // Breaking news (homepage banner): only a Super Admin can switch it on; writers can ask for it.
    breaking: ctx.admin ? !!d.breaking : false,
    breakingRequested: !!d.breakingRequested,
    author: oneLine(d.author, 80),
  };
  if (d.video && !v.video) return { error: 'The video link must be a YouTube or Facebook address.' };
  return { value: v };
}
function validate(v) {
  if (!v.category) return 'Choose a category.';
  if (v.headline.length < 10) return 'Write a headline (at least 10 characters).';
  if (v.summary.length < 20) return 'Write a short summary of one or two sentences (it is shown on news cards and when the story is shared).';
  if (!v.cover) return 'Add the main photo.';
  if (v.caption.length < 3) return 'Write a caption for the main photo (it also describes the photo for blind readers).';
  if (textOf(v.body).length < 40) return 'Write the story (at least a few sentences).';
  return null;
}
function previewHtml(v) {
  const img = p => p ? `<img src="${esc(p.url)}" alt="" style="max-width:100%;border-radius:8px">` : '';
  return `<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;color:#C9242C">${esc(v.category)}${v.breaking ? ' · BREAKING' : v.breakingRequested ? ' · breaking news requested' : ''}</p>
    <h2 style="margin:0 0 8px;font-size:26px;line-height:1.15">${esc(v.headline)}</h2><p style="font-size:17px;color:#4A505C">${esc(v.summary)}</p>
    ${img(v.cover)}<p style="font-size:13px;color:#4A505C">${esc(v.caption)}${v.credit ? ` (Photo: ${esc(v.credit)})` : ''}</p>
    <div style="font-size:16px;line-height:1.6">${v.body}</div>
    ${v.gallery.length ? `<p><b>Gallery:</b></p><div style="display:flex;flex-wrap:wrap;gap:6px">${v.gallery.map(g => `<img src="${esc(g.url)}" alt="" style="width:120px;height:90px;object-fit:cover;border-radius:6px">`).join('')}</div>` : ''}
    ${v.video ? `<p><b>Video:</b> ${esc(v.video)}</p>` : ''}
    ${v.players.length || v.staff.length || v.match ? `<p style="font-size:13px;color:#4A505C"><b>Tags:</b> ${esc([...v.players, ...v.staff, v.match ? `Match: ${v.match.label}` : ''].filter(Boolean).join(', '))}</p>` : ''}`;
}

const yaml = v => JSON.stringify(v); // JSON strings and lists are valid YAML
/** The news file for a story (status: published or draft). paths: file id -> /images/news/mc/... */
export function newsMarkdown(v, { slug, tab, publishedAt, updatedAt = null, status = 'published', paths = {}, mcId }) {
  const swap = s => String(s || '').replace(/\/api\/media-file\/([a-z0-9_]{4,40})/g, (m, id) => paths[id] || m);
  const lines = [
    '---',
    `title: ${yaml(v.headline)}`,
    `summary: ${yaml(v.summary)}`,
    `category: ${yaml(v.category)}`,
    `newsTab: ${yaml(tab)}`,
    `coverImage: ${yaml(swap(v.cover.url))}`,
    `imageAlt: ${yaml(v.caption)}`,
    `coverCaption: ${yaml(v.caption)}`,
    v.credit ? `coverCredit: ${yaml(v.credit)}` : null,
    `publishedAt: ${yaml(publishedAt)}`,
    updatedAt ? `updatedAt: ${yaml(updatedAt)}` : null,
    `status: ${status}`,
    `isBanner: ${v.breaking ? 'true' : 'false'}`,
    v.video ? 'isVideo: true' : null,
    v.video ? `videoUrl: ${yaml(v.video)}` : null,
    v.author ? `author: ${yaml(v.author)}` : null,
    v.players.length ? `players: ${yaml(v.players)}` : null,
    v.staff.length ? `staff: ${yaml(v.staff)}` : null,
    v.match ? `matchDate: ${yaml(v.match.date)}` : null,
    CONTENT_TYPE[v.category] && v.match ? `contentType: ${yaml(CONTENT_TYPE[v.category])}` : null,
    v.gallery.length ? `gallery: ${yaml(v.gallery.map(g => ({ src: swap(g.url), caption: g.caption || null })))}` : null,
    `mcId: ${yaml(mcId)}`,
    '---',
    '',
    swap(v.body),
    '',
  ];
  return lines.filter(l => l !== null).join('\n');
}

async function categoryTab(db, name) {
  try { return (await db.prepare(`SELECT tab FROM mc_categories WHERE name = ?`).bind(name).first())?.tab || 'Team News'; } catch { return 'Team News'; }
}
async function slugFor(env, r, v) {
  if (r.slug) return r.slug;
  const base = `${new Date(Date.now() + 3600e3).toISOString().slice(0, 10)}-${slugify(v.headline)}`;
  let slug = base;
  for (let n = 2; n < 20; n++) {
    const taken = await env.DB.prepare(`SELECT id FROM mc_items WHERE kind = 'news' AND slug = ? AND id <> ?`).bind(slug, r.id).first();
    let exists = false;
    try { exists = !!(await env.ASSETS?.fetch(new Request(`https://x/news/${slug}/`)))?.ok; } catch { /* no assets binding in tests */ }
    if (!taken && !exists) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function publish(env, r, v, ctx = {}) {
  if (!githubReady(env)) return { error: 'Publishing news needs the GitHub connection (GITHUB_TOKEN in Cloudflare).' };
  const slug = await slugFor(env, r, v);
  const files = [], paths = {};
  for (const id of fileIdsIn(v)) {
    const row = await fileRow(env.DB, id);
    if (!row) return { error: 'A photo in this story is missing. Please upload it again.' };
    const ext = row.mime === 'image/png' ? 'png' : row.mime === 'image/webp' ? 'webp' : 'jpg';
    const repoPath = `public/images/news/mc/${id}.${ext}`;
    paths[id] = `/images/news/mc/${id}.${ext}`;
    if (row.committed_path === repoPath) continue; // already on the website
    const bytes = await fileBytes(env, row);
    if (!bytes) return { error: 'A photo in this story could not be read. Please upload it again.' };
    files.push({ path: repoPath, bytes, id });
  }
  const now = new Date().toISOString();
  const md = newsMarkdown(v, { slug, tab: await categoryTab(env.DB, v.category), publishedAt: r.published_at || now, updatedAt: r.published_at ? now : null, paths, mcId: r.id });
  files.push({ path: `src/content/news/${slug}.md`, text: md });
  await commitFiles(env, files, `${r.published_at ? 'Correction' : 'News'}: ${v.headline} (Media Centre, approved)`);
  for (const f of files) if (f.id) await setCommitted(env.DB, f.id, f.path);
  return { ok: true, slug, note: `It appears on the website in about 3 minutes: /news/${slug}/` };
}
async function unpublish(env, r) {
  if (!githubReady(env)) return { error: 'Unpublishing news needs the GitHub connection (GITHUB_TOKEN in Cloudflare).' };
  if (!r.slug) return { ok: true };
  const v = JSON.parse(r.live_json || r.data_json || '{}');
  const paths = {};
  for (const id of fileIdsIn(v)) { const row = await fileRow(env.DB, id); if (row?.committed_path) paths[id] = row.committed_path.replace(/^public/, ''); }
  const md = newsMarkdown(v, { slug: r.slug, tab: await categoryTab(env.DB, v.category), publishedAt: r.published_at || new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'draft', paths, mcId: r.id });
  await commitFiles(env, [{ path: `src/content/news/${r.slug}.md`, text: md }], `Unpublished: ${v.headline} (Media Centre)`);
  return { ok: true };
}

export const NEWS = {
  label: 'News story', section: 'news', schedulable: true,
  normalise, validate, previewHtml, publish, unpublish,
  titleOf: v => v.headline || '(untitled story)',
  adminFields: [
    { key: 'headline', label: 'Headline', type: 'text' }, { key: 'summary', label: 'Summary', type: 'textarea' },
    { key: 'category', label: 'Category', type: 'text' }, { key: 'caption', label: 'Photo caption', type: 'text' }, { key: 'credit', label: 'Photo credit', type: 'text' },
    { key: 'body', label: 'Story (HTML)', type: 'html' }, { key: 'video', label: 'Video link (YouTube or Facebook)', type: 'text' },
    { key: 'breaking', label: 'Breaking news: show the homepage banner (Super Admins only)', type: 'bool' },
  ],
};
export { clean };
