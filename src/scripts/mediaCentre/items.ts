// Media Centre: what every content type shares: the list with status tabs,
// autosave, the status banner (returned with comment, waiting, published /
// correction) and the Submit / Withdraw / Delete draft buttons.
import { api, esc, when, statusPill, go, toast, guard, itemPath } from './core';

const TABS: [string, string][] = [['', 'All'], ['draft', 'Drafts'], ['submitted', 'Waiting'], ['returned', 'Returned'], ['scheduled', 'Scheduled'], ['published', 'Published']];

/** The list screen of one kind. */
export async function listScreen(main: HTMLElement, { kind, title, newLabel, intro = '', newData = {} as any, row }: { kind: string; title: string; newLabel: string; intro?: string; newData?: any; row?: (i: any) => string }) {
  let tab = '';
  main.innerHTML = `<div class="mc-page-head"><h1>${esc(title)}</h1><button class="mc-btn mc-btn-red" type="button" id="newItem">+ ${esc(newLabel)}</button></div>${intro}<div class="mc-tabs" id="tabs">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><section class="mc-card"><ul class="mc-list" id="list"><li class="mc-empty">Loading…</li></ul></section>`;
  const draw = async () => {
    const d = await api(`items?kind=${kind}${tab ? `&status=${tab}` : ''}`);
    const list = d.items as any[];
    main.querySelector('#list')!.innerHTML = list.length ? list.map(i => `<li><div class="t"><b>${esc(i.title)}</b><small>${row ? row(i) : `By ${esc(i.createdByName)} · updated ${esc(when(i.updatedAt))}`}</small></div>${statusPill(i)} <a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/${esc(itemPath(i))}/" data-go="/${esc(itemPath(i))}">Open</a></li>`).join('') : '<li class="mc-empty">Nothing here yet.</li>';
  };
  main.querySelector('#tabs')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (!b) return;
    tab = b.dataset.tab!; main.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b)); draw();
  });
  main.querySelector('#newItem')!.addEventListener('click', async () => {
    const d = await api('items', { method: 'POST', body: { kind, data: typeof newData === 'function' ? newData() : newData } });
    go(`/${itemPath({ kind, id: d.id })}`);
  });
  await draw();
}

/** The banner above an editor: where the item is in the workflow, and the comment if it was returned. */
export function statusBanner(item: any, editable: boolean) {
  const parts = [`<p>${statusPill(item)} <small class="mc-muted">Version ${item.version} · last saved ${esc(when(item.updatedAt))} by ${esc(item.updatedByName || item.createdByName)}</small></p>`];
  if ((item.status === 'returned' || item.correction === 'returned') && item.comment) parts.push(`<p class="mc-comment"><b>Returned with a comment:</b> ${esc(item.comment)}</p>`);
  if (item.status === 'rejected' && item.comment) parts.push(`<p class="mc-comment"><b>Rejected:</b> ${esc(item.comment)}</p>`);
  if (item.status === 'submitted' || item.correction === 'submitted') parts.push('<p class="mc-ok">Waiting for approval. You can withdraw it to make more changes.</p>');
  if (item.status === 'published' && !item.correction) parts.push(`<p class="mc-ok">Published${item.publishedAt ? ` ${esc(when(item.publishedAt))}` : ''}. Changes you make now are a <b>correction</b>: the live version stays until the correction is approved.</p>`);
  if (item.status === 'scheduled') parts.push(`<p class="mc-ok">Approved: it will be published ${esc(when(item.scheduledAt))}.</p>`);
  if (item.correction === 'draft') parts.push('<p class="mc-muted mc-small">You have changed the published version. Send the correction for approval when it is ready.</p>');
  if (!editable && item.status === 'unpublished') parts.push('<p class="mc-muted">This was unpublished.</p>');
  return `<div class="mc-card" style="margin:0 0 14px">${parts.join('')}</div>`;
}

/** Autosave: call changed() on every edit; saves 1.5 s after the last change. */
export function autosaver(save: () => Promise<void>, statusEl: HTMLElement) {
  let t = 0, dirty = false, saving: Promise<void> | null = null;
  const run = async () => {
    if (!dirty) return;
    dirty = false; statusEl.textContent = 'Saving…';
    saving = save().then(() => { statusEl.textContent = `Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`; })
      .catch(e => { dirty = true; statusEl.textContent = `Not saved: ${e.message}`; });
    await saving; saving = null;
  };
  guard.dirty = () => dirty;
  return {
    changed() { dirty = true; statusEl.textContent = 'Unsaved changes…'; clearTimeout(t); t = window.setTimeout(run, 1500); },
    async flush() { clearTimeout(t); await run(); if (saving) await saving; if (dirty) throw new Error('Could not save your latest changes.'); },
  };
}

/** Submit / Withdraw / Delete buttons with their handlers. opts.schedule: returns an ISO time or null. */
export function workflowButtons(item: any, editable: boolean, { flush, schedule, onDone, submitLabel = 'Send for approval' }: { flush: () => Promise<void>; schedule?: () => string | null; onDone: () => void; submitLabel?: string }) {
  const html = `<div class="mc-wf">${editable ? `<button class="mc-btn mc-btn-red" type="button" data-wf="submit">${esc(item.status === 'published' || item.status === 'scheduled' ? 'Send correction for approval' : submitLabel)}</button>` : ''}
    ${item.status === 'submitted' || item.correction === 'submitted' ? '<button class="mc-btn mc-btn-o" type="button" data-wf="withdraw">Withdraw (make more changes)</button>' : ''}
    ${['draft', 'returned', 'rejected'].includes(item.status) && !item.publishedAt ? '<button class="mc-btn mc-btn-o" type="button" data-wf="delete_draft">Delete draft</button>' : ''}</div>`;
  const wire = (root: HTMLElement) => root.querySelectorAll<HTMLButtonElement>('[data-wf]').forEach(b => b.addEventListener('click', async () => {
    const action = b.dataset.wf!;
    if (action === 'delete_draft' && !confirm('Delete this draft? This cannot be undone.')) return;
    b.disabled = true;
    try {
      if (action === 'submit') await flush();
      await api(`items/${item.id}`, { method: 'POST', body: { action, scheduledAt: action === 'submit' && schedule ? schedule() : undefined } });
      guard.dirty = () => false;
      toast(action === 'submit' ? 'Sent for approval.' : action === 'withdraw' ? 'Withdrawn: you can change it again.' : 'Draft deleted.');
      onDone();
    } catch (e: any) { toast(e.message, 9000); b.disabled = false; }
  }));
  return { html, wire };
}
