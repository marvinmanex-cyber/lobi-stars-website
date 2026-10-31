// Media Centre › Content Calendar: match days, newsletter Wednesdays and the
// stories the team plans, assigned to a person with a due date and a status.
import { api, esc, register, toast, go } from './core';

const day = (iso: string) => new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 10);
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

register({ path: 'calendar', label: 'Content Calendar', icon: '📅', async render(main, parts) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(parts[0] || '') ? parts[0] : new Date(Date.now() + 3600e3 - ((new Date(Date.now() + 3600e3).getUTCDay() + 6) % 7) * 86400e3).toISOString().slice(0, 10);
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + 27 * 86400e3).toISOString().slice(0, 10);
  const d = await api(`calendar?from=${start}&to=${end}`);
  const byDay: Record<string, string[]> = {};
  const push = (k: string, html: string) => { (byDay[k] ||= []).push(html); };
  for (const m of d.matches) push(day(m.at), `<div class="mc-cal-ev"><span class="tag match">Match</span><b>${esc(m.title)}</b> ${esc(time(m.at))}${m.home ? ' · home' : ''}</div>`);
  for (const w of d.wednesdays) push(day(w.at), `<div class="mc-cal-ev"><span class="tag newsletter">Newsletter</span>${esc(w.title)} ${esc(time(w.at))}</div>`);
  const undated: string[] = [];
  for (const p of d.planned) {
    const html = `<div class="mc-cal-ev" data-id="${esc(p.id)}"><span class="tag">${esc(d.types[p.type] || p.type)}</span><b>${esc(p.title)}</b> · ${esc(p.assignee || 'unassigned')} · <span class="mc-pill ${p.status === 'published' ? 'published' : p.status === 'waiting' ? 'submitted' : 'draft'}">${esc(d.statuses[p.status])}</span>${p.at ? ` <small>due ${esc(time(p.at))}</small>` : ''} <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-edit="${esc(p.id)}">Edit</button></div>`;
    if (p.at) push(day(p.at), html); else undated.push(html);
  }
  const today = day(new Date().toISOString());
  const days = Array.from({ length: 28 }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400e3).toISOString().slice(0, 10));
  const prev = new Date(Date.parse(`${start}T00:00:00Z`) - 28 * 86400e3).toISOString().slice(0, 10), next = new Date(Date.parse(`${start}T00:00:00Z`) + 28 * 86400e3).toISOString().slice(0, 10);
  main.innerHTML = `<div class="mc-page-head"><h1>Content Calendar</h1><button class="mc-btn mc-btn-red" type="button" id="new">+ Plan something</button></div>
    <p><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/calendar/${prev}/" data-go="/calendar/${prev}">← Earlier</a> <b>${esc(fmtDay(start))} – ${esc(fmtDay(end))}</b> <a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/calendar/${next}/" data-go="/calendar/${next}">Later →</a></p>
    <dialog class="mc-lib" id="dlg"><form method="dialog" class="mc-card" id="ef" style="border:0">
      <h2 class="mc-h3" id="dlgT">Plan something</h2><input type="hidden" name="entryId" />
      <div class="mc-field"><label>What<input name="what" maxlength="160" required /></label></div>
      <div class="mc-grid two"><div class="mc-field"><label>Type<select name="type">${Object.entries(d.types).map(([k, l]) => `<option value="${k}">${esc(l as string)}</option>`).join('')}</select></label></div>
      <div class="mc-field"><label>Assigned to<select name="assigneeId"><option value="">Nobody yet</option>${d.users.map((u: any) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></label></div>
      <div class="mc-field"><label>Due<input name="dueAt" type="datetime-local" /></label></div>
      <div class="mc-field"><label>Status<select name="status">${Object.entries(d.statuses).map(([k, l]) => `<option value="${k}">${esc(l as string)}</option>`).join('')}</select></label></div></div>
      <div class="mc-field"><label>Notes<textarea name="notes" rows="3" maxlength="1000"></textarea></label></div>
      <div class="mc-wf"><button class="mc-btn mc-btn-red" value="save">Save</button><button class="mc-btn mc-btn-o" value="cancel" formnovalidate>Cancel</button><button class="mc-btn mc-btn-o" value="delete" formnovalidate id="del">Delete</button></div>
    </form></dialog>
    ${undated.length ? `<section class="mc-card" style="margin:0 0 12px"><h2 class="mc-h3">No date yet</h2>${undated.join('')}</section>` : ''}
    <div class="mc-cal">${days.map(k => `<section class="mc-cal-day${k === today ? ' today' : ''}"><h3>${esc(fmtDay(k))}</h3>${(byDay[k] || []).join('') || '<p class="mc-empty mc-small" style="margin:0">—</p>'}</section>`).join('')}</div>`;
  const dlg = main.querySelector('#dlg') as HTMLDialogElement, f = main.querySelector('#ef') as HTMLFormElement & Record<string, any>;
  const open = (p: any = null) => {
    f.reset(); f.entryId.value = p?.id || ''; (main.querySelector('#dlgT') as HTMLElement).textContent = p ? 'Edit' : 'Plan something';
    if (p) { f.what.value = p.title; f.type.value = p.type; f.assigneeId.value = p.assigneeId || ''; f.status.value = p.status; f.notes.value = p.notes || ''; if (p.at) f.dueAt.value = new Date(Date.parse(p.at) + 3600e3).toISOString().slice(0, 16); }
    (main.querySelector('#del') as HTMLElement).hidden = !p; dlg.showModal();
  };
  main.querySelector('#new')!.addEventListener('click', () => open());
  main.querySelectorAll<HTMLElement>('[data-edit]').forEach(b => b.addEventListener('click', () => open(d.planned.find((p: any) => p.id === b.dataset.edit))));
  dlg.addEventListener('close', async () => {
    if (!['save', 'delete'].includes(dlg.returnValue)) return;
    const body: any = dlg.returnValue === 'delete' ? { action: 'delete', id: f.entryId.value } : { id: f.entryId.value || undefined, title: f.what.value, type: f.type.value, assigneeId: f.assigneeId.value, status: f.status.value, notes: f.notes.value, dueAt: f.dueAt.value ? new Date(`${f.dueAt.value}:00+01:00`).toISOString() : null };
    if (dlg.returnValue === 'delete' && !confirm('Delete this plan?')) return;
    try { await api('calendar', { method: 'POST', body }); toast('Saved.'); go(`/calendar/${start}`, true); } catch (err: any) { toast(err.message, 9000); }
  });
} });
