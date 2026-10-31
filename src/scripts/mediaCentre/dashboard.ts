// Media Centre home: returned to me (with the Super Admin's comment), waiting
// for approval, my drafts, upcoming deadlines, recently published.
import { esc, when, day, api, register, statusPill, itemPath } from './core';

// ── Dashboard ──
register({ path: '', label: 'Dashboard', icon: '🏠', async render(main) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const d = await api('dashboard');
  const li = (i: any) => `<li><div class="t"><b>${esc(i.title)}</b><small>${esc(i.kindLabel)} · ${esc(when(i.updatedAt))}</small></div>${statusPill(i)} <a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/${esc(itemPath(i))}/" data-go="/${esc(itemPath(i))}">Open</a>${i.comment && (i.status === 'returned' || i.correction === 'returned') ? `<p class="mc-comment"><b>Comment from ${esc(i.decidedBy || 'the Super Admin')}:</b> ${esc(i.comment)}</p>` : ''}</li>`;
  const box = (title: string, list: any[], empty: string, extra = '') => `<section class="mc-card"><h2 class="mc-h3">${title} <span class="mc-pill">${list.length}</span></h2>${extra}${list.length ? `<ul class="mc-list">${list.map(li).join('')}</ul>` : `<p class="mc-empty">${empty}</p>`}</section>`;
  const deadlines = (d.deadlines || []).map((x: any) => `<li><div class="t"><b>${esc(x.title)}</b><small>${x.due ? `Due ${esc(when(x.due))}` : ''}${x.state ? ` · ${esc(x.state)}` : ''}</small></div></li>`).join('');
  main.innerHTML = `<div class="mc-page-head"><h1>Welcome, ${esc(d.user.fullName.split(' ')[0])}</h1></div>
    <div class="mc-grid two">
      ${box('Returned to me', d.returned, 'Nothing returned. 👍', d.returned.length ? '<p class="mc-small mc-muted">A Super Admin sent these back with a comment. Make the changes and send again.</p>' : '')}
      ${box('Waiting for approval', d.waiting, 'Nothing waiting.')}
      ${box('My drafts', d.drafts, 'No drafts.')}
      <section class="mc-card"><h2 class="mc-h3">Upcoming deadlines</h2>${deadlines ? `<ul class="mc-list">${deadlines}</ul>` : '<p class="mc-empty">No deadlines.</p>'}</section>
    </div>
    <section class="mc-card" style="margin-top:14px"><h2 class="mc-h3">Recently published</h2>${d.published.length ? `<ul class="mc-list">${d.published.map((i: any) => `<li><div class="t"><b>${esc(i.title)}</b><small>${esc(i.kindLabel)} · ${i.status === 'scheduled' ? `scheduled for ${esc(when(i.scheduledAt))}` : esc(day(i.publishedAt))}</small></div>${statusPill(i)}</li>`).join('')}</ul>` : '<p class="mc-empty">Nothing published from the Media Centre yet.</p>'}</section>`;
} });

