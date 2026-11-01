// Media Centre › Photo & Video Library: albums by match or event (captions,
// photographer credits, player tags, video links). An album appears in the
// public Gallery after a Super Admin approves it. Pictures can be reused in
// stories and newsletters ("Library" / "From library").
import { api, esc, register, go, toast } from './core';
import { listScreen, statusBanner, autosaver, workflowButtons } from './items';
import { upload, pickFromLibrary } from './files';
import { meta } from './news';

register({ path: 'library', label: 'Photo & Video Library', icon: '📷', async render(main, parts) {
  if (parts[0]) return editor(main, parts[0]);
  await listScreen(main, { kind: 'album', title: 'Photo & Video Library', newLabel: 'New album',
    intro: '<p class="mc-muted">Albums go into the website\'s <a href="/gallery/" target="_blank" rel="noopener">Gallery</a> once they are approved. Every picture you upload can also be used in stories and newsletters.</p>',
    newData: () => ({ date: new Date(Date.now() + 3600e3).toISOString().slice(0, 10), photos: [], videos: [] }) });
} });

async function editor(main: HTMLElement, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const [{ item, editable }, M] = await Promise.all([api(`items/${id}`), meta()]);
  const d: any = item.data || {}, ro = editable ? '' : 'disabled';
  let photos: any[] = Array.isArray(d.photos) ? [...d.photos] : [], videos: any[] = Array.isArray(d.videos) ? [...d.videos] : [];
  main.innerHTML = `<div class="mc-page-head"><h1>Album</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/library/" data-go="/library">← Library</a></div>
    ${statusBanner(item, editable)}
    <form class="mc-card" id="f">
      <div class="mc-field"><label for="title">Album title <span class="mc-req">*</span></label><input id="title" maxlength="120" value="${esc(d.title || '')}" ${ro} placeholder="e.g. Lobi Stars 2-1 Kada City" /></div>
      <div class="mc-grid two"><div class="mc-field"><label for="match">Match or event</label><select id="match" ${ro}><option value="">Not a match</option>${M.matches.map((m: any) => `<option value="${esc(m.id)}" ${d.eventId === m.id ? 'selected' : ''}>${esc(m.label)} · ${esc(m.day)}</option>`).join('')}</select></div>
      <div class="mc-field"><label for="date">Date</label><input id="date" type="date" value="${esc(d.date || '')}" ${ro} /></div></div>
      <div class="mc-field"><label for="credit">Photographer <small>(for the whole album; each photo can have its own)</small></label><input id="credit" maxlength="100" value="${esc(d.credit || '')}" ${ro} /></div>
      <div class="mc-field"><span class="mc-label">Photos <span class="mc-req">*</span></span><div id="photos"></div>${editable ? '<button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="add">Upload photos</button> <button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="lib">From library</button>' : ''}</div>
      <div class="mc-field"><span class="mc-label">Video links <small>(YouTube or Facebook)</small></span><div id="videos"></div>${editable ? '<button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="addV">Add a video link</button>' : ''}</div>
      <p class="mc-hint" id="saveState"></p><div id="wf"></div>
    </form>`;
  const $ = (s: string) => main.querySelector(s) as any;
  const playerOpts = (sel: string[]) => M.players.map((p: any) => `<option value="${esc(p.slug)}" ${sel.includes(p.slug) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const drawPhotos = () => { $('#photos').innerHTML = photos.length ? `<div class="mc-gal">${photos.map((p, i) => `<figure><img src="${esc(p.url)}" alt="" /><input data-i="${i}" data-f="caption" value="${esc(p.caption || '')}" placeholder="Caption *" maxlength="200" ${ro} /><input data-i="${i}" data-f="credit" value="${esc(p.credit || '')}" placeholder="Photographer" maxlength="100" ${ro} /><select multiple size="3" data-i="${i}" data-f="players" aria-label="Players in the photo" ${ro}>${playerOpts(p.players || [])}</select>${editable ? `<button type="button" data-del="${i}" aria-label="Remove">✕</button>` : ''}</figure>`).join('')}</div>` : '<p class="mc-muted mc-small">No photos yet.</p>'; };
  const drawVideos = () => { $('#videos').innerHTML = videos.map((v, i) => `<div class="mc-grid two"><input class="mc-input" data-v="${i}" data-f="url" value="${esc(v.url || '')}" placeholder="https://www.youtube.com/watch?v=…" ${ro} /><input class="mc-input" data-v="${i}" data-f="caption" value="${esc(v.caption || '')}" placeholder="Caption" ${ro} /></div>`).join(''); };
  drawPhotos(); drawVideos();
  const value = () => { const m = M.matches.find((x: any) => x.id === $('#match').value); return { title: $('#title').value, eventId: m?.id || '', eventLabel: m?.label || '', date: $('#date').value, credit: $('#credit').value, photos, videos }; };
  const saver = autosaver(async () => { await api(`items/${id}`, { method: 'PUT', body: { data: value() } }); }, $('#saveState'));
  const changed = () => { if (editable) saver.changed(); };
  $('#f').addEventListener('input', (e: Event) => {
    const t = e.target as any;
    if (t.dataset.i !== undefined) photos[Number(t.dataset.i)][t.dataset.f] = t.dataset.f === 'players' ? [...t.selectedOptions].map((o: any) => o.value) : t.value;
    if (t.dataset.v !== undefined) videos[Number(t.dataset.v)][t.dataset.f] = t.value;
    changed();
  });
  $('#f').addEventListener('change', (e: Event) => { const t = e.target as any; if (t.dataset.f === 'players') { photos[Number(t.dataset.i)].players = [...t.selectedOptions].map((o: any) => o.value); } changed(); });
  $('#photos').addEventListener('click', (e: Event) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-del]'); if (b) { photos.splice(Number(b.dataset.del), 1); drawPhotos(); changed(); } });
  $('#add')?.addEventListener('click', () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp'; i.multiple = true;
    i.addEventListener('change', async () => {
      const files = [...(i.files || [])].slice(0, 60 - photos.length);
      for (const [n, f] of files.entries()) { try { toast(`Uploading ${n + 1} of ${files.length}…`); const up = await upload(f, { section: 'library' }); photos.push({ url: up.url, id: up.id, caption: '', credit: '', players: [] }); drawPhotos(); changed(); } catch (err: any) { toast(err.message, 9000); } }
      toast('Photos added. Write a caption for each.');
    }, { once: true });
    i.click();
  });
  $('#lib')?.addEventListener('click', async () => { const p = await pickFromLibrary(); if (p) { photos.push({ ...p, caption: '', credit: '', players: [] }); drawPhotos(); changed(); } });
  $('#addV')?.addEventListener('click', () => { videos.push({ url: '', caption: '' }); drawVideos(); });
  const wf = workflowButtons(item, editable, { flush: () => saver.flush(), onDone: () => go('/library') });
  $('#wf').innerHTML = wf.html; wf.wire($('#wf'));
}
