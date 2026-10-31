// Rich text from the Media Centre editor, made safe with Cloudflare's HTML
// parser (HTMLRewriter): only the tags the editor makes are kept, every
// attribute is removed except a link's address (http, https, mailto or a page
// on this site) and a picture's source (an uploaded Media Centre picture or a
// site image) and description. Scripts, styles, frames, forms, event handlers
// (onerror, onclick...) and comments are removed.
const KEEP = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math', 'template', 'noscript', 'link', 'meta', 'base', 'frame', 'frameset', 'video', 'audio', 'canvas', 'title', 'head', 'xmp', 'plaintext', 'noembed', 'applet']);
export const SAFE_IMG = /^\/api\/media-file\/[a-z0-9_]{4,40}$|^\/images\/[\w/.-]{1,200}$/;

export async function sanitizeHtml(html, { max = 80000 } = {}) {
  const input = String(html || '').slice(0, max * 2);
  if (!input.trim()) return '';
  const rw = new HTMLRewriter()
    .on('*', { element(el) {
      const t = el.tagName.toLowerCase();
      if (DROP.has(t)) { el.remove(); return; }
      if (!KEEP.has(t)) { el.removeAndKeepContent(); return; }
      const keep = {};
      if (t === 'a') {
        const h = (el.getAttribute('href') || '').trim();
        if (/^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/i.test(h)) keep.href = h.slice(0, 500);
      }
      if (t === 'img') {
        const s = (el.getAttribute('src') || '').trim();
        if (!SAFE_IMG.test(s)) { el.remove(); return; }
        keep.src = s; keep.alt = (el.getAttribute('alt') || '').replace(/[<>"]/g, '').slice(0, 200);
      }
      for (const [name] of [...el.attributes]) el.removeAttribute(name);
      for (const [k, v] of Object.entries(keep)) el.setAttribute(k, v);
      if (t === 'a' && /^https?:/i.test(keep.href || '')) el.setAttribute('rel', 'noopener nofollow');
    } })
    .onDocument({ comments(c) { c.remove(); } });
  const out = await rw.transform(new Response(input, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })).text();
  // No blank lines (the story is stored in a Markdown file, where a blank line would end the HTML block).
  return out.replace(/\r\n?/g, '\n').replace(/\n\s*\n+/g, '\n').trim().slice(0, max);
}
/** Plain text from HTML (word counts, previews). */
export const textOf = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
