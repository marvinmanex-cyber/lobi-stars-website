// Media Centre › Approval Queue, for the media approver (signed in with the
// approval password; sees only this screen). Open an item, read the preview,
// then Approve, Return (with a comment) or Reject. Recorded as "Media approver".
import { api, esc, when, register, toast, go } from './core';

register({ path: 'approvals', label: 'Approval Queue', icon: '✅', async render(main, parts) {
  if (parts[0]) return detail(main, parts[0]);
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const d = await api('approvals');
  main.innerHTML = `<div class="mc-page-head"><h1>Approval Queue</h1></div>
    <p class="mc-muted">Everything sent for approval from the Media Centre. Open one to read it, then approve, return it with a comment, or reject it.</p>
    <section class="mc-card">${d.items.length ? `<ul class="mc-list">${d.items.map((i: any) => `<li><div class="t"><b>${esc(i.title || 'Untitled')}</b><small>${esc(i.kindLabel)}${i.correction === 'submitted' ? ' · correction' : ''} · sent ${esc(when(i.submittedAt || i.updatedAt))}${i.submittedByName ? ` by ${esc(i.submittedByName)}` : ''}</small></div>
      <a class="mc-btn mc-btn-blue mc-btn-sm" href="/media-centre/approvals/${esc(i.id)}/" data-go="/approvals/${esc(i.id)}">Open</a></li>`).join('')}</ul>` : '<p class="mc-empty">Nothing is waiting for approval. 👍</p>'}</section>`;
} });

async function detail(main: HTMLElement, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const d = await api(`approvals?id=${encodeURIComponent(id)}`);
  const i = d.item;
  const waiting = i.status === 'submitted' || i.correction === 'submitted';
  main.innerHTML = `<div class="mc-page-head"><h1>${esc(i.title || 'Untitled')}</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/approvals/" data-go="/approvals">← Approval Queue</a></div>
    <p class="mc-muted">${esc(i.kindLabel)}${i.correction === 'submitted' ? ' (a correction to a published item)' : ''} · sent ${esc(when(i.submittedAt || i.updatedAt))}${i.submittedByName ? ` by ${esc(i.submittedByName)}` : ''}</p>
    <section class="mc-card">${d.previewHtml || '<p class="mc-muted">No preview for this kind of content.</p>'}</section>
    ${waiting ? `<section class="mc-card" style="margin-top:14px"><div class="mc-field"><label for="apC">Comment (needed to return or reject; the writer sees it)</label><textarea id="apC" rows="3" maxlength="2000"></textarea></div>
      <div class="mc-acc-acts"><button class="mc-btn mc-btn-blue" type="button" data-d="approve">Approve</button><button class="mc-btn mc-btn-o" type="button" data-d="return">Return with comment</button><button class="mc-btn mc-btn-o" type="button" data-d="reject">Reject</button></div></section>`
      : '<p class="mc-ok" style="margin-top:14px">This item has already been decided.</p>'}`;
  main.querySelectorAll<HTMLButtonElement>('[data-d]').forEach(b => b.addEventListener('click', async () => {
    const decision = b.dataset.d!, comment = (main.querySelector('#apC') as HTMLTextAreaElement).value.trim();
    if (decision !== 'approve' && comment.length < 3) { toast('Write a comment for the writer first.'); return; }
    if (!confirm(decision === 'approve' ? 'Approve this? It will be published (or scheduled).' : decision === 'return' ? 'Return this to the writer with your comment?' : 'Reject this?')) return;
    b.disabled = true;
    try {
      const r = await api('approvals', { method: 'POST', body: { id, decision, comment } });
      toast(decision === 'approve' ? (r.note || 'Approved.') : decision === 'return' ? 'Returned to the writer.' : 'Rejected.');
      go('/approvals');
    } catch (e: any) { toast(e.message, 9000); b.disabled = false; }
  }));
}
