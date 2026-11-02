// Media Centre › Press List.
//   /press-list                 every contact: search, filters, tick people, "Send to press list"
//   /press-list/new             add a contact (the person must have agreed)
//   /press-list/contact/<email> edit or delete a contact
//   /press-list/import          import a CSV (name,email,phone,organisation,media_type)
//   /press-list/compose         the composer: type, message, preview + test, send (one email per person)
//   /press-list/sent[/<id>]     sent messages and their recipients
import { api, esc, when, day, register, toast, go } from './core';
import { upload, pickFile } from './files';

const KEY = 'mc-press-selected';
const loadSel = (): Set<string> => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
const saveSel = (s: Set<string>) => { try { sessionStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* private mode */ } };
let selected = loadSel();

register({ path: 'press-list', label: 'Press List', icon: '📋', async render(main, parts) {
  if (parts[0] === 'new') return contactForm(main, null);
  if (parts[0] === 'contact' && parts[1]) return contactForm(main, decodeURIComponent(parts[1]));
  if (parts[0] === 'import') return importScreen(main);
  if (parts[0] === 'compose') return composer(main);
  if (parts[0] === 'sent') return parts[1] ? sentOne(main, parts[1]) : sentList(main);
  return listScreen(main);
} });

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function download(name: string, text: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function listScreen(main: HTMLElement) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const d = await api('press-list');
  const all: any[] = d.contacts;
  const known = new Set(all.map(c => c.email)); selected = new Set([...selected].filter(e => known.has(e))); saveSel(selected);
  main.innerHTML = `<div class="mc-page-head"><h1>Press List</h1><div class="mc-acts"><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/press-list/sent/" data-go="/press-list/sent">Sent messages</a></div></div>
    <p class="mc-muted">Journalists, photographers, broadcasters and media houses. People join by ticking the box on the accreditation form, or you add them with their agreement. Only <b>subscribed</b> people get statements, matchday links and general messages. Staff only: never shown on the website.</p>
    <div class="mc-acts" style="margin:0 0 12px"><button class="mc-btn mc-btn-blue mc-press-send" type="button" id="send">Send to press list</button>
      <a class="mc-btn mc-btn-o" href="/media-centre/press-list/new/" data-go="/press-list/new">Add contact</a>
      <a class="mc-btn mc-btn-o" href="/media-centre/press-list/import/" data-go="/press-list/import">Import CSV</a>
      <button class="mc-btn mc-btn-o" type="button" id="export">Export CSV</button></div>
    <section class="mc-card">
      <div class="mc-press-filters">
        <input class="mc-input" id="q" type="search" placeholder="Search name, email or organisation" />
        <select class="mc-input" id="ft" aria-label="Media type"><option value="">All media types</option>${d.mediaTypes.map((t: string) => `<option>${esc(t)}</option>`).join('')}</select>
        <select class="mc-input" id="fr" aria-label="Role"><option value="">All roles</option>${d.roles.map((t: string) => `<option>${esc(t)}</option>`).join('')}</select>
        <select class="mc-input" id="fm" aria-label="Applied for match"><option value="">Any match</option>${d.matches.map((m: any) => `<option value="${esc(m.id)}">Applied for ${esc(m.label)} (${esc(day(m.date))})</option>`).join('')}</select>
        <label class="mc-check"><input type="checkbox" id="fs" /> Subscribed only</label>
      </div>
      <p class="mc-press-count"><b id="cnt">0 selected</b> · <span id="shown"></span> <button class="mc-linkbtn" type="button" id="clear">Clear selection</button></p>
      <div class="mc-scroll"><table class="mc-table"><thead><tr><th><input type="checkbox" id="all" aria-label="Select all matching the filter" /></th><th>Name</th><th>Organisation</th><th>Media type</th><th>Role</th><th>Email</th><th>Phone</th><th>Subscribed</th><th>Source</th><th>Matches</th><th>Last contacted</th></tr></thead><tbody id="rows"></tbody></table></div>
    </section>`;
  const $ = (id: string) => main.querySelector(`#${id}`) as any;
  const filtered = () => {
    const q = $('q').value.trim().toLowerCase(), t = $('ft').value, r = $('fr').value, m = $('fm').value, s = $('fs').checked;
    return all.filter(c => (!q || `${c.fullName} ${c.email} ${c.organisation || ''}`.toLowerCase().includes(q)) && (!t || c.mediaType === t) && (!r || c.role === r) && (!m || c.applied.includes(m)) && (!s || c.subscribed));
  };
  const draw = () => {
    const list = filtered();
    $('rows').innerHTML = list.map(c => `<tr><td><input type="checkbox" data-e="${esc(c.email)}" ${selected.has(c.email) ? 'checked' : ''} aria-label="Select ${esc(c.fullName)}" /></td>
      <td><a href="/media-centre/press-list/contact/${encodeURIComponent(c.email)}/" data-go="/press-list/contact/${encodeURIComponent(c.email)}"><b>${esc(c.fullName || c.email)}</b></a>${c.notes ? `<br /><small>${esc(c.notes)}</small>` : ''}</td>
      <td>${esc(c.organisation || '')}</td><td>${esc(c.mediaType || '')}</td><td>${esc(c.role || '')}</td><td><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td><td>${esc(c.phone || '')}</td>
      <td>${c.subscribed ? '<span class="mc-pill published">Yes</span>' : '<span class="mc-pill rejected">No</span>'}</td><td><small>${esc(c.source)}</small></td><td>${c.applications}</td><td><small>${c.lastContactedAt ? esc(day(c.lastContactedAt)) : '—'}</small></td></tr>`).join('') || '<tr><td colspan="11" class="mc-empty">Nobody matches.</td></tr>';
    $('cnt').textContent = `${selected.size} selected`;
    $('shown').textContent = `${list.length} shown of ${all.length}`;
    $('all').checked = list.length > 0 && list.every(c => selected.has(c.email));
    $('send').textContent = selected.size ? `Send to press list (${selected.size})` : 'Send to press list';
  };
  ['q', 'ft', 'fr', 'fm', 'fs'].forEach(id => $(id).addEventListener('input', draw));
  $('rows').addEventListener('change', (e: Event) => { const i = e.target as HTMLInputElement; if (!i.dataset.e) return; i.checked ? selected.add(i.dataset.e) : selected.delete(i.dataset.e); saveSel(selected); draw(); });
  $('all').addEventListener('change', () => { const on = $('all').checked; for (const c of filtered()) on ? selected.add(c.email) : selected.delete(c.email); saveSel(selected); draw(); });
  $('clear').addEventListener('click', () => { selected.clear(); saveSel(selected); draw(); });
  $('send').addEventListener('click', () => { if (!selected.size) { toast('Tick the people to send to first (or "Select all").'); return; } go('/press-list/compose'); });
  $('export').addEventListener('click', () => {
    const rows = filtered();
    download(`lobi-press-list-${new Date().toISOString().slice(0, 10)}.csv`, [['name', 'email', 'phone', 'organisation', 'media_type', 'role', 'subscribed', 'source', 'matches_applied', 'last_contacted'].join(','),
      ...rows.map(c => [c.fullName, c.email, c.phone, c.organisation, c.mediaType, c.role, c.subscribed ? 'yes' : 'no', c.source, c.applications, c.lastContactedAt || ''].map(csvCell).join(','))].join('\n'));
  });
  draw();
}

async function contactForm(main: HTMLElement, email: string | null) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const d = await api('press-list');
  const c = email ? d.contacts.find((x: any) => x.email === email) : null;
  if (email && !c) { main.innerHTML = '<p class="mc-empty">That contact was not found.</p>'; return; }
  const v = c || {};
  const f = (k: string, label: string, val: string, extra = '') => `<label class="mc-field"><span>${label}</span><input class="mc-input" name="${k}" value="${esc(val || '')}" ${extra} /></label>`;
  main.innerHTML = `<div class="mc-page-head"><h1>${c ? esc(c.fullName) : 'Add contact'}</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/press-list/" data-go="/press-list">← Press List</a></div>
    <form id="cf" class="mc-card mc-form-grid">
      ${f('fullName', 'Full name *', v.fullName, 'required maxlength="80"')}
      ${f('email', 'Email *', v.email, 'type="email" required maxlength="254"')}
      ${f('phone', 'Phone', v.phone, 'maxlength="24"')}
      ${f('organisation', 'Media organisation', v.organisation, 'maxlength="120"')}
      <label class="mc-field"><span>Media type</span><select class="mc-input" name="mediaType"><option value="">Choose…</option>${d.mediaTypes.map((t: string) => `<option ${v.mediaType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="mc-field"><span>Role</span><select class="mc-input" name="role"><option value="">Choose…</option>${d.roles.map((t: string) => `<option ${v.role === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="mc-field"><span>Notes</span><textarea class="mc-input" name="notes" maxlength="500" rows="3">${esc(v.notes || '')}</textarea></label>
      ${c ? `<label class="mc-check"><input type="checkbox" name="subscribed" ${c.subscribed ? 'checked' : ''} /> Subscribed (receives statements, matchday links and general messages)</label>
        <p class="mc-small">Source: ${esc(c.source)}${c.consentAt ? ` · agreed ${esc(day(c.consentAt))} (${esc(c.consentSource || '')})` : ''}${c.unsubscribedAt ? ` · unsubscribed ${esc(day(c.unsubscribedAt))}` : ''} · ${c.applications} match application(s)${c.lastContactedAt ? ` · last contacted ${esc(when(c.lastContactedAt))}` : ''}</p>` : ''}
      <label class="mc-check" id="consentRow" ${c && c.subscribed ? 'hidden' : ''}><input type="checkbox" name="consent" ${c ? '' : 'required'} /> This person agreed to receive club media emails${c ? ' (needed to subscribe them again)' : ' *'}</label>
      <p class="mc-acts"><button class="mc-btn mc-btn-blue" type="submit">${c ? 'Save' : 'Add to the press list'}</button>${c ? ' <button class="mc-btn mc-btn-o" type="button" id="del">Delete contact</button>' : ''}</p>
    </form>`;
  const form = main.querySelector('#cf') as HTMLFormElement;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const body: any = { action: c ? 'edit' : 'add', originalEmail: c?.email };
    for (const k of ['fullName', 'email', 'phone', 'organisation', 'mediaType', 'role', 'notes']) body[k] = String(fd.get(k) || '').trim();
    body.consent = fd.get('consent') === 'on';
    if (c) body.subscribed = fd.get('subscribed') === 'on';
    try { await api('press-list', { method: 'POST', body }); toast(c ? 'Saved.' : 'Added to the press list.'); go('/press-list'); } catch (err: any) { toast(err.message, 9000); }
  });
  main.querySelector('#del')?.addEventListener('click', async () => {
    if (!confirm(`Delete ${c.fullName} from the press list? Their accreditation applications are kept.`)) return;
    try { await api('press-list', { method: 'POST', body: { action: 'delete', email: c.email } }); selected.delete(c.email); saveSel(selected); toast('Deleted.'); go('/press-list'); } catch (err: any) { toast(err.message, 9000); }
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
async function importScreen(main: HTMLElement) {
  main.innerHTML = `<div class="mc-page-head"><h1>Import CSV</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/press-list/" data-go="/press-list">← Press List</a></div>
    <section class="mc-card"><p>A CSV file (from Excel or Google Sheets: <i>File › Download › CSV</i>) with the columns <b>name, email, phone, organisation, media_type</b> (media type: Newspaper, Radio, TV, Online, Freelance or Agency). The first row can be the column names. People already on the list are updated (gaps filled in); rows with a bad email are skipped.</p>
      <p><button class="mc-btn mc-btn-o" type="button" id="pick">Choose CSV file</button> <button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="tpl">Download an empty template</button></p><div id="pv"></div></section>`;
  main.querySelector('#tpl')!.addEventListener('click', () => download('press-list-template.csv', 'name,email,phone,organisation,media_type\nAda Reporter,ada@example.com,0803 000 0000,Benue Daily,Newspaper\n'));
  main.querySelector('#pick')!.addEventListener('click', async () => {
    const file = await pickFile('.csv,text/csv'); if (!file) return;
    if (file.size > 2e6) { toast('The file is too large (2 MB at most).'); return; }
    let rows = parseCsv(await file.text());
    const head = rows[0]?.map(x => x.trim().toLowerCase().replace(/\s+/g, '_')) || [];
    const cols = ['name', 'email', 'phone', 'organisation', 'media_type'];
    const idx = head.includes('email') ? cols.map(c => head.indexOf(c === 'organisation' && !head.includes(c) ? 'organization' : c)) : cols.map((_, i) => i);
    if (head.includes('email')) rows = rows.slice(1);
    const data = rows.map(r => Object.fromEntries(cols.map((c, i) => [c, (idx[i] >= 0 ? r[idx[i]] || '' : '').trim()])));
    const ok = (e: string) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(e);
    const pv = main.querySelector('#pv') as HTMLElement;
    pv.innerHTML = `<h2 class="mc-h3">Preview: ${data.length} row(s), ${data.filter(r => ok(r.email)).length} with a valid email</h2>
      <div class="mc-scroll" style="max-height:360px"><table class="mc-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Organisation</th><th>Media type</th></tr></thead><tbody>${data.slice(0, 300).map(r => `<tr${ok(r.email) ? '' : ' class="mc-bad"'}><td>${esc(r.name)}</td><td>${esc(r.email)}${ok(r.email) ? '' : ' <small>(skipped)</small>'}</td><td>${esc(r.phone)}</td><td>${esc(r.organisation)}</td><td>${esc(r.media_type)}</td></tr>`).join('')}</tbody></table></div>
      <label class="mc-check" style="margin-top:10px"><input type="checkbox" id="consent" /> Everyone in this file agreed to receive club media emails (they are then subscribed; leave unticked to add them as not subscribed)</label>
      <p><button class="mc-btn mc-btn-blue" type="button" id="go">Import ${data.length} row(s)</button></p>`;
    pv.querySelector('#go')!.addEventListener('click', async e => {
      (e.currentTarget as HTMLButtonElement).disabled = true;
      try { const r = await api('press-list', { method: 'POST', body: { action: 'import', rows: data, consent: (pv.querySelector('#consent') as HTMLInputElement).checked } }); toast(`${r.added} added, ${r.updated} updated, ${r.skipped} skipped.`, 12000); go('/press-list'); }
      catch (err: any) { toast(err.message, 9000); (e.currentTarget as HTMLButtonElement).disabled = false; }
    });
  });
}

async function composer(main: HTMLElement) {
  if (!selected.size) { toast('Tick the people to send to first.'); go('/press-list', true); return; }
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const [o, pl] = await Promise.all([api('press-list/compose'), api('press-list')]);
  const byEmail = new Map(pl.contacts.map((c: any) => [c.email, c]));
  const st: any = { type: '', pressItemId: '', eventId: '', attachments: [] as any[] };
  main.innerHTML = `<div class="mc-page-head"><h1>Send to press list</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/press-list/" data-go="/press-list">← Change who receives it</a></div>
    <p class="mc-muted" id="who"></p>
    <section class="mc-card mc-step"><h2 class="mc-h3"><span>1</span> Message type</h2>
      <div class="mc-themes" role="radiogroup">${Object.entries(o.types).map(([k, t]: any) => `<label class="mc-theme"><input type="radio" name="type" value="${k}" /> <span>${esc(t)}</span></label>`).join('')}</div>
      <div id="t-statement" hidden><label class="mc-field"><span>Press release</span><select class="mc-input" id="rel"><option value="">Choose a published press release…</option>${o.releases.map((r: any) => `<option value="${esc(r.id)}">${esc(day(r.publishedAt))}: ${esc(r.headline)}</option>`).join('')}</select></label>${o.releases.length ? '' : '<p class="mc-small">No published press releases yet.</p>'}</div>
      <div id="t-match" hidden><label class="mc-field"><span>Match</span><select class="mc-input" id="ev"><option value="">Choose the home match…</option>${o.matches.map((m: any) => `<option value="${esc(m.id)}">${esc(m.line)}</option>`).join('')}</select></label>
        <p id="appliedRow" hidden><button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="addApplied">Send to everyone who applied for this match</button> <small>Replaces the people you ticked.</small></p></div>
    </section>
    <section class="mc-card mc-step"><h2 class="mc-h3"><span>2</span> Subject and message</h2>
      <label class="mc-field"><span>Subject</span><input class="mc-input" id="subject" maxlength="160" /></label>
      <div class="mc-rt-bar" role="toolbar" aria-label="Formatting"><button type="button" data-cmd="bold"><b>B</b></button><button type="button" data-cmd="italic"><i>I</i></button><button type="button" data-cmd="insertUnorderedList">• List</button><button type="button" data-cmd="link">Link</button>
        <span class="mc-rt-sep"></span><button type="button" data-merge="{first_name}">{first_name}</button><button type="button" data-merge="{full_name}">{full_name}</button><button type="button" data-merge="{organisation}">{organisation}</button></div>
      <div class="mc-rt" id="body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message"><p>Dear {first_name},</p><p><br></p></div>
      <p class="mc-acts" style="margin-top:10px"><button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="att">Attach a file (PDF or JPG, 5 MB)</button><span id="attName" class="mc-small"></span></p>
    </section>
    <section class="mc-card mc-step"><h2 class="mc-h3"><span>3</span> Preview</h2>
      <p><button class="mc-btn mc-btn-o" type="button" id="pvBtn">Show preview</button></p><div id="pv"></div>
      <div class="mc-acts"><input class="mc-input" id="testTo" type="email" placeholder="Your email for a test" style="max-width:320px" /><button class="mc-btn mc-btn-o" type="button" id="test">Send test to me</button></div>
    </section>
    <section class="mc-card mc-step"><h2 class="mc-h3"><span>4</span> Send</h2><p class="mc-small">One email to each person; nobody sees anyone else's address.</p>
      <button class="mc-btn mc-btn-blue mc-press-send" type="button" id="sendNow">Send</button><div id="prog"></div></section>`;
  const $ = (id: string) => main.querySelector(`#${id}`) as any;
  const who = () => { $('who').innerHTML = `<b>${selected.size}</b> people selected${[...selected].filter(e => !(byEmail.get(e) as any)?.subscribed).length ? ` (${[...selected].filter(e => !(byEmail.get(e) as any)?.subscribed).length} not subscribed)` : ''}.`; };
  who();
  try { $('testTo').value = localStorage.getItem('mc-test-email') || ''; } catch { /* */ }
  const setBody = (html: string) => { $('body').innerHTML = html; };
  main.querySelectorAll<HTMLInputElement>('input[name=type]').forEach(r => r.addEventListener('change', () => {
    st.type = r.value;
    $('t-statement').hidden = st.type !== 'statement';
    $('t-match').hidden = !['matchday', 'notice'].includes(st.type);
    $('appliedRow').hidden = st.type !== 'notice';
    // The match list: upcoming only for matchday links; any listed match for notices.
    [...$('ev').options].forEach((op: HTMLOptionElement) => { const m = o.matches.find((x: any) => x.id === op.value); op.hidden = !!m && st.type === 'matchday' && !m.upcoming; });
    if (st.type === 'general' && !$('subject').value) setBody('<p>Dear {first_name},</p><p><br></p>');
    $('pv').innerHTML = '';
  }));
  $('rel').addEventListener('change', () => {
    const r = o.releases.find((x: any) => x.id === $('rel').value); st.pressItemId = r?.id || '';
    if (r) { $('subject').value = `${r.statement ? 'Statement' : 'Press release'}: ${r.headline}`; setBody(`<p>Dear {first_name},</p><p>${esc(r.summary)}</p><p>The full release is on our website and attached as a PDF.</p>`); }
  });
  $('ev').addEventListener('change', () => {
    const m = o.matches.find((x: any) => x.id === $('ev').value); st.eventId = m?.id || '';
    if (!m) return;
    const short = m.line.split(',')[0];
    if (st.type === 'matchday') { $('subject').value = `Media accreditation open: ${short}`; setBody(`<p>Dear {first_name},</p><p>Media accreditation is open for our next home match. Apply online; applications close 6 hours before kick-off. Accreditation cards are collected at the stadium on match day.</p>`); }
    if (st.type === 'notice') { $('subject').value = `Accreditation notice: ${short}`; setBody('<p>Dear {first_name},</p><p><br></p>'); }
  });
  $('addApplied').addEventListener('click', () => {
    if (!st.eventId) { toast('Choose the match first.'); return; }
    const people = pl.contacts.filter((c: any) => c.applied.includes(st.eventId)).map((c: any) => c.email);
    if (!people.length) { toast('Nobody has applied for this match yet.'); return; }
    selected = new Set(people); saveSel(selected); who(); toast(`${people.length} applicant(s) selected.`);
  });
  main.querySelectorAll<HTMLElement>('[data-cmd]').forEach(b => b.addEventListener('click', () => {
    $('body').focus();
    if (b.dataset.cmd === 'link') { const u = prompt('Link address (https://…)'); if (u && /^https?:\/\//i.test(u)) document.execCommand('createLink', false, u); return; }
    document.execCommand(b.dataset.cmd!, false);
  }));
  main.querySelectorAll<HTMLElement>('[data-merge]').forEach(b => b.addEventListener('click', () => { $('body').focus(); document.execCommand('insertText', false, b.dataset.merge!); }));
  $('att').addEventListener('click', async () => {
    const file = await pickFile('application/pdf,image/jpeg'); if (!file) return;
    try { const u = await upload(file, { kind: 'document', section: 'presslist' }); st.attachments = [{ id: u.id, name: file.name }]; $('attName').innerHTML = `${esc(file.name)} <button class="mc-linkbtn" type="button" id="rmAtt">Remove</button>`; $('rmAtt').addEventListener('click', () => { st.attachments = []; $('attName').textContent = ''; }); }
    catch (err: any) { toast(err.message, 9000); }
  });
  const payload = (action: string) => ({ action, type: st.type, pressItemId: st.pressItemId, eventId: st.eventId, subject: $('subject').value.trim(), body: $('body').innerHTML, emails: [...selected], attachments: st.attachments, testTo: $('testTo').value.trim() });
  const check = () => { if (!st.type) return 'Choose the message type (step 1).'; if (st.type === 'statement' && !st.pressItemId) return 'Choose the press release.'; if (['matchday', 'notice'].includes(st.type) && !st.eventId) return 'Choose the match.'; if (!$('subject').value.trim()) return 'Write the subject.'; return ''; };
  let lastCount = 0;
  const showPreview = async () => {
    const bad = check(); if (bad) { toast(bad); return false; }
    const r = await api('press-list/compose', { method: 'POST', body: payload('preview') });
    lastCount = r.recipients;
    $('pv').innerHTML = `<p><b>${r.recipients}</b> recipient${r.recipients === 1 ? '' : 's'} · Subject: <b>${esc(r.subject)}</b>${r.attachPdf ? ' · the release PDF is attached' : ''}${st.attachments.length ? ` · attachment: ${esc(st.attachments[0].name)}` : ''}</p>
      ${r.excluded.length ? `<div class="mc-banner-warn"><b>${r.excluded.length} selected ${r.excluded.length === 1 ? 'person is' : 'people are'} left out:</b> ${r.excluded.slice(0, 12).map((x: any) => `${esc(x.fullName || x.email)} (${esc(x.why)})`).join(', ')}${r.excluded.length > 12 ? '…' : ''}</div>` : ''}
      <iframe class="mc-press-frame" title="Email preview" sandbox=""></iframe>`;
    ($('pv').querySelector('iframe') as HTMLIFrameElement).srcdoc = r.html;
    return true;
  };
  $('pvBtn').addEventListener('click', () => showPreview().catch((err: any) => toast(err.message, 9000)));
  $('test').addEventListener('click', async () => {
    const bad = check(); if (bad) { toast(bad); return; }
    try { localStorage.setItem('mc-test-email', $('testTo').value.trim()); } catch { /* */ }
    try { await api('press-list/compose', { method: 'POST', body: payload('test') }); toast(`Test sent to ${$('testTo').value.trim()}.`); } catch (err: any) { toast(err.message, 9000); }
  });
  $('sendNow').addEventListener('click', async () => {
    try {
      if (!(await showPreview())) return;
      if (!lastCount) { toast('Nobody to send to: the selected people are not subscribed.'); return; }
      if (!confirm(`Send to ${lastCount} contact${lastCount === 1 ? '' : 's'}?`)) return;
      $('sendNow').disabled = true;
      const c = await api('press-list/compose', { method: 'POST', body: payload('create') });
      await runBatches(c.id, $('prog'));
      selected.clear(); saveSel(selected);
      go(`/press-list/sent/${c.id}`);
    } catch (err: any) { toast(err.message, 9000); $('sendNow').disabled = false; }
  });
}
async function runBatches(id: string, prog: HTMLElement) {
  for (let i = 0; i < 1000; i++) {
    const r = await api('press-list/compose', { method: 'POST', body: { action: 'batch', id } });
    const doneN = r.sent + r.failed;
    prog.innerHTML = `<div class="mc-prog"><i style="width:${Math.round((doneN / Math.max(1, r.total)) * 100)}%"></i></div><p class="mc-small">${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''} of ${r.total}. Keep this page open.</p>`;
    if (!r.remaining) { toast(`Done: ${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''}.`, 9000); return; }
  }
}

async function sentList(main: HTMLElement) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const { messages } = await api('press-list/messages');
  main.innerHTML = `<div class="mc-page-head"><h1>Sent messages</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/press-list/" data-go="/press-list">← Press List</a></div>
    <section class="mc-card"><div class="mc-scroll"><table class="mc-table"><thead><tr><th>Date</th><th>Sender</th><th>Type</th><th>Subject</th><th>Sent / failed</th></tr></thead><tbody>
    ${messages.map((m: any) => `<tr><td>${esc(when(m.createdAt))}</td><td>${esc(m.sentBy)}</td><td>${esc(m.typeLabel)}</td><td><a href="/media-centre/press-list/sent/${esc(m.id)}/" data-go="/press-list/sent/${esc(m.id)}"><b>${esc(m.subject)}</b></a></td>
      <td><span class="mc-pill published">${m.sent}</span> ${m.failed ? `<span class="mc-pill rejected">${m.failed}</span>` : ''} <small>of ${m.recipients}${m.finished ? '' : ' · not finished'}</small></td></tr>`).join('') || '<tr><td colspan="5" class="mc-empty">Nothing sent yet.</td></tr>'}
    </tbody></table></div></section>`;
}
async function sentOne(main: HTMLElement, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const { message: m } = await api(`press-list/messages?id=${encodeURIComponent(id)}`);
  const ST: Record<string, string> = { sent: 'published', failed: 'rejected', queued: 'submitted', sending: 'submitted' };
  main.innerHTML = `<div class="mc-page-head"><h1>${esc(m.subject)}</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/press-list/sent/" data-go="/press-list/sent">← Sent messages</a></div>
    <p class="mc-muted">${esc(m.typeLabel)} · sent by ${esc(m.sentBy)} · ${esc(when(m.createdAt))} · <b>${m.sent}</b> sent${m.failed ? `, <b>${m.failed}</b> failed` : ''} of ${m.recipients}${m.attachments.length ? ` · attachment: ${m.attachments.map((a: any) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>`).join(', ')}` : ''}</p>
    ${m.finished ? '' : '<p><button class="mc-btn mc-btn-blue" type="button" id="resume">Continue sending</button></p><div id="prog"></div>'}
    <div class="mc-press-detail"><section class="mc-card"><h2 class="mc-h3">The message</h2><iframe class="mc-press-frame" title="The message" sandbox=""></iframe></section>
    <section class="mc-card"><h2 class="mc-h3">Recipients</h2><div class="mc-scroll"><table class="mc-table"><thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead><tbody>
    ${m.list.map((r: any) => `<tr><td>${esc(r.fullName || '')}<br /><small>${esc(r.organisation || '')}</small></td><td>${esc(r.email)}</td><td><span class="mc-pill ${ST[r.status] || ''}">${esc(r.status)}</span>${r.error ? `<br /><small>${esc(r.error)}</small>` : ''}${r.sentAt && r.status === 'sent' ? `<br /><small>${esc(when(r.sentAt))}</small>` : ''}</td></tr>`).join('')}
    </tbody></table></div></section></div>`;
  (main.querySelector('iframe') as HTMLIFrameElement).srcdoc = m.html;
  main.querySelector('#resume')?.addEventListener('click', async e => { (e.currentTarget as HTMLButtonElement).disabled = true; try { await runBatches(m.id, main.querySelector('#prog') as HTMLElement); go(`/press-list/sent/${m.id}`, true); } catch (err: any) { toast(err.message, 9000); } });
}
