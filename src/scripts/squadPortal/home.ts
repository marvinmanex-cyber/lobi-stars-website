// Squad & Staff Data Portal: the home screen (Screen 2) – how it works, the two
// "add" buttons, live counts, saved profiles (search, filters, season) and the
// export card.
import { api, state, $, esc, toast, lagos } from './api';
import { openForm } from './form';
import { runExport } from './exports';

const FILTERS: [string, string][] = [['all', 'All'], ['players', 'Players'], ['staff', 'Staff'], ['drafts', 'Drafts'], ['submitted', 'Submitted'], ['verified', 'Verified'], ['changes', 'Changes requested'], ['left', 'Left the club']];
const BADGE: Record<string, string> = { DRAFT: 'amber', SUBMITTED: 'blue', VERIFIED: 'green', CHANGES_REQUESTED: 'red', LEFT_THE_CLUB: 'grey' };
const view = { filter: 'all', q: '', season: '' };
let searchTimer = 0;

export async function showHome() {
  view.season = view.season || state.season;
  document.title = 'Squad & Staff Data Portal | Lobi Stars FC';
  $('main').innerHTML = `
    <p class="sp-kicker sp-gold">${esc(state.season)} SEASON</p>
    <h1 class="sp-h1 sp-page-title">SQUAD &amp; STAFF PROFILES</h1>
    <p class="sp-intro">Capture each player's and staff member's details and photo in one sitting. Every answer saves automatically, so nothing is lost if the network or power goes off.</p>
    <section class="sp-how" aria-labelledby="howTitle"><h2 class="sp-h3" id="howTitle">How it works</h2>
      <ol class="sp-steps">
        <li class="sp-card"><span class="sp-step">1</span><b>Select the profile type</b><span>Player or coach / staff member. Only the relevant questions are shown.</span></li>
        <li class="sp-card"><span class="sp-step">2</span><b>Complete the form together</b><span>Enter their answers and photo. Every answer saves automatically.</span></li>
        <li class="sp-card"><span class="sp-step">3</span><b>Save as draft or submit</b><span>Drafts can be finished later. Submitted profiles go for club review.</span></li>
      </ol></section>
    <div class="sp-adds">
      <button type="button" class="sp-add sp-add-red" data-add="player"><b>ADD A PLAYER</b><span>Shirt number, position, career, achievements, photo</span></button>
      <button type="button" class="sp-add sp-add-dark" data-add="staff"><b>ADD A COACH / STAFF MEMBER</b><span>Role, experience, qualifications, achievements, photo</span></button>
    </div>
    <ul class="sp-chips" id="chips" aria-label="Summary"></ul>
    <section class="sp-card sp-saved" aria-labelledby="savedTitle">
      <div class="sp-saved-head"><h2 class="sp-h3" id="savedTitle">SAVED PROFILES</h2>
        <label class="sp-season">Season <select id="seasonSel"></select></label></div>
      <div class="sp-field sp-search"><label for="q">Search</label><input id="q" type="search" placeholder="Name or shirt number" value="${esc(view.q)}" /></div>
      <div class="sp-filters" role="group" aria-label="Show">${FILTERS.map(([k, l]) => `<button type="button" class="sp-filter" data-filter="${k}" aria-pressed="${k === view.filter}">${l}</button>`).join('')}</div>
      <div class="sp-table-wrap" tabindex="0" role="region" aria-label="Saved profiles (scrolls sideways on small screens)"><table class="sp-table"><thead><tr>
        <th scope="col">Photo</th><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Number / position or role</th><th scope="col">Status</th><th scope="col">Last saved</th><th scope="col">Actions</th>
      </tr></thead><tbody id="rows"><tr><td colspan="7">Loading…</td></tr></tbody></table></div>
    </section>
    <section class="sp-card sp-export" aria-labelledby="exportTitle">
      <h2 class="sp-h3" id="exportTitle">EXPORT DATA</h2>
      <div class="sp-export-opts">
        <div class="sp-field"><label for="exWhich">Which profiles</label><select id="exWhich"><option value="verified">Verified only</option><option value="submitted">All submitted</option><option value="players">Players</option><option value="staff">Staff</option></select></div>
        <div class="sp-field"><label for="exSeason">Season</label><select id="exSeason"><option value="current">Current season</option><option value="all">All seasons</option></select></div>
      </div>
      <div class="sp-export-btns">
        <button type="button" class="sp-btn sp-btn-outline" data-export="pdf">Download PDF</button>
        <button type="button" class="sp-btn sp-btn-outline" data-export="docx">Download Word</button>
        <button type="button" class="sp-btn sp-btn-outline" data-export="xlsx">Download Excel</button>
        <button type="button" class="sp-btn sp-btn-outline" data-export="csv">Download CSV</button>
        <button type="button" class="sp-btn sp-btn-outline" data-export="json">Download JSON</button>
        <button type="button" class="sp-btn sp-btn-gold sp-export-zip" data-export="zip">Download Media Partner Data Package (ZIP)</button>
      </div>
      <p class="sp-hint">Private contact details are not included in downloads from this portal.</p>
      <p class="sp-export-status" id="exStatus" role="status" aria-live="polite" hidden></p>
    </section>`;
  $('main').querySelectorAll<HTMLButtonElement>('[data-add]').forEach(b => b.addEventListener('click', () => startNew(b.dataset.add as 'player' | 'staff', b)));
  $('main').querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(b => b.addEventListener('click', () => {
    view.filter = b.dataset.filter!; $('main').querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load();
  }));
  $('q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { view.q = $<HTMLInputElement>('q').value; load(); }, 300); });
  $('seasonSel').addEventListener('change', e => { view.season = (e.target as HTMLSelectElement).value; load(); });
  $('rows').addEventListener('click', onRowClick);
  $('main').querySelectorAll<HTMLButtonElement>('[data-export]').forEach(b => b.addEventListener('click', () => runExport({
    place: 'portal', format: b.dataset.export as any, which: $<HTMLSelectElement>('exWhich').value, season: $<HTMLSelectElement>('exSeason').value === 'all' ? 'all' : state.season,
    status: (t: string, ok = true) => { const s = $('exStatus'); s.textContent = t; s.className = `sp-export-status ${ok ? '' : 'err'}`; s.hidden = !t; }, button: b,
  })));
  await load();
  window.scrollTo(0, 0);
}

async function startNew(type: 'player' | 'staff', btn: HTMLButtonElement) {
  btn.disabled = true;
  try { const r = await api('profiles', { method: 'POST', body: { type } }); await openForm(r.id); }
  catch (e: any) { toast(e.message); }
  finally { btn.disabled = false; }
}

async function load() {
  try {
    const p = new URLSearchParams({ season: view.season, filter: view.filter, q: view.q });
    const d = await api(`profiles?${p}`, { activity: false });
    const c = d.counts;
    $('chips').innerHTML = [['Players', c.players], ['Staff', c.staff], ['Drafts', c.drafts], ['Submitted', c.submitted], ['Verified', c.verified], ['Changes requested', c.changes]]
      .map(([l, n]) => `<li class="sp-chip"><b>${n}</b> ${l}</li>`).join('');
    $('seasonSel').innerHTML = (d.seasons as string[]).map(s => `<option value="${esc(s)}" ${s === view.season ? 'selected' : ''}>${esc(s)}${s === d.current ? ' (current)' : ''}</option>`).join('');
    $('rows').innerHTML = d.profiles.length ? d.profiles.map(row).join('') : `<tr><td colspan="7" class="sp-empty">No profiles here yet.</td></tr>`;
  } catch (e: any) { $('rows').innerHTML = `<tr><td colspan="7" class="sp-empty">${esc(e.message)}</td></tr>`; }
}

function row(p: any) {
  const what = p.type === 'player' ? `${p.shirtNumber ?? '–'} · ${esc(p.position || 'No position yet')}` : esc(p.role || 'No role yet');
  const actions = p.editable
    ? `<button type="button" class="sp-link" data-open="${p.id}">${p.status === 'DRAFT' ? 'Continue' : 'Edit'}</button>${p.status === 'DRAFT' ? `<button type="button" class="sp-link sp-danger" data-del="${p.id}" data-name="${esc(p.name)}">Delete draft</button>` : ''}`
    : `<button type="button" class="sp-link" data-open="${p.id}">View</button>`;
  return `<tr>
    <td>${p.thumb ? `<img class="sp-thumb" src="${esc(p.thumb)}" alt="" width="44" height="55" loading="lazy" />` : '<span class="sp-thumb sp-thumb-empty" aria-hidden="true">?</span>'}</td>
    <td><b>${esc(p.name || 'Unnamed draft')}</b>${p.nameStatus === 'check' ? ' <span class="sp-namecheck">Please check name order</span>' : ''}${p.reviewNote ? `<p class="sp-review-note">Reviewer: ${esc(p.reviewNote)}</p>` : ''}</td>
    <td>${p.type === 'player' ? 'Player' : 'Coach / staff'}</td><td>${what}</td>
    <td><span class="sp-badge-st ${BADGE[p.status]}">${esc(p.statusLabel)}</span></td>
    <td>${esc(lagos(p.updatedAt))}<br /><small>by ${esc(p.updatedBy || '')}</small></td>
    <td class="sp-actions">${actions}</td></tr>`;
}

async function onRowClick(e: Event) {
  const t = e.target as HTMLElement;
  const open = t.closest<HTMLElement>('[data-open]');
  if (open) return openForm(open.dataset.open!);
  const del = t.closest<HTMLElement>('[data-del]');
  if (del && confirm(`Delete the draft for ${del.dataset.name || 'this unnamed profile'}? This cannot be undone.`)) {
    try { await api(`profiles/${del.dataset.del}`, { method: 'DELETE' }); toast('Draft deleted.'); load(); } catch (err: any) { toast(err.message); }
  }
}
