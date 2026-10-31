// Media Centre › Press Kit: the entries on the public /media/press-kit page
// (badge, colours, how to write the club name, squad photo, headshots, fact
// sheet, media contact, media rules). Each entry is approved by a Super Admin.
import { api, esc, register, go, toast } from './core';
import { listScreen, statusBanner, autosaver, workflowButtons } from './items';
import { upload, pickFile, pickFromLibrary } from './files';

const SECTIONS: Record<string, string> = { badge: 'Club badge', colours: 'Club colours', name: 'How to write the club name', squad: 'Squad photo', headshots: 'Player headshots', facts: 'Fact sheet', contact: 'Media contact', rules: 'Media rules', other: 'Other' };
register({ path: 'press-kit', label: 'Press Kit', icon: '🗂️', async render(main, parts) {
  if (parts[0]) return editor(main, parts[0]);
  await listScreen(main, { kind: 'presskit', title: 'Press Kit', newLabel: 'New press kit item',
    intro: '<p class="mc-muted">What journalists download from <a href="/media/press-kit/" target="_blank" rel="noopener">lobistarsfc.com/media/press-kit</a>. Each item appears after a Super Admin approves it.</p>', newData: { section: 'badge' } });
} });

async function editor(main: HTMLElement, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const { item, editable } = await api(`items/${id}`);
  const d: any = item.data || {}, ro = editable ? '' : 'disabled';
  let files: any[] = Array.isArray(d.files) ? [...d.files] : [];
  main.innerHTML = `<div class="mc-page-head"><h1>Press kit item</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/press-kit/" data-go="/press-kit">← Press Kit</a></div>
    ${statusBanner(item, editable)}
    <form class="mc-card" id="f">
      <div class="mc-field"><label for="section">Section</label><select id="section" ${ro}>${Object.entries(SECTIONS).map(([k, l]) => `<option value="${k}" ${d.section === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="mc-field"><label for="title">Title <span class="mc-req">*</span></label><input id="title" maxlength="120" value="${esc(d.title || '')}" ${ro} placeholder="e.g. Club badge (full colour, PNG)" /></div>
      <div class="mc-field"><label for="text">Text <small>(e.g. the colour codes, how to write "Lobi Stars FC", the rules)</small></label><textarea id="text" rows="6" maxlength="3000" ${ro}>${esc(d.text || '')}</textarea></div>
      <div class="mc-field"><span class="mc-label">Files</span><ul class="mc-list" id="files"></ul>${editable ? '<button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="addImg">Upload a picture</button> <button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="addLib">From library</button> <button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="addDoc">Upload a PDF</button>' : ''}<span class="mc-hint">Pictures: JPG, PNG or WebP. Documents: PDF. Up to 5 MB each.</span></div>
      <p class="mc-hint" id="saveState"></p><div id="wf"></div>
    </form>`;
  const $ = (s: string) => main.querySelector(s) as any;
  const draw = () => { $('#files').innerHTML = files.map((f, i) => `<li>${f.kind === 'image' ? `<img src="${esc(f.url)}" alt="" style="height:48px;border-radius:6px" />` : '📄'}<input class="mc-input" style="flex:1 1 200px" data-i="${i}" value="${esc(f.label || '')}" placeholder="Label, e.g. Badge (PNG, 1200 px)" ${ro} />${editable ? `<button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-del="${i}">Remove</button>` : ''}</li>`).join('') || '<li class="mc-empty">No files.</li>'; };
  draw();
  const value = () => ({ section: $('#section').value, title: $('#title').value, text: $('#text').value, files });
  const saver = autosaver(async () => { await api(`items/${id}`, { method: 'PUT', body: { data: value() } }); }, $('#saveState'));
  const changed = () => { if (editable) saver.changed(); };
  $('#f').addEventListener('input', (e: Event) => { const t = e.target as any; if (t.dataset.i !== undefined) files[Number(t.dataset.i)].label = t.value; changed(); });
  $('#f').addEventListener('change', changed);
  $('#files').addEventListener('click', (e: Event) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-del]'); if (b) { files.splice(Number(b.dataset.del), 1); draw(); changed(); } });
  const add = async (kind: 'image' | 'document') => {
    const f = await pickFile(kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'application/pdf'); if (!f) return;
    try { toast('Uploading…'); const up = await upload(f, { kind, section: 'presskit', maxSide: 2400 }); files.push({ url: up.url, id: up.id, label: f.name.replace(/\.\w+$/, ''), kind }); draw(); changed(); } catch (err: any) { toast(err.message, 9000); }
  };
  $('#addImg')?.addEventListener('click', () => add('image'));
  $('#addDoc')?.addEventListener('click', () => add('document'));
  $('#addLib')?.addEventListener('click', async () => { const p = await pickFromLibrary(); if (p) { files.push({ ...p, label: '', kind: 'image' }); draw(); changed(); } });
  const wf = workflowButtons(item, editable, { flush: () => saver.flush(), onDone: () => go('/press-kit') });
  $('#wf').innerHTML = wf.html; wf.wire($('#wf'));
}
