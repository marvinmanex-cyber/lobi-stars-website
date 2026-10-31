// Media Centre: a small rich-text box (bold, H2, H3, quote, lists, link,
// picture from upload or the library). Pasted text is cleaned.
import { esc, toast } from './core';
import { upload, pickFile, pickFromLibrary, cleanHtml } from './files';

export function rteHtml(id: string, html: string, editable: boolean) {
  return `${editable ? `<div class="mc-tb" role="toolbar" aria-label="Formatting" data-tb="${id}"><button type="button" data-cmd="bold" aria-label="Bold"><b>B</b></button><button type="button" data-cmd="h2">H2</button><button type="button" data-cmd="h3">H3</button><button type="button" data-cmd="p">¶</button><button type="button" data-cmd="quote" aria-label="Quote">❝</button><button type="button" data-cmd="ul">• List</button><button type="button" data-cmd="ol">1. List</button><button type="button" data-cmd="link" aria-label="Link">🔗</button><button type="button" data-cmd="img" aria-label="Upload a picture">🖼</button><button type="button" data-cmd="lib">Library</button></div>` : ''}
    <div class="mc-rte" id="${id}" contenteditable="${editable}" role="textbox" aria-multiline="true">${cleanHtml(html || '') || '<p><br></p>'}</div>`;
}
export function wireRte(root: HTMLElement, id: string, onChange: () => void, section = '') {
  const box = root.querySelector<HTMLElement>(`#${id}`)!;
  box.addEventListener('input', onChange);
  box.addEventListener('paste', e => {
    e.preventDefault();
    const html = e.clipboardData?.getData('text/html'), text = e.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertHTML', false, html ? cleanHtml(html) : esc(text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>'));
  });
  root.querySelector(`[data-tb="${id}"]`)?.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]'); if (!b) return;
    box.focus();
    const c = b.dataset.cmd!;
    if (c === 'bold') document.execCommand('bold');
    if (c === 'h2' || c === 'h3' || c === 'p') document.execCommand('formatBlock', false, c);
    if (c === 'quote') document.execCommand('formatBlock', false, 'blockquote');
    if (c === 'ul') document.execCommand('insertUnorderedList');
    if (c === 'ol') document.execCommand('insertOrderedList');
    if (c === 'link') { const u = prompt('Link address (https://…)'); if (u && /^(https?:\/\/|mailto:|\/)/i.test(u.trim())) document.execCommand('createLink', false, u.trim()); else if (u) toast('Links must start with https://'); }
    if (c === 'img' || c === 'lib') {
      let pic: { url: string } | null = null;
      if (c === 'lib') pic = await pickFromLibrary();
      else { const f = await pickFile('image/jpeg,image/png,image/webp'); if (f) { try { toast('Uploading…'); pic = await upload(f, { section }); } catch (err: any) { toast(err.message, 9000); } } }
      if (pic) { box.focus(); document.execCommand('insertHTML', false, `<img src="${esc(pic.url)}" alt="">`); }
    }
    onChange();
  });
  return () => cleanHtml(box.innerHTML);
}
