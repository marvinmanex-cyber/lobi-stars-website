// Media Centre › Interview Requests: from the public form; approve, decline
// with a reason, or propose another time (the journalist is emailed); status
// tracking. Each request is in the media contacts history.
import { api, esc, register, when, toast, go } from './core';

const PILL: Record<string, string> = { new: 'submitted', proposed: 'scheduled', approved: 'published', declined: 'rejected', done: 'draft' };
register({ path: 'interviews', label: 'Interview Requests', icon: '🎤', async render(main) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const d = await api('interviews');
  main.innerHTML = `<div class="mc-page-head"><h1>Interview Requests</h1></div>
    <p class="mc-muted">From the public form at <a href="/media/interview-request/" target="_blank" rel="noopener">lobistarsfc.com/media/interview-request</a>. The journalist is emailed when you approve, decline or propose another time.</p>
    <section class="mc-card">${d.requests.length ? d.requests.map((r: any) => `<article class="mc-acc" data-id="${esc(r.id)}"><div class="mc-acc-body">
      <p><b>${esc(r.fullName)}</b> (${esc(r.organisation)}) <span class="mc-pill ${PILL[r.status]}">${esc(d.statuses[r.status])}</span></p>
      <p class="mc-small"><b>Wants to interview:</b> ${esc(r.who)} · ${esc(d.formats[r.format])} · preferred ${esc(when(r.preferredAt))}${r.proposedAt ? ` · <b>proposed ${esc(when(r.proposedAt))}</b>` : ''}</p>
      <p class="mc-small">${esc(r.topic)}</p>
      <p class="mc-small"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? ` · ${esc(r.phone)}` : ''} · received ${esc(when(r.createdAt))}</p>
      <details class="mc-small"><summary>History</summary><ul>${r.history.map((h: any) => `<li>${esc(when(h.at))}: ${esc(h.note)}</li>`).join('')}</ul></details>
      ${['new', 'proposed'].includes(r.status) ? '<div class="mc-acc-acts"><button class="mc-btn mc-btn-blue mc-btn-sm" type="button" data-do="approve">Approve</button><button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-do="propose">Propose another time</button><button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-do="decline">Decline</button></div>' : r.status === 'approved' ? '<div class="mc-acc-acts"><button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-do="done">Mark as done</button></div>' : ''}
    </div></article>`).join('') : '<p class="mc-empty">No interview requests yet.</p>'}</section>`;
  main.querySelector('section')!.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-do]'); if (!b) return;
    const id = b.closest<HTMLElement>('[data-id]')!.dataset.id, decision = b.dataset.do!;
    const body: any = { id, decision };
    if (decision === 'decline') { body.note = prompt('Reason (emailed to the journalist):') || ''; if (!body.note.trim()) return; }
    if (decision === 'propose') {
      const at = prompt('Proposed date and time (YYYY-MM-DD HH:MM, Nigerian time):', new Date(Date.now() + 2 * 86400e3 + 3600e3).toISOString().slice(0, 16).replace('T', ' '));
      if (!at) return; body.at = at.trim().replace(' ', 'T'); body.note = prompt('Message (optional):') || '';
    }
    if (decision === 'approve') body.note = prompt('Message for the journalist (optional, e.g. where to meet):') || '';
    try { const r = await api('interviews', { method: 'POST', body }); toast(`Done.${r.emailed ? ' The journalist was emailed.' : decision === 'done' ? '' : ' Email is not set up: contact them yourself.'}`, 9000); go('/interviews', true); }
    catch (err: any) { toast(err.message, 9000); }
  });
} });
