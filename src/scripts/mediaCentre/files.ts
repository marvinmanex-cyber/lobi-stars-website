// Media Centre: uploads and safe HTML in the browser.
// Pictures are resized here before upload (longest side 1600 px, WebP, or
// JPEG where WebP isn't supported); the server checks type and size again.
import { api } from './core';

export const MAX_BYTES = 5 * 1024 * 1024;
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function resize(file: File, maxSide: number): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('This picture could not be opened. Please choose a JPG, PNG or WebP photo.');
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * scale), height = Math.round(bmp.height * scale);
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const g = c.getContext('2d')!; g.drawImage(bmp, 0, 0, width, height);
  bmp.close?.();
  const as = (type: string, q: number) => new Promise<Blob | null>(res => c.toBlob(res, type, q));
  let blob = await as('image/webp', 0.84);
  if (!blob || blob.type !== 'image/webp') blob = await as('image/jpeg', 0.86);
  if (!blob) throw new Error('This picture could not be prepared.');
  return { blob, width, height };
}

/** Resizes (pictures) and uploads. kind: image | document. Returns { id, url, width, height }. */
export async function upload(file: File, { kind = 'image', section = '', maxSide = 1600 }: { kind?: 'image' | 'document'; section?: string; maxSide?: number } = {}) {
  if (file.size > MAX_BYTES) throw new Error(`"${file.name}" is larger than 5 MB. Please choose a smaller file.`);
  const form = new FormData();
  if (kind === 'image') {
    if (!IMG_TYPES.includes(file.type)) throw new Error('Only JPG, PNG or WebP pictures can be uploaded.');
    const r = await resize(file, maxSide);
    form.append('file', new File([r.blob], file.name.replace(/\.\w+$/, r.blob.type === 'image/webp' ? '.webp' : '.jpg'), { type: r.blob.type }));
    form.append('width', String(r.width)); form.append('height', String(r.height));
  } else {
    if (!['application/pdf', 'image/jpeg'].includes(file.type)) throw new Error('Only PDF or JPG files can be uploaded here.');
    form.append('file', file);
  }
  form.append('kind', kind); form.append('section', section);
  const d = await api('upload', { method: 'POST', body: form });
  return d.file as { id: string; url: string; width: number | null; height: number | null };
}

/** Lets the person pick a file (returns null if they cancel). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.addEventListener('change', () => res(i.files?.[0] || null), { once: true });
    i.click();
  });
}

// ── Safe HTML (the server cleans it again; this keeps the editor and preview safe) ──
const KEEP = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'A', 'IMG', 'FIGURE', 'FIGCAPTION']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'BASE', 'VIDEO', 'AUDIO', 'CANVAS', 'TITLE', 'HEAD']);
const SAFE_IMG = /^\/api\/media-file\/[a-z0-9_]{4,40}$|^\/images\/[\w/.-]{1,200}$/;
export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node: Node, out: Node) => {
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { out.appendChild(document.createTextNode(n.textContent || '')); return; }
      if (n.nodeType !== 1) return;
      const el = n as Element, tag = el.tagName.toUpperCase();
      if (DROP.has(tag)) return;
      if (!KEEP.has(tag)) { walk(el, out); if (['DIV', 'SECTION', 'ARTICLE', 'H1', 'H4', 'H5', 'H6'].includes(tag)) out.appendChild(document.createElement('br')); return; }
      const copy = document.createElement(tag.toLowerCase());
      if (tag === 'A') { const h = (el.getAttribute('href') || '').trim(); if (/^(https?:\/\/|mailto:|\/(?!\/))/i.test(h)) copy.setAttribute('href', h); }
      if (tag === 'IMG') { const s = (el.getAttribute('src') || '').trim(); if (!SAFE_IMG.test(s)) return; copy.setAttribute('src', s); copy.setAttribute('alt', (el.getAttribute('alt') || '').slice(0, 200)); }
      walk(el, copy); out.appendChild(copy);
    });
  };
  const box = document.createElement('div');
  walk(doc.body, box);
  return box.innerHTML;
}
export const plainText = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() || '';

/** "From library": choose an uploaded picture (resolves with { id, url } or null). */
export function pickFromLibrary(): Promise<{ id: string; url: string } | null> {
  return new Promise(async res => {
    const d = document.createElement('dialog');
    d.className = 'mc-lib';
    d.innerHTML = '<form method="dialog"><div class="mc-lib-head"><b>Choose from the library</b><input class="mc-input" placeholder="Search by file or album name" data-q /><button class="mc-btn mc-btn-o mc-btn-sm" value="">Close</button></div><div class="mc-lib-grid" data-grid><p class="mc-muted">Loading…</p></div></form>';
    document.body.append(d); d.showModal();
    const grid = d.querySelector('[data-grid]') as HTMLElement;
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    const draw = async (q = '') => {
      const { images } = await api(`library?q=${encodeURIComponent(q)}`);
      grid.innerHTML = images.length ? images.map((i: any) => `<button type="button" class="mc-lib-it" data-id="${esc(i.id)}" data-url="${esc(i.url)}"><img src="${esc(i.url)}" alt="" loading="lazy" /><small>${esc(i.album || i.name || '')}</small></button>`).join('') : '<p class="mc-muted">No pictures yet.</p>';
    };
    let t = 0;
    d.querySelector('[data-q]')!.addEventListener('input', e => { clearTimeout(t); t = window.setTimeout(() => draw((e.target as HTMLInputElement).value), 300); });
    grid.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]'); if (b) { res({ id: b.dataset.id!, url: b.dataset.url! }); d.close(); } });
    d.addEventListener('close', () => { d.remove(); res(null); });
    draw();
  });
}
