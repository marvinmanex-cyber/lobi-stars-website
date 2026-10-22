// Squad & Staff Data Portal: the profile form (Screen 3). Every answer saves on
// its own: text after a short pause (~0.8 s), choices, ticks, rows, photos and
// recordings straight away. Each change is written to this device first
// (offline.ts) and sent in order; the status pill shows "All changes saved",
// "Saving…" or "Offline · saved on this device". If someone else changes the
// same profile, their answer is shown with "updated by … just now".
import { FIELDS, FIELD, SECTIONS, STATUSES, NOTE_MAX, labelOf, activeFields, missingForSubmit, isMinor, ageOn } from '../../lib/squadFields.js';
import { api, state, $, esc, toast, lagos, ApiError } from './api';
import { queueAdd, flush, queueCount, keepProfile, keptProfile, uploadKeep, uploadsAll, uploadDone, uploadsCount, type Change } from './offline';
import { processPhoto, Recorder } from './media';
import { showHome } from './home';

const USE: Record<string, [string, string]> = { public: ['Public', 'pub'], media: ['Media', 'med'], private: ['Private', 'prv'] };
const BADGE: Record<string, string> = { DRAFT: 'amber', SUBMITTED: 'blue', VERIFIED: 'green', CHANGES_REQUESTED: 'red', LEFT_THE_CLUB: 'grey' };
type P = { id: string; type: 'player' | 'staff'; status: string; season: string; data: Record<string, any>; photos: any; audio: any; editable: boolean; name: string; fileBase: string; reviewNote?: string; reviewBy?: string };
let P: P | null = null;
let lastSync = '', pollTimer = 0, retryTimer = 0, sending = false, pendingText = new Map<string, number>(), dirty = false;

// ── Save status ──
function pill(state: 'saved' | 'saving' | 'offline' | 'error', text?: string) {
  const el = document.getElementById('savePill'); if (!el) return;
  el.className = `sp-pill ${state}`;
  el.innerHTML = `<span class="dot" aria-hidden="true"></span>${esc(text || { saved: 'All changes saved', saving: 'Saving…', offline: 'Offline · saved on this device', error: 'Not saved yet · kept on this device' }[state])}`;
  const bar = document.getElementById('barStatus'); if (bar) bar.textContent = el.textContent || '';
}
async function refreshPill() {
  const waiting = (await queueCount()) + (await uploadsCount()) + pendingText.size;
  dirty = waiting > 0;
  if (!waiting) pill('saved'); else pill(navigator.onLine ? 'saving' : 'offline');
}

// ── Sending ──
async function send(c: Change): Promise<'ok' | 'retry' | 'drop'> {
  try {
    const r = await api(`profiles/${c.id}`, { method: 'PATCH', body: { changes: c.changes, commit: c.commit, type: c.type, since: lastSync } });
    if (P && P.id === c.id) {
      lastSync = r.updatedAt;
      P.fileBase = r.fileBase;
      for (const [k, msg] of Object.entries(r.errors || {})) showError(k, String(msg));
      for (const k of Object.keys(r.saved || {})) clearError(k);
      applyOthers(r.others || []);
      checks(r);
      document.querySelectorAll('[data-filename]').forEach(el => updateFileName(el as HTMLElement));
    }
    return 'ok';
  } catch (e) {
    if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
      if (e.status !== 401) toast(e.message);
      return e.status === 401 ? 'retry' : 'drop';
    }
    return 'retry';
  }
}
async function sendUploads() {
  for (const u of await uploadsAll()) {
    const form = new FormData();
    for (const [k, v] of Object.entries(u.fields)) { if (v instanceof Blob) form.append(k, v, k); else form.append(k, String(v)); }
    try {
      const r = await api(`profiles/${u.id}/${u.what}`, { method: 'POST', form });
      await uploadDone(u.key);
      if (P && P.id === u.id) {
        if (u.what === 'photo') { P.photos[String(u.fields.kind)] = r.photo; renderPhoto(String(u.fields.kind)); }
        else { P.audio = r.audio; }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) { await uploadDone(u.key); toast(e.message); }
      else return;
    }
  }
}
async function pump() {
  if (sending) return;
  sending = true;
  try { await flush(send); await sendUploads(); } finally { sending = false; refreshPill(); }
  clearTimeout(retryTimer);
  if ((await queueCount()) + (await uploadsCount())) retryTimer = window.setTimeout(pump, 15000);
}
async function save(changes: Record<string, unknown>, commit: boolean, type?: string) {
  if (!P || !P.editable) return;
  Object.assign(P.data, changes);
  if (type) P.type = type as P['type'];
  await queueAdd({ id: P.id, changes, commit, type, at: Date.now() });
  keepProfile(P);
  pill(navigator.onLine ? 'saving' : 'offline');
  pump();
}

// ── Field values ──
function readField(key: string): unknown {
  const f = FIELD[key];
  const root = document.querySelector(`[data-field="${key}"]`) as HTMLElement | null;
  if (!root) return undefined;
  if (f.type === 'checkbox') return (root.querySelector('input') as HTMLInputElement).checked;
  if (f.type === 'multiselect') return [...root.querySelectorAll<HTMLInputElement>('input:checked')].map(i => i.value);
  if (f.type === 'rows') return [...root.querySelectorAll('.sp-row')].map(r => Object.fromEntries([...r.querySelectorAll<HTMLInputElement>('[data-col]')].map(i => [i.dataset.col, i.value])));
  const el = root.querySelector('input, select, textarea') as HTMLInputElement;
  if (f.type === 'number') return el.value === '' ? null : Number(el.value);
  return el.value;
}
function writeField(key: string, v: any) {
  const f = FIELD[key];
  const root = document.querySelector(`[data-field="${key}"]`) as HTMLElement | null;
  if (!root) return;
  if (f.type === 'checkbox') { (root.querySelector('input') as HTMLInputElement).checked = !!v; return; }
  if (f.type === 'multiselect') { root.querySelectorAll<HTMLInputElement>('input').forEach(i => { i.checked = (v || []).includes(i.value); }); return; }
  if (f.type === 'rows') { (root.querySelector('.sp-rows') as HTMLElement).innerHTML = (v || []).map((r: any) => rowHtml(f, r)).join(''); return; }
  const el = root.querySelector('input, select, textarea') as HTMLInputElement;
  el.value = v == null ? '' : f.type === 'tel' ? localPhone(v) : String(v);
  if (f.type === 'textarea') counter(root);
}
const localPhone = (v: string) => { const d = String(v || '').replace(/^\+234/, '0'); return /^0\d{10}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : String(v || ''); };
function counter(root: HTMLElement) {
  const t = root.querySelector('textarea') as HTMLTextAreaElement | null, c = root.querySelector('.sp-count');
  if (t && c) c.textContent = `${t.value.length} / ${t.maxLength}`;
}
function showError(key: string, msg: string) {
  const root = document.querySelector(`[data-field="${key}"]`); if (!root) return;
  root.classList.add('sp-invalid');
  let e = root.querySelector('.sp-err') as HTMLElement | null;
  if (!e) { e = document.createElement('p'); e.className = 'sp-err'; e.setAttribute('role', 'alert'); root.append(e); }
  e.textContent = msg;
}
function clearError(key: string) {
  const root = document.querySelector(`[data-field="${key}"]`); if (!root) return;
  root.classList.remove('sp-invalid', 'sp-missing');
  root.querySelector('.sp-err')?.remove();
}

/** Someone else saved these fields since we last heard: show their answer (unless the person is typing in it). */
function applyOthers(others: { key: string; value: any; by: string }[]) {
  const fresh = others.filter(o => !pendingText.has(o.key));
  if (!fresh.length || !P) return;
  const active = document.activeElement?.closest('[data-field]')?.getAttribute('data-field');
  for (const o of fresh) { P.data[o.key] = o.value; if (o.key !== active) writeField(o.key, o.value); }
  toast(`This profile was updated by ${fresh[0].by} just now.`);
  visibility();
}
function checks(r: any) {
  const warn = document.getElementById('shirtWarn');
  if (warn) { warn.hidden = !r.shirtTaken; if (r.shirtTaken) warn.textContent = `Number ${P?.data.shirtNumber} is already assigned to ${r.shirtTaken.display_name || 'another player'} this season. You can keep the draft, but it cannot be submitted with this number.`; }
  const dup = document.getElementById('dupWarn');
  if (dup) {
    dup.hidden = !r.samePerson;
    if (r.samePerson) dup.innerHTML = `<b>A profile for this person may already exist:</b> ${esc(r.samePerson.display_name || 'unnamed')} (${esc(r.samePerson.season)}, ${esc(STATUSES[r.samePerson.status] || r.samePerson.status)}). <button type="button" class="sp-link" data-goto="${esc(r.samePerson.id)}">Open it</button>`;
  }
}

// ── Rendering ──
function chip(use: string, f?: any) { const [l, c] = USE[use]; return `<span class="sp-use ${c}">${f?.publicAs === 'age' ? 'Public: age only' : l}</span>`; }
function rowHtml(f: any, r: any = {}) {
  return `<div class="sp-row" draggable="true">
    <span class="sp-drag" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
    ${f.columns.map((c: any) => `<label class="sp-cell"><span>${esc(c.label)}</span><input data-col="${c.key}" ${c.type === 'year' ? 'inputmode="numeric" maxlength="4" pattern="[0-9]{4}"' : `maxlength="${c.max || 80}"`} placeholder="${esc(c.placeholder || '')}" value="${esc(r[c.key] ?? '')}" /></label>`).join('')}
    <span class="sp-row-btns"><button type="button" class="sp-mini" data-move="-1" aria-label="Move up">↑</button><button type="button" class="sp-mini" data-move="1" aria-label="Move down">↓</button><button type="button" class="sp-mini sp-danger" data-remove aria-label="Remove this row">×</button></span>
  </div>`;
}
function fieldHtml(f: any, type: string) {
  const id = `f_${f.key}`, label = labelOf(f, type), req = f.required ? '<span class="sp-req" aria-hidden="true">*</span>' : '';
  const ph = typeof f.placeholder === 'object' ? (f.placeholder[type] || '') : (f.placeholder || '');
  const hint = f.hint ? `<p class="sp-hint" id="${id}_h">${esc(f.hint)}</p>` : '';
  const desc = f.hint ? `aria-describedby="${id}_h"` : '';
  const head = `<div class="sp-flabel"><label for="${id}">${esc(label)}${req}${f.optional ? ' <span class="sp-opt">(optional)</span>' : ''}</label>${chip(f.use, f)}</div>`;
  const reqA = f.required ? 'aria-required="true"' : '';
  let input = '';
  switch (f.type) {
    case 'select': input = `<select id="${id}" ${reqA} ${desc}><option value="">Choose…</option>${f.options.map((o: string) => `<option>${esc(o)}</option>`).join('')}</select>`; break;
    case 'multiselect': return `<fieldset class="sp-field" data-field="${f.key}" data-for="${f.for}"><legend class="sp-flabel"><span>${esc(label)}${f.optional ? ' <span class="sp-opt">(optional)</span>' : ''}</span>${chip(f.use)}</legend><div class="sp-checks">${f.options.map((o: string) => `<label class="sp-check"><input type="checkbox" value="${esc(o)}" /> ${esc(o)}</label>`).join('')}</div></fieldset>`;
    case 'textarea': input = `<textarea id="${id}" rows="3" maxlength="${f.max}" placeholder="${esc(ph)}" ${reqA} ${desc}></textarea><p class="sp-count" aria-live="polite"></p>`; break;
    case 'checkbox': return `<div class="sp-field sp-confirm" data-field="${f.key}" data-for="${f.for}" ${f.minorOnly ? 'data-minor' : ''}><label class="sp-check sp-check-lg"><input type="checkbox" id="${id}" ${reqA} /> <span>${esc(label)}${req}</span></label></div>`;
    case 'rows': return `<div class="sp-field" data-field="${f.key}" data-for="${f.for}"><div class="sp-flabel"><span class="sp-label">${esc(label)}</span>${chip(f.use)}</div><p class="sp-hint">Most recent first.</p><div class="sp-rows"></div><button type="button" class="sp-btn sp-btn-outline sp-add-row" data-addrow>+ Add another</button></div>`;
    case 'number': input = `<input id="${id}" type="number" inputmode="numeric" min="${f.min}" max="${f.max}" ${reqA} ${desc} />`; break;
    case 'tel': input = `<input id="${id}" type="tel" inputmode="tel" autocomplete="off" placeholder="${esc(ph)}" ${reqA} ${desc} />`; break;
    case 'date': input = `<input id="${id}" type="date" max="${new Date().toISOString().slice(0, 10)}" ${reqA} ${desc} />`; break;
    case 'month': input = `<input id="${id}" type="month" ${reqA} ${desc} />`; break;
    case 'email': input = `<input id="${id}" type="email" inputmode="email" autocomplete="off" ${reqA} ${desc} />`; break;
    default: input = `<input id="${id}" type="text" maxlength="${f.max || 120}" placeholder="${esc(ph)}" autocomplete="off" ${reqA} ${desc} />`;
  }
  const extra = f.key === 'shirtNumber' ? '<p class="sp-warn" id="shirtWarn" role="status" hidden></p>' : f.key === 'pronunciation' ? audioHtml() : '';
  return `<div class="sp-field" data-field="${f.key}" data-for="${f.for}" ${f.showIf ? `data-showif='${esc(JSON.stringify(f.showIf))}'` : ''} ${f.minorOnly ? 'data-minor' : ''}>${head}${input}${hint}${extra}</div>`;
}
function audioHtml() {
  return `<div class="sp-audio" id="audioBox"><span class="sp-label">Record pronunciation (optional)</span>
    <div class="sp-audio-row"><button type="button" class="sp-btn sp-btn-outline" id="recBtn">● Record (up to 10 seconds)</button><span id="recState" class="sp-hint"></span></div>
    <div id="recPlayer"></div></div>`;
}
function photoHtml(kind: 'profile' | 'action', type: string) {
  return `<div class="sp-photo" data-photo="${kind}" ${kind === 'action' ? 'data-for="player"' : ''}>
    <div class="sp-flabel"><span class="sp-label">${kind === 'profile' ? 'Profile photo<span class="sp-req" aria-hidden="true">*</span>' : 'Action photo <span class="sp-opt">(optional)</span>'}</span>${chip('public')}</div>
    <div class="sp-photo-box"><div class="sp-photo-prev" id="prev_${kind}"><span>No photo yet</span></div>
      <div class="sp-photo-btns">
        <label class="sp-btn sp-btn-dark"><input type="file" accept="image/*" capture="${kind === 'profile' ? 'user' : 'environment'}" data-pick="${kind}" hidden />Take photo</label>
        <label class="sp-btn sp-btn-outline"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" data-pick="${kind}" hidden />Choose file</label>
        <button type="button" class="sp-link sp-danger" data-delphoto="${kind}" hidden>Remove photo</button>
        <p class="sp-hint">JPG, PNG, WebP or HEIC, up to 10 MB.</p>
        <p class="sp-filename" data-filename="${kind}"></p><ul class="sp-qwarn" id="warn_${kind}"></ul>
      </div></div></div>`;
}

export async function openForm(id: string) {
  let p: any = null, extra: any = {};
  try { const r = await api(`profiles/${id}`); p = r.profile; extra = r; }
  catch (e) {
    p = await keptProfile(id);
    if (!p) { toast(e instanceof Error ? e.message : 'Could not open the profile.'); return; }
    toast('Offline: showing the copy saved on this device.');
  }
  // Answers still waiting on this device win over the server copy.
  const kept = await keptProfile(id);
  if (kept && (await queueCount())) Object.assign(p.data, kept.data);
  P = p; lastSync = p.updatedAt || '';
  render(extra);
  keepProfile(P);
  refreshPill();
  pump();
}

function render(extra: any) {
  const p = P!, view = !p.editable;
  document.title = `${p.name || 'New profile'} | Squad & Staff Data Portal`;
  const fields = FIELDS;
  const sec = (id: string) => fields.filter(f => f.section === id).map(f => fieldHtml(f, p.type)).join('');
  $('main').innerHTML = `
    <div class="sp-form-head">
      <button type="button" class="sp-back" id="back" aria-label="Back to profiles">←</button>
      <span class="sp-badge sp-badge-sm"><img src="/images/lobi-stars-badge.webp" alt="" width="34" height="34" /></span>
      <h1 class="sp-h2" id="formTitle">${esc(p.name ? p.name.toUpperCase() : 'NEW PROFILE')}</h1>
      <span class="sp-badge-st ${BADGE[p.status]}">${esc(STATUSES[p.status])}</span>
      <span class="sp-pill saved" id="savePill" role="status" aria-live="polite"><span class="dot"></span>All changes saved</span>
    </div>
    ${p.status === 'CHANGES_REQUESTED' && p.reviewNote ? `<p class="sp-review"><b>Changes requested by ${esc(p.reviewBy || 'the club')}:</b> ${esc(p.reviewNote)}</p>` : ''}
    ${view ? `<p class="sp-review sp-view">This profile is ${esc(STATUSES[p.status].toLowerCase())} and can only be viewed.${p.status === 'SUBMITTED' ? ' The club will review it.' : ''}</p>` : ''}
    <p class="sp-dup" id="dupWarn" role="status" hidden></p>
    <div class="sp-form">
      <nav class="sp-secnav" aria-label="Sections">
        <ol>${SECTIONS.map(s => `<li data-for="${s.for}"><a href="#sec_${s.id}">${esc(s.label)}</a></li>`).join('')}</ol>
        <div class="sp-key"><p>Key</p><span class="sp-use pub">Public</span> shown on website<br /><span class="sp-use med">Media</span> club media team<br /><span class="sp-use prv">Private</span> club only</div>
      </nav>
      <form class="sp-sections" id="pform" novalidate ${view ? 'inert' : ''}>
        <section class="sp-card sp-sec" id="sec_type" aria-labelledby="h_type">
          <h2 class="sp-h3" id="h_type">PROFILE TYPE</h2>
          <p class="sp-muted">Select the type of profile you are creating. The form will show only the relevant questions.</p>
          <div class="sp-types" role="radiogroup" aria-label="Profile type">
            <button type="button" role="radio" class="sp-type" data-type="player" aria-checked="${p.type === 'player'}">Player</button>
            <button type="button" role="radio" class="sp-type" data-type="staff" aria-checked="${p.type === 'staff'}">Coach / Staff Member</button>
          </div>
        </section>
        <section class="sp-card sp-sec" id="sec_personal" aria-labelledby="h_personal"><h2 class="sp-h3" id="h_personal">1 · PERSONAL DETAILS</h2>${sec('personal')}</section>
        <section class="sp-card sp-sec" id="sec_playing" data-for="player" aria-labelledby="h_playing"><h2 class="sp-h3" id="h_playing">2 · PLAYING PROFILE</h2>${sec('playing')}</section>
        <section class="sp-card sp-sec" id="sec_role" data-for="staff" aria-labelledby="h_role"><h2 class="sp-h3" id="h_role">2 · ROLE &amp; QUALIFICATIONS</h2>${sec('role')}</section>
        <section class="sp-card sp-sec" id="sec_career" aria-labelledby="h_career"><h2 class="sp-h3" id="h_career">3 · CAREER HISTORY &amp; HONOURS ${chip('public')}</h2>${sec('career')}</section>
        <section class="sp-card sp-sec" id="sec_notes" aria-labelledby="h_notes"><h2 class="sp-h3" id="h_notes">4 · PROFILE NOTES ${chip('media')}</h2>
          <p class="sp-muted">Short, factual and positive notes for the club's media team. One or two sentences each.</p>${sec('notes')}</section>
        <section class="sp-card sp-sec" id="sec_photos" aria-labelledby="h_photos"><h2 class="sp-h3" id="h_photos">5 · PHOTOS</h2>
          ${photoHtml('profile', p.type)}${photoHtml('action', p.type)}
          <ul class="sp-guides"><li>Shoulders up, facing the camera, plain light background</li><li id="kitGuide"></li><li>Good daylight. No filters, caps or sunglasses</li></ul></section>
        <section class="sp-card sp-sec" id="sec_confirm" aria-labelledby="h_confirm"><h2 class="sp-h3" id="h_confirm">6 · CONFIRMATION</h2>
          ${fields.filter(f => f.section === 'confirm' && !f.minorOnly).map(f => fieldHtml(f, p.type)).join('')}
          <div class="sp-minor" id="minorBox" hidden><h3 class="sp-h3">Parent or guardian consent (players under 18 only)</h3>${fields.filter(f => f.minorOnly).map(f => fieldHtml(f, p.type)).join('')}</div>
        </section>
      </form>
    </div>
    <div class="sp-bar" role="region" aria-label="Save">
      <span class="sp-bar-status"><span id="barStatus">All changes saved</span> · Every answer saves automatically.</span>
      ${view ? '<button type="button" class="sp-btn sp-btn-outline-light" id="barBack">Back to profiles</button>'
    : '<button type="button" class="sp-btn sp-btn-outline-light" id="draftBtn">Save as draft</button><button type="button" class="sp-btn sp-btn-gold" id="submitBtn">SUBMIT PROFILE</button>'}
    </div>`;
  for (const f of FIELDS) writeField(f.key, p.data[f.key]);
  for (const k of ['profile', 'action']) renderPhoto(k);
  renderAudio();
  visibility();
  checks(extra);
  wire();
  window.scrollTo(0, 0);
}

/** Show only what applies: type, "show if", under 18. Answers in hidden fields are kept. */
function visibility() {
  if (!P) return;
  const type = P.type, minor = isMinor(type, P.data);
  document.querySelectorAll<HTMLElement>('[data-for]').forEach(el => { el.hidden = !(el.dataset.for === 'all' || el.dataset.for === type); });
  document.querySelectorAll<HTMLElement>('[data-showif]').forEach(el => {
    const cond = JSON.parse(el.dataset.showif || '{}');
    el.hidden = el.hidden || !Object.entries(cond).every(([k, v]) => P!.data[k] === v);
  });
  const mb = document.getElementById('minorBox'); if (mb) mb.hidden = !minor;
  document.querySelectorAll<HTMLElement>('.sp-type').forEach(b => b.setAttribute('aria-checked', String(b.dataset.type === type)));
  const dn = document.getElementById('f_displayName') as HTMLInputElement | null;
  if (dn) dn.placeholder = type === 'staff' ? 'e.g. Coach Terver' : 'Name printed on the shirt';
  const hon = document.querySelector('[data-field="honours"] .sp-label'); if (hon) hon.textContent = labelOf(FIELD.honours, type);
  const kit = document.getElementById('kitGuide'); if (kit) kit.textContent = type === 'staff' ? 'Wearing club staff wear' : 'Wearing the official Lobi Stars kit';
  const t = document.getElementById('formTitle'); if (t) t.textContent = P.data.displayName ? String(P.data.displayName).toUpperCase() : 'NEW PROFILE';
  document.querySelectorAll('[data-filename]').forEach(el => updateFileName(el as HTMLElement));
}
function fileBaseLocal() {
  const d = P!.data, s = (x: string) => String(x || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const name = s(d.displayName) || 'profile';
  if (P!.type === 'staff') return `staff-${String(d.role === 'Other' ? d.roleOther || 'staff' : d.role || 'staff').toLowerCase().replace(/[^a-z]/g, '') || 'staff'}-${name}`;
  const n = Number(d.shirtNumber);
  return `${Number.isInteger(n) && n > 0 ? String(n).padStart(2, '0') : 'xx'}-${name}`;
}
function updateFileName(el: HTMLElement) {
  const kind = el.dataset.filename!;
  el.textContent = P?.photos?.[kind] ? `Saved as ${fileBaseLocal()}${kind === 'action' ? '-action' : ''}.webp` : '';
}
function renderPhoto(kind: string) {
  const ph = P?.photos?.[kind], box = document.getElementById(`prev_${kind}`); if (!box) return;
  box.innerHTML = ph ? `<img src="${esc(ph.preview || `/api/squad-portal/file/${P!.id}/${kind}/w400.webp?v=${encodeURIComponent(ph.uploadedAt || '')}`)}" alt="${kind === 'profile' ? 'Profile photo' : 'Action photo'}" />` : '<span>No photo yet</span>';
  const del = document.querySelector<HTMLElement>(`[data-delphoto="${kind}"]`); if (del) del.hidden = !ph || !P!.editable;
  const w = document.getElementById(`warn_${kind}`); if (w) w.innerHTML = (ph?.warnings || []).map((x: string) => `<li>${esc(x)}</li>`).join('');
  const fn = document.querySelector<HTMLElement>(`[data-filename="${kind}"]`); if (fn) updateFileName(fn);
}
function renderAudio() {
  const box = document.getElementById('recPlayer'); if (!box || !P) return;
  const a = P.audio;
  box.innerHTML = a && (a.url || a.local) ? `<audio controls preload="none" src="${esc(a.local || a.url)}"></audio>${P.editable ? '<button type="button" class="sp-link sp-danger" id="recDel">Delete recording</button>' : ''}` : '';
  const btn = document.getElementById('recBtn'); if (btn) btn.textContent = a ? '● Re-record' : '● Record (up to 10 seconds)';
  document.getElementById('recDel')?.addEventListener('click', async () => {
    if (!confirm('Delete the pronunciation recording?')) return;
    try { await api(`profiles/${P!.id}/audio`, { method: 'DELETE' }); P!.audio = null; renderAudio(); } catch (e: any) { toast(e.message); }
  });
}

// ── Events ──
function wire() {
  const form = $('pform');
  $('back').addEventListener('click', leave);
  document.getElementById('barBack')?.addEventListener('click', leave);
  document.getElementById('draftBtn')?.addEventListener('click', async () => { await settleText(); await pump(); toast((await queueCount()) ? 'Saved on this device; it will be sent when the connection returns.' : 'Draft saved.'); leave(); });
  document.getElementById('submitBtn')?.addEventListener('click', submit);
  document.querySelectorAll<HTMLButtonElement>('.sp-type').forEach(b => b.addEventListener('click', () => {
    if (!P!.editable || P!.type === b.dataset.type) return;
    P!.type = b.dataset.type as P['type']; visibility(); save({}, true, P!.type);
  }));
  document.getElementById('dupWarn')?.addEventListener('click', e => { const g = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]'); if (g) openForm(g.dataset.goto!); });
  form.addEventListener('input', e => {
    const root = (e.target as HTMLElement).closest<HTMLElement>('[data-field]'); if (!root) return;
    const key = root.dataset.field!, f = FIELD[key];
    if (f.type === 'textarea') counter(root);
    if (['checkbox', 'multiselect', 'select'].includes(f.type)) return; // saved on change
    clearTimeout(pendingText.get(key));
    pendingText.set(key, window.setTimeout(() => { pendingText.delete(key); P!.data[key] = readField(key); save({ [key]: readField(key) }, false); if (key === 'dob' || key === 'displayName' || key === 'shirtNumber' || key === 'role') visibility(); }, 800));
    pill('saving');
  });
  form.addEventListener('change', e => {
    const root = (e.target as HTMLElement).closest<HTMLElement>('[data-field]'); if (!root) return;
    const key = root.dataset.field!;
    clearTimeout(pendingText.get(key)); pendingText.delete(key);
    const v = readField(key); P!.data[key] = v;
    save({ [key]: v }, true);
    visibility();
  });
  // Rows: add, remove, move, drag.
  form.addEventListener('click', e => {
    const t = e.target as HTMLElement, root = t.closest<HTMLElement>('[data-field]'); if (!root) return;
    const key = root.dataset.field!, f = FIELD[key];
    if (f?.type !== 'rows') return;
    const rows = root.querySelector('.sp-rows')!;
    if (t.closest('[data-addrow]')) { rows.insertAdjacentHTML('beforeend', rowHtml(f)); (rows.lastElementChild?.querySelector('input') as HTMLInputElement)?.focus(); return; }
    const row = t.closest('.sp-row'); if (!row) return;
    if (t.closest('[data-remove]')) { row.remove(); }
    else if (t.closest('[data-move]')) { const d = Number(t.closest<HTMLElement>('[data-move]')!.dataset.move); const sib = d < 0 ? row.previousElementSibling : row.nextElementSibling; if (!sib) return; d < 0 ? sib.before(row) : sib.after(row); }
    else return;
    const v = readField(key); P!.data[key] = v; save({ [key]: v }, true);
  });
  let dragRow: Element | null = null;
  form.addEventListener('dragstart', e => { dragRow = (e.target as HTMLElement).closest('.sp-row'); });
  form.addEventListener('dragover', e => { const over = (e.target as HTMLElement).closest('.sp-row'); if (dragRow && over && over !== dragRow && over.parentElement === dragRow.parentElement) { e.preventDefault(); const r = over.getBoundingClientRect(); (e as DragEvent).clientY < r.top + r.height / 2 ? over.before(dragRow) : over.after(dragRow); } });
  form.addEventListener('dragend', () => { if (!dragRow) return; const key = dragRow.closest<HTMLElement>('[data-field]')!.dataset.field!; dragRow = null; const v = readField(key); P!.data[key] = v; save({ [key]: v }, true); });
  // Photos.
  form.querySelectorAll<HTMLInputElement>('[data-pick]').forEach(inp => inp.addEventListener('change', () => { const f = inp.files?.[0]; inp.value = ''; if (f) addPhoto(inp.dataset.pick as 'profile' | 'action', f); }));
  form.querySelectorAll<HTMLButtonElement>('[data-delphoto]').forEach(b => b.addEventListener('click', async () => {
    const kind = b.dataset.delphoto!;
    if (!confirm('Remove this photo?')) return;
    try { await api(`profiles/${P!.id}/photo?kind=${kind}`, { method: 'DELETE' }); delete P!.photos[kind]; renderPhoto(kind); } catch (e: any) { toast(e.message); }
  }));
  // Recording.
  const rec = new Recorder();
  let recording = false;
  document.getElementById('recBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('recBtn')!, st = document.getElementById('recState')!;
    if (recording) { rec.stop(); return; }
    recording = true; btn.textContent = '■ Stop'; st.textContent = 'Recording… 0 s';
    rec.onTick = s => { st.textContent = `Recording… ${Math.floor(s)} s of 10`; };
    try {
      const r = await rec.start(10);
      st.textContent = `Recorded ${r.seconds.toFixed(1)} s.`;
      P!.audio = { local: r.url, seconds: r.seconds };
      renderAudio();
      const fields: Record<string, Blob | string> = { original: r.original, seconds: String(r.seconds) };
      if (r.mp3) fields.mp3 = r.mp3;
      await uploadKeep({ key: `${P!.id}:audio`, id: P!.id, what: 'audio', fields, at: Date.now() });
      pump();
    } catch (e: any) { st.textContent = e.message; }
    finally { recording = false; renderAudio(); }
  });
}

async function addPhoto(kind: 'profile' | 'action', file: File) {
  const box = document.getElementById(`prev_${kind}`)!;
  box.innerHTML = '<span>Preparing the photo…</span>';
  try {
    const r = await processPhoto(file, kind);
    P!.photos[kind] = { preview: r.preview, warnings: r.warnings, width: r.width, height: r.height, uploadedAt: new Date().toISOString() };
    renderPhoto(kind);
    await uploadKeep({ key: `${P!.id}:photo:${kind}`, id: P!.id, what: 'photo', at: Date.now(),
      fields: { kind, w400: r.w400, w1200: r.w1200, jpg: r.jpg, width: String(r.width), height: String(r.height), warnings: JSON.stringify(r.warnings) } });
    clearError('photo_profile');
    pill(navigator.onLine ? 'saving' : 'offline');
    pump();
  } catch (e: any) { box.innerHTML = '<span>No photo yet</span>'; toast(e.message, 8000); }
}

/** Typing that hasn't paused yet is saved now. */
async function settleText() {
  for (const [key, t] of pendingText) { clearTimeout(t); pendingText.delete(key); const v = readField(key); P!.data[key] = v; await save({ [key]: v }, true); }
}

async function submit() {
  await settleText();
  document.querySelectorAll('.sp-missing').forEach(el => el.classList.remove('sp-missing'));
  const missing = missingForSubmit(P!.type, P!.data);
  if (!P!.photos?.profile) missing.push({ key: 'photo_profile', label: 'Profile photo', section: 'photos' });
  if (missing.length) return highlight(missing);
  const btn = $<HTMLButtonElement>('submitBtn'); btn.disabled = true; btn.textContent = 'SUBMITTING…';
  try {
    await pump();
    if ((await queueCount()) + (await uploadsCount())) throw new Error('Some answers are still waiting to be sent. Check the connection, then submit again.');
    await api(`profiles/${P!.id}/submit`, { method: 'POST' });
    done();
  } catch (e: any) {
    if (e instanceof ApiError && e.data?.missing) highlight(e.data.missing, e.message);
    else toast(e.message, 8000);
  } finally { if (document.getElementById('submitBtn')) { btn.disabled = false; btn.textContent = 'SUBMIT PROFILE'; } }
}
function highlight(missing: { key: string; label: string; section: string }[], message?: string) {
  for (const m of missing) {
    const el = m.key === 'photo_profile' ? document.querySelector('[data-photo="profile"]') : document.querySelector(`[data-field="${m.key}"]`);
    el?.classList.add('sp-missing');
    if (m.key === 'photo_profile') continue;
    showError(m.key, 'Required to submit.');
  }
  const first = missing[0];
  const el = first.key === 'photo_profile' ? document.querySelector('[data-photo="profile"]') : document.querySelector(`[data-field="${first.key}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  (el?.querySelector('input:not([type=file]), select, textarea, label.sp-btn') as HTMLElement | null)?.focus({ preventScroll: true });
  toast(message || `Please complete: ${missing.slice(0, 3).map(m => m.label).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`, 8000);
}
function done() {
  const name = P!.data.displayName || 'The profile';
  P = null;
  $('main').innerHTML = `<section class="sp-card sp-done" aria-labelledby="doneTitle">
    <p class="sp-done-icon" aria-hidden="true">✓</p><h1 class="sp-h2" id="doneTitle">Profile submitted for club review</h1>
    <p class="sp-muted">${esc(name)} has been sent to the club for review. You will see the status change in Saved profiles.</p>
    <div class="sp-done-btns"><button type="button" class="sp-btn sp-btn-red" data-new="player">Add another player</button>
      <button type="button" class="sp-btn sp-btn-dark" data-new="staff">Add a coach / staff member</button>
      <button type="button" class="sp-btn sp-btn-outline" id="doneBack">Back to profiles</button></div></section>`;
  $('main').querySelectorAll<HTMLButtonElement>('[data-new]').forEach(b => b.addEventListener('click', async () => { try { const r = await api('profiles', { method: 'POST', body: { type: b.dataset.new } }); openForm(r.id); } catch (e: any) { toast(e.message); } }));
  $('doneBack').addEventListener('click', () => showHome());
  window.scrollTo(0, 0);
}
async function leave() {
  await settleText();
  P = null; clearInterval(pollTimer);
  showHome();
}

// ── Background: retry when the connection returns, warn before closing with unsent changes, see other editors ──
let wired = false;
export function startForms() {
  if (wired) return; wired = true;
  window.addEventListener('online', () => { refreshPill(); pump(); });
  window.addEventListener('offline', () => refreshPill());
  window.addEventListener('beforeunload', e => { if (dirty || pendingText.size) { e.preventDefault(); e.returnValue = ''; } });
  pollTimer = window.setInterval(async () => {
    if (!P || document.hidden || !navigator.onLine || sending) return;
    try { const r = await api(`profiles/${P.id}`, { method: 'PATCH', body: { changes: {}, since: lastSync }, activity: false }); if (r.others?.length) { applyOthers(r.others); lastSync = r.updatedAt > lastSync ? r.updatedAt : lastSync; } } catch { /* quiet */ }
  }, 20000);
  pump(); // anything left from last time
}
export { ageOn };
