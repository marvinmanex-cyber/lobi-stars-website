// Media Centre › Latest News: the list and the editor. The live preview on the
// right is a real article page of the website (the same template the public
// News page uses), with the story being written put into it, so what you see is
// what readers will see. Phone / desktop toggle; autosave.
import { api, esc, register, go, toast } from './core';
import { listScreen, statusBanner, autosaver, workflowButtons } from './items';
import { upload, pickFile, pickFromLibrary, cleanHtml, plainText } from './files';

let META: any = null;
export async function meta() { if (!META) META = await api('meta'); return META; }
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'story';
const localInput = (iso?: string | null) => iso ? new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 16) : '';
const fromLocal = (v: string) => v ? new Date(`${v}:00+01:00`).toISOString() : null;

register({ path: 'news', label: 'Latest News', icon: '📰', async render(main, parts) {
  if (parts[0]) return editor(main, parts[0]);
  await listScreen(main, { kind: 'news', title: 'Latest News', newLabel: 'New story',
    intro: '<p class="mc-muted">Write a story; a Super Admin approves it; it then appears on the website\'s News page, the homepage and any tagged player or match pages.</p>',
    newData: { category: 'First Team News' },
    row: i => `${esc(i.createdByName)} · ${i.status === 'scheduled' ? 'publishes ' : 'updated '}${new Date(i.status === 'scheduled' ? i.scheduledAt : i.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })}` });
} });

async function editor(main: HTMLElement, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const [{ item, editable }, M] = await Promise.all([api(`items/${id}`), meta()]);
  const d = item.data || {};
  const cats: string[] = M.categories.includes(d.category) || !d.category ? M.categories : [d.category, ...M.categories];
  const ro = editable ? '' : 'disabled';
  main.innerHTML = `<div class="mc-page-head"><h1>${item.status === 'published' ? 'Published story' : 'Story'}</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/news/" data-go="/news">← All stories</a></div>
  ${statusBanner(item, editable)}
  <div class="mc-ed">
    <form class="mc-ed-form" id="f" autocomplete="off" onsubmit="return false">
      <div class="mc-field"><label for="cat">Category</label><select id="cat" ${ro}>${cats.map(c => `<option ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="mc-field"><label for="headline">Headline</label><input id="headline" maxlength="150" value="${esc(d.headline || '')}" ${ro} placeholder="e.g. Lobi Stars edge Kada City in Makurdi" /><span class="mc-hint" id="hlCount"></span></div>
      <div class="mc-field"><label for="summary">Summary <small>(1–2 sentences: shown on news cards and when shared on WhatsApp/Facebook)</small></label><textarea id="summary" maxlength="320" rows="3" ${ro}>${esc(d.summary || '')}</textarea><span class="mc-hint" id="smCount"></span></div>
      <div class="mc-field"><span class="mc-label">Main photo</span><div class="mc-photo" id="coverBox"></div>${editable ? '<button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="coverBtn">Upload main photo</button> <button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="coverLib">From library</button>' : ''}<span class="mc-hint">JPG, PNG or WebP up to 5 MB. Resized automatically.</span></div>
      <div class="mc-grid two"><div class="mc-field"><label for="caption">Photo caption</label><input id="caption" maxlength="200" value="${esc(d.caption || '')}" ${ro} placeholder="Who or what is in the photo" /></div>
      <div class="mc-field"><label for="credit">Photo credit</label><input id="credit" maxlength="100" value="${esc(d.credit || '')}" ${ro} placeholder="e.g. Lobi Stars Media" /></div></div>
      <div class="mc-field"><span class="mc-label">Story</span>
        ${editable ? `<div class="mc-tb" role="toolbar" aria-label="Formatting"><button type="button" data-cmd="bold" aria-label="Bold"><b>B</b></button><button type="button" data-cmd="h2">H2</button><button type="button" data-cmd="h3">H3</button><button type="button" data-cmd="p">¶</button><button type="button" data-cmd="quote" aria-label="Quote">❝</button><button type="button" data-cmd="ul" aria-label="Bullet list">• List</button><button type="button" data-cmd="ol" aria-label="Numbered list">1. List</button><button type="button" data-cmd="link" aria-label="Link">🔗</button><button type="button" data-cmd="img" aria-label="Picture">🖼</button><button type="button" data-cmd="lib">Library</button></div>` : ''}
        <div class="mc-rte" id="body" contenteditable="${editable}" role="textbox" aria-multiline="true" aria-label="Story text">${cleanHtml(d.body || '') || '<p><br></p>'}</div><span class="mc-hint" id="wc"></span></div>
      <div class="mc-field"><span class="mc-label">Photo gallery <small>(optional)</small></span><div class="mc-gal" id="gal"></div>${editable ? '<button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="galBtn">Add photos</button>' : ''}</div>
      <div class="mc-field"><label for="video">Video link <small>(optional: YouTube or Facebook)</small></label><input id="video" type="url" value="${esc(d.video || '')}" ${ro} placeholder="https://www.youtube.com/watch?v=…" /></div>
      <details class="mc-field mc-tags" open><summary class="mc-label">Tags</summary>
        <label for="match">Match</label><select id="match" ${ro}><option value="">No match</option>${M.matches.map((m: any) => `<option value="${esc(m.id)}" ${d.match?.id === m.id ? 'selected' : ''}>${esc(m.label)} · ${esc(new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }))}</option>`).join('')}</select>
        <p class="mc-label" style="margin-top:12px">Players</p><input class="mc-input" id="pSearch" placeholder="Search players" ${ro} /><div class="mc-chips" id="players">${M.players.map((p: any) => `<label><input type="checkbox" value="${esc(p.slug)}" ${(d.players || []).includes(p.slug) ? 'checked' : ''} ${ro} /> ${p.number != null ? `#${esc(p.number)} ` : ''}${esc(p.name)}</label>`).join('') || '<span class="mc-muted">No live squad profiles yet.</span>'}</div>
        <p class="mc-label" style="margin-top:12px">Staff</p><div class="mc-chips" id="staff">${M.staff.map((s: any) => `<label><input type="checkbox" value="${esc(s.name)}" ${(d.staff || []).includes(s.name) ? 'checked' : ''} ${ro} /> ${esc(s.name)} <small>(${esc(s.role)})</small></label>`).join('') || '<span class="mc-muted">No coaching staff profiles yet.</span>'}</div>
      </details>
      <div class="mc-field"><label class="mc-check"><input type="checkbox" id="brk" ${d.breakingRequested ? 'checked' : ''} ${ro} /> Ask for <b>breaking news</b> (the red homepage banner). A Super Admin decides.</label>${d.breaking ? '<span class="mc-hint">A Super Admin switched breaking news on for this story.</span>' : ''}</div>
      <div class="mc-field"><span class="mc-label">When to publish</span>
        <label class="mc-check"><input type="radio" name="when" value="now" ${item.scheduledAt ? '' : 'checked'} ${ro} /> As soon as it is approved</label>
        <label class="mc-check"><input type="radio" name="when" value="later" ${item.scheduledAt ? 'checked' : ''} ${ro} /> At a date and time: <input type="datetime-local" id="at" value="${esc(localInput(item.scheduledAt))}" ${ro} /></label></div>
      <p class="mc-hint">Web address: <b id="slug"></b></p>
      <p class="mc-hint" id="saveState"></p>
      <div id="wf"></div>
    </form>
    <aside class="mc-pv"><div class="mc-pv-bar"><b>Live preview</b><div class="mc-tabs" style="margin:0"><button type="button" data-pv="phone" class="on">Phone</button><button type="button" data-pv="desktop">Desktop</button></div></div><div class="mc-pv-frame phone" id="pvWrap"><iframe id="pv" title="Preview of the story on the website"></iframe></div><p class="mc-hint">The same page design readers see. Links don't open in the preview.</p></aside>
  </div>`;

  const $ = (s: string) => main.querySelector(s) as any;
  let cover = d.cover || null, gallery: any[] = Array.isArray(d.gallery) ? [...d.gallery] : [];
  const drawCover = () => { $('#coverBox').innerHTML = cover ? `<img src="${esc(cover.url)}" alt="" />${editable ? '<button type="button" class="mc-btn mc-btn-o mc-btn-sm" id="coverDel">Remove</button>' : ''}` : '<p class="mc-muted mc-small">No photo yet.</p>'; $('#coverDel')?.addEventListener('click', () => { cover = null; drawCover(); changed(); }); };
  const drawGal = () => {
    $('#gal').innerHTML = gallery.map((g, i) => `<figure><img src="${esc(g.url)}" alt="" /><input value="${esc(g.caption || '')}" data-gi="${i}" maxlength="200" placeholder="Caption" ${ro} />${editable ? `<button type="button" data-gdel="${i}" aria-label="Remove photo">✕</button>` : ''}</figure>`).join('');
  };
  drawCover(); drawGal();
  const value = () => ({
    category: $('#cat').value, headline: $('#headline').value, summary: $('#summary').value, cover, caption: $('#caption').value, credit: $('#credit').value,
    body: cleanHtml($('#body').innerHTML), gallery, video: $('#video').value.trim(),
    players: [...main.querySelectorAll<HTMLInputElement>('#players input:checked')].map(x => x.value),
    staff: [...main.querySelectorAll<HTMLInputElement>('#staff input:checked')].map(x => x.value),
    match: (() => { const m = M.matches.find((x: any) => x.id === $('#match').value); return m ? { id: m.id, date: m.day, label: m.label } : null; })(),
    breakingRequested: $('#brk').checked, breaking: !!d.breaking,
  });
  const counts = () => {
    const n = $('#headline').value.length, s = $('#summary').value.length, w = plainText($('#body').innerHTML).split(/\s+/).filter(Boolean).length;
    $('#hlCount').textContent = `${n} characters${n > 70 ? ' · over 70: it may be cut short in Google and on phones' : ''}`; $('#hlCount').classList.toggle('warn', n > 70);
    $('#smCount').textContent = `${s} / 320`;
    $('#wc').textContent = `${w} words · about ${Math.max(1, Math.round(w / 220))} min read`;
    $('#slug').textContent = item.slug ? `/news/${item.slug}/` : `/news/${new Date(Date.now() + 3600e3).toISOString().slice(0, 10)}-${slugify($('#headline').value || 'story')}/ (set when it is first published)`;
  };
  const saver = autosaver(async () => { await api(`items/${id}`, { method: 'PUT', body: { data: value() } }); }, $('#saveState'));
  const changed = () => { if (!editable) return; counts(); saver.changed(); schedulePreview(); };

  // ── Live preview: a real article page with this story put into it ──
  let pvReady = false, pvT = 0;
  const frame = $('#pv') as HTMLIFrameElement;
  frame.src = '/news/mc-preview-template/';
  frame.addEventListener('load', () => {
    pvReady = true;
    const doc = frame.contentDocument; if (!doc) return;
    doc.addEventListener('click', e => { if ((e.target as HTMLElement).closest('a,button')) e.preventDefault(); }, true);
    const st = doc.createElement('style'); st.textContent = '.art-share,.art-players,#nextFixture,.art-related,.nl-cta,.wa-channel,#cookieBanner,.cc{display:none!important}'; doc.head.append(st);
    drawPreview();
  });
  const schedulePreview = () => { clearTimeout(pvT); pvT = window.setTimeout(drawPreview, 400); };
  function drawPreview() {
    if (!pvReady) return;
    const doc = frame.contentDocument; if (!doc) return;
    const v = value(), set = (sel: string, f: (el: any) => void) => doc.querySelectorAll(sel).forEach(f);
    set('.art-cat', el => { el.textContent = v.category; });
    set('.art-title', el => { el.textContent = v.headline || 'Your headline'; });
    set('.art-lead', el => { el.textContent = v.summary || 'Your summary.'; });
    set('.art-cover img', el => { if (v.cover) el.src = v.cover.url; el.alt = v.caption; });
    let cap = doc.querySelector('.art-caption') as HTMLElement | null;
    if (!cap) { cap = doc.createElement('p'); cap.className = 'art-caption'; cap.style.cssText = 'margin:6px 0 0;padding:0 4px;font-size:13px;color:#5B6472'; doc.querySelector('.art-media')?.append(cap); }
    cap.textContent = [v.caption, v.credit ? `Photo: ${v.credit}` : ''].filter(Boolean).join(' ');
    set('.art-body', el => {
      const gal = v.gallery.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:20px">${v.gallery.map((g: any) => `<figure style="margin:0"><img src="${esc(g.url)}" alt="" style="width:100%;border-radius:8px"><figcaption style="font-size:13px">${esc(g.caption || '')}</figcaption></figure>`).join('')}</div>` : '';
      el.innerHTML = (v.body || '<p>Your story…</p>') + gal;
    });
    set('.art-author', el => { el.textContent = 'By Lobi Stars FC'; });
  }
  main.querySelectorAll<HTMLButtonElement>('[data-pv]').forEach(b => b.addEventListener('click', () => {
    main.querySelectorAll('[data-pv]').forEach(x => x.classList.toggle('on', x === b));
    $('#pvWrap').className = `mc-pv-frame ${b.dataset.pv}`;
    fitPreview();
  }));
  // Desktop view: the page drawn 1280 px wide, scaled down to fit.
  const fitPreview = () => { const w = $('#pvWrap'); if (w) w.style.setProperty('--pv-scale', String(Math.min(1, w.clientWidth / 1280))); };
  window.addEventListener('resize', fitPreview);

  // ── Editing ──
  main.querySelector('#f')!.addEventListener('input', e => { if ((e.target as HTMLElement).id === 'pSearch') return; changed(); });
  main.querySelector('#f')!.addEventListener('change', changed);
  $('#pSearch')?.addEventListener('input', () => { const q = $('#pSearch').value.toLowerCase(); main.querySelectorAll<HTMLElement>('#players label').forEach(l => { l.hidden = !!q && !l.textContent!.toLowerCase().includes(q); }); });
  const rte = $('#body') as HTMLElement;
  rte.addEventListener('paste', e => {
    e.preventDefault();
    const html = e.clipboardData?.getData('text/html'), text = e.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertHTML', false, html ? cleanHtml(html) : esc(text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>'));
  });
  main.querySelector('.mc-tb')?.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]'); if (!b) return;
    rte.focus();
    const c = b.dataset.cmd!;
    if (c === 'bold') document.execCommand('bold');
    if (c === 'h2' || c === 'h3' || c === 'p') document.execCommand('formatBlock', false, c);
    if (c === 'quote') document.execCommand('formatBlock', false, 'blockquote');
    if (c === 'ul') document.execCommand('insertUnorderedList');
    if (c === 'ol') document.execCommand('insertOrderedList');
    if (c === 'link') { const u = prompt('Link address (https://…)'); if (u && /^(https?:\/\/|mailto:|\/)/i.test(u.trim())) document.execCommand('createLink', false, u.trim()); else if (u) toast('Links must start with https://'); }
    if (c === 'lib') { const p = await pickFromLibrary(); if (p) { rte.focus(); document.execCommand('insertHTML', false, `<img src="${esc(p.url)}" alt="">`); } }
    if (c === 'img') {
      const f = await pickFile('image/jpeg,image/png,image/webp'); if (!f) return;
      try { toast('Uploading the picture…'); const up = await upload(f, { section: 'news' }); rte.focus(); document.execCommand('insertHTML', false, `<img src="${esc(up.url)}" alt="">`); toast('Picture added.'); } catch (err: any) { toast(err.message, 9000); }
    }
    changed();
  });
  $('#coverBtn')?.addEventListener('click', async () => {
    const f = await pickFile('image/jpeg,image/png,image/webp'); if (!f) return;
    try { toast('Uploading the photo…'); const up = await upload(f, { section: 'news' }); cover = { url: up.url, id: up.id }; drawCover(); changed(); toast('Photo added.'); } catch (err: any) { toast(err.message, 9000); }
  });
  $('#coverLib')?.addEventListener('click', async () => { const p = await pickFromLibrary(); if (p) { cover = p; drawCover(); changed(); } });
  $('#galBtn')?.addEventListener('click', async () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp'; i.multiple = true;
    i.addEventListener('change', async () => {
      for (const f of [...(i.files || [])].slice(0, 24 - gallery.length)) {
        try { const up = await upload(f, { section: 'news' }); gallery.push({ url: up.url, id: up.id, caption: '' }); drawGal(); changed(); } catch (err: any) { toast(err.message, 9000); }
      }
    }, { once: true });
    i.click();
  });
  $('#gal').addEventListener('input', (e: Event) => { const t = e.target as HTMLInputElement; if (t.dataset.gi) { gallery[Number(t.dataset.gi)].caption = t.value; changed(); } });
  $('#gal').addEventListener('click', (e: Event) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-gdel]'); if (b) { gallery.splice(Number(b.dataset.gdel), 1); drawGal(); changed(); } });

  const wf = workflowButtons(item, editable, {
    flush: () => saver.flush(),
    schedule: () => { const later = (main.querySelector('input[name=when]:checked') as HTMLInputElement)?.value === 'later'; return later ? fromLocal($('#at').value) : null; },
    onDone: () => go('/news'),
  });
  $('#wf').innerHTML = wf.html; wf.wire($('#wf'));
  counts();
}
