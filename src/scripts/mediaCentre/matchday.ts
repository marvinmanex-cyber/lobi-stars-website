// Media Centre › Matchday Desk: prepare the line-up and substitutes in advance
// (approved, published at the chosen time). Live updates: the button opens the
// club's WhatsApp channel (link set by a Super Admin) where the media officer
// posts live updates for fans.
import { api, esc, register, go, toast, when, itemPath, statusPill } from './core';
import { statusBanner, autosaver, workflowButtons } from './items';
import { meta } from './news';

const WA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:-4px;margin-right:6px"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.48-8.41Z"/></svg>';
const localInput = (iso?: string | null) => iso ? new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 16) : '';
const fromLocal = (v: string) => v ? new Date(`${v}:00+01:00`).toISOString() : null;

register({ path: 'matchday', label: 'Matchday Desk', icon: '⚽', async render(main, parts) {
  // The website live-score desk was removed (1 Nov 2026): live updates go to the WhatsApp channel.
  if (parts[0] === 'live') { go('/matchday', true); return; }
  if (parts[0]) return lineupEditor(main, parts[0]);
  const [M, L] = await Promise.all([meta(), api('items?kind=lineup')]);
  const soon = M.matches.filter((m: any) => Date.parse(m.date) > Date.now() - 6 * 3600e3);
  main.innerHTML = `<div class="mc-page-head"><h1>Matchday Desk</h1></div>
    <p class="mc-muted">Prepare line-ups before the match. <b>Live updates</b> opens the club's WhatsApp channel: post the live updates for fans there. For the full live audio, see <a href="/commentary/" target="_blank" rel="noopener">Live Commentary</a>.</p>
    <section class="mc-card"><h2 class="mc-h3">Lobi Stars matches</h2>${soon.length ? `<ul class="mc-list">${soon.map((m: any) => `<li><div class="t"><b>${esc(m.label)}</b><small>${esc(when(m.date))} · ${esc(m.venue)}</small></div>
      <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-lineup="${esc(m.id)}" data-label="${esc(m.label)}" data-date="${esc(m.date)}">Prepare line-up</button>
      ${M.settings?.whatsappChannel ? `<a class="mc-btn mc-btn-sm mc-wa" href="${esc(M.settings.whatsappChannel)}" target="mc-whatsapp-channel" rel="noopener">${WA_ICON}Live updates</a>` : `<button class="mc-btn mc-btn-sm mc-wa" type="button" data-nochannel>${WA_ICON}Live updates</button>`}
      <a class="mc-small" href="/matches/${esc(m.slug)}/" target="_blank" rel="noopener">Match page</a></li>`).join('')}</ul>` : '<p class="mc-empty">No upcoming Lobi Stars matches in the fixtures.</p>'}</section>
    <section class="mc-card" style="margin-top:14px"><h2 class="mc-h3">Line-ups</h2>${L.items.length ? `<ul class="mc-list">${L.items.map((i: any) => `<li><div class="t"><b>${esc(i.title)}</b><small>${i.scheduledAt ? `publishes ${esc(when(i.scheduledAt))}` : `updated ${esc(when(i.updatedAt))}`}</small></div>${statusPill(i)} <a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/${esc(itemPath(i))}/" data-go="/${esc(itemPath(i))}">Open</a></li>`).join('')}</ul>` : '<p class="mc-empty">No line-ups yet.</p>'}</section>`;
  main.querySelectorAll<HTMLElement>('[data-nochannel]').forEach(b => b.addEventListener('click', () => toast("The club's WhatsApp channel link hasn't been added yet. Ask a Super Admin to add it (Admin › Media Centre › Users & settings).", 9000)));
  main.querySelectorAll<HTMLElement>('[data-lineup]').forEach(b => b.addEventListener('click', async () => {
    const d = await api('items', { method: 'POST', body: { kind: 'lineup', data: { eventId: b.dataset.lineup, label: b.dataset.label, starting: [], subs: [] } } });
    go(`/matchday/${d.id}`);
  }));
} });

// The line-up itself lives in the SHARED line-up (the Statistics Center edits the same one): every change is sent
// with the version you last saw; changes to other players merge, a clash shows "Keep theirs / Use mine". The page
// checks for newer versions every 5 seconds and shows who else is editing. The Media Centre item keeps the approval
// and publishing steps (Send for approval, publish time).
let luTimers: number[] = [];
async function lineupEditor(main: HTMLElement, id: string) {
  luTimers.forEach(t => clearInterval(t)); luTimers = [];
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const [{ item, editable }, M] = await Promise.all([api(`items/${id}`), meta()]);
  const d: any = item.data || {};
  const m = M.matches.find((x: any) => x.id === d.eventId);
  let sh: any = await api(`lineup?eventId=${encodeURIComponent(d.eventId)}`);
  let dirty = false;
  const defaultAt = item.scheduledAt || (m ? new Date(Date.parse(m.date) - 60 * 60e3).toISOString() : null);
  const ro = () => !editable || sh.status !== 'draft';
  const chip = () => `<span class="mc-pill" style="background:${sh.status === 'locked' ? '#E5E7EB' : sh.status === 'confirmed' ? '#DCFCE7' : '#FEF3C7'}">${sh.status === 'locked' ? 'Locked (kick-off)' : sh.status === 'confirmed' ? 'Confirmed' : 'Draft'}</span>`;
  const role = (slug: string) => { const r = sh.rows.find((x: any) => x.slug === slug); return r ? (r.role === 'starter' ? 'start' : 'sub') : ''; };
  const draw = () => {
    main.innerHTML = `<div class="mc-page-head"><h1>Line-up: ${esc(d.label || '')}</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/matchday/" data-go="/matchday">← Matchday Desk</a></div>
    ${statusBanner(item, editable)}
    <p class="mc-hint" id="who" ${sh.others?.length ? '' : 'hidden'}>${sh.others?.length ? `${esc(sh.others.map((o: any) => o.name).join(', '))} ${sh.others.length > 1 ? 'are' : 'is'} editing this line-up too. Changes are merged safely; agree who picks which players.` : ''}</p>
    ${sh.changedSincePublished ? '<p class="mc-hint" style="color:#A15C00"><b>The line-up changed since it was last published.</b> Send it for approval again to update the match page, team news and graphics.</p>' : ''}
    <div id="conflict"></div>
    <form class="mc-card" id="f">
      <p class="mc-muted">${m ? `${esc(when(m.date))} · ${esc(m.venue)}` : ''} · ${chip()} · version ${sh.version}${sh.lastEditedBy ? ` · last change by ${esc(sh.lastEditedBy)}` : ''}</p>
      <p class="mc-hint">This is the club's one line-up: the Statistics Center uses the same one. ${sh.status === 'confirmed' ? `Confirmed by ${esc(sh.confirmedBy || '')}: reopen it to change anything.` : sh.status === 'locked' ? 'The match has kicked off: changes are now substitutions (Statistics Center).' : ''}</p>
      <p><b id="count"></b></p>
      <div class="mc-pick">${M.players.map((p: any) => `<label><span>${p.number != null ? `#${esc(p.number)} ` : ''}${esc(p.name)}</span><select data-p="${esc(p.slug)}" data-name="${esc(p.name)}" data-number="${esc(p.number ?? '')}" data-pos="${esc(p.position)}" ${ro() ? 'disabled' : ''}><option value="">—</option><option value="start" ${role(p.slug) === 'start' ? 'selected' : ''}>Starts</option><option value="sub" ${role(p.slug) === 'sub' ? 'selected' : ''}>Sub</option></select></label>`).join('') || '<p class="mc-muted">No live squad profiles yet.</p>'}</div>
      <div class="mc-grid two" style="margin-top:12px"><div class="mc-field"><label for="formation">Formation <small>(optional)</small></label><input id="formation" maxlength="12" value="${esc(sh.formation || '')}" placeholder="4-3-3" ${ro() ? 'disabled' : ''} /></div>
      <div class="mc-field"><label for="at">Publish at <small>(Nigerian time; usually an hour before kick-off)</small></label><input id="at" type="datetime-local" value="${esc(localInput(defaultAt))}" ${editable ? '' : 'disabled'} /></div></div>
      <p class="mc-hint" id="saveState"></p>
      <p>${sh.status === 'draft' && editable ? '<button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="confirm">Confirm line-up</button>' : ''}${sh.status === 'confirmed' && editable ? '<button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="reopen">Reopen</button>' : ''} <button class="mc-btn mc-btn-o mc-btn-sm" type="button" id="history">History</button></p>
      <div id="hist" hidden></div><div id="wf"></div>
    </form>`;
    wire();
  };
  const $ = (q: string) => main.querySelector(q) as any;
  const count = () => { const st = sh.rows.filter((r: any) => r.role === 'starter').length; $('#count').textContent = `Starting XI: ${st} of 11 · Substitutes: ${sh.rows.filter((r: any) => r.role === 'sub').length}`; $('#count').style.color = st === 11 ? '' : '#A15C00'; };
  const send = async (changes: any[], baseVersion = sh.version) => {
    $('#saveState').textContent = 'Saving…'; dirty = true;
    try {
      const r = await api('lineup/changes', { method: 'POST', body: { eventId: d.eventId, baseVersion, changes, itemId: id } });
      sh = r.sheet; dirty = false; $('#saveState').textContent = `Saved${r.merged ? ' (merged with changes made by someone else)' : ''}.`; count();
      if (r.merged) draw();
    } catch (x: any) {
      dirty = false;
      if (x.status === 409 && x.data?.conflict) {
        sh = x.data.sheet; draw();
        $('#conflict').innerHTML = `<div class="mc-card" style="border-color:#A15C00"><p><b>${esc(x.data.message || 'Someone else changed this while you were editing.')}</b></p>${(x.data.conflicts || []).map((c: any, i: number) => `<p>${esc(c.label)}: now <b>${esc(c.theirs)}</b>, you chose <b>${esc(c.mine)}</b>. <button type="button" class="mc-btn mc-btn-sm mc-btn-o" data-keep="${i}">Keep theirs</button> <button type="button" class="mc-btn mc-btn-sm" data-mine="${i}">Use mine</button> <small>(or pick another player in the list)</small></p>`).join('')}${(x.data.problems || []).map((p: string) => `<p>${esc(p)}</p>`).join('')}</div>`;
        main.querySelectorAll('[data-keep]').forEach((b: any) => b.addEventListener('click', () => { $('#conflict').innerHTML = ''; }));
        main.querySelectorAll('[data-mine]').forEach((b: any) => b.addEventListener('click', () => { const c = x.data.conflicts[Number(b.dataset.mine)]; const mine = changes.filter(ch => (ch.slug ? `s:${ch.slug}` : ch.op) === c.key); $('#conflict').innerHTML = ''; send(mine, sh.version); }));
      } else { $('#saveState').textContent = x.message; toast(x.message, 8000); if (x.data?.sheet) { sh = x.data.sheet; draw(); } }
    }
  };
  function wire() {
    count();
    $('#f').addEventListener('change', (e: any) => {
      const t = e.target;
      if (t.matches('[data-p]')) send([{ op: 'set', slug: t.dataset.p, role: t.value === 'start' ? 'starter' : t.value === 'sub' ? 'sub' : 'none' }]);
      if (t.id === 'formation') send([{ op: 'formation', value: t.value.trim() }]);
    });
    $('#confirm')?.addEventListener('click', async () => { try { sh = (await api('lineup/confirm', { method: 'POST', body: { eventId: d.eventId } })).sheet; toast('Line-up confirmed. The Statistics Center sees it as the official line-up.'); draw(); } catch (x: any) { toast(x.message, 8000); } });
    $('#reopen')?.addEventListener('click', async () => { try { const r = await api('lineup/reopen', { method: 'POST', body: { eventId: d.eventId } }); sh = r.sheet; if (r.warning) toast(r.warning, 9000); draw(); } catch (x: any) { toast(x.message, 8000); } });
    $('#history').addEventListener('click', async () => {
      const box = $('#hist'); box.hidden = !box.hidden; if (box.hidden) return;
      const { revisions } = await api(`lineup/revisions?eventId=${encodeURIComponent(d.eventId)}`);
      box.innerHTML = `<ul class="mc-list">${revisions.map((r: any) => `<li><div class="t"><b>Version ${r.version}</b><small>${esc(when(r.at))} · ${esc(r.by || '')} · ${esc(r.what || '')}</small></div>${editable && sh.status === 'draft' ? `<button type="button" class="mc-btn mc-btn-o mc-btn-sm" data-restore="${esc(r.id)}">Put this version back</button>` : ''}</li>`).join('') || '<li class="mc-muted">No changes yet.</li>'}</ul>`;
      box.querySelectorAll('[data-restore]').forEach((b: any) => b.addEventListener('click', async () => { if (!confirm('Put this version back? It is saved as a new version; nothing is deleted.')) return; try { sh = (await api('lineup/restore', { method: 'POST', body: { eventId: d.eventId, revisionId: b.dataset.restore, itemId: id } })).sheet; toast('Version put back.'); draw(); } catch (x: any) { toast(x.message, 8000); } }));
    });
    const saverNoop = autosaver(async () => {}, $('#saveState'));
    const wf = workflowButtons(item, editable, { flush: () => saverNoop.flush(), schedule: () => fromLocal($('#at').value), onDone: () => go('/matchday') });
    $('#wf').innerHTML = wf.html; wf.wire($('#wf'));
  }
  draw();
  // Newer versions (every 5 s) and "who is editing" (every 15 s).
  luTimers.push(window.setInterval(async () => {
    if (!document.body.contains(main.querySelector('#f'))) { luTimers.forEach(t => clearInterval(t)); return; }
    try { const v = await api(`lineup/version?eventId=${encodeURIComponent(d.eventId)}`, { quiet: true }); if (v.version !== sh.version && !dirty) { sh = await api(`lineup?eventId=${encodeURIComponent(d.eventId)}`, { quiet: true }); draw(); toast(`Line-up updated by ${v.by || 'someone else'}`); } } catch { /* offline */ }
  }, 5000));
  const beat = async () => { try { const r = await api('lineup/heartbeat', { method: 'POST', body: { eventId: d.eventId }, quiet: true }); const w = main.querySelector('#who') as HTMLElement; if (w) { w.hidden = !r.others.length; w.textContent = r.others.length ? `${r.others.map((o: any) => o.name).join(', ')} ${r.others.length > 1 ? 'are' : 'is'} editing this line-up too (${r.others.map((o: any) => o.page === 'media-matchday' ? 'Media Centre' : 'Statistics Center').join(', ')}).` : ''; } } catch { /* offline */ } };
  beat(); luTimers.push(window.setInterval(beat, 15000));
}
