// Media Centre › Media Inbox: emails to media@lobistarsfc.com. Read, reply and
// write new emails from media@ (signed "Lobi Stars FC Media"). Locked behind the
// media desk code; everyone sees the unread count.
import { api, esc, when, register, toast, go, state, ApiError } from './core';
import { deskGate, lockDesk } from './desk';

const locked = (main: HTMLElement, again: () => void, unread?: number) =>
  deskGate(main, 'Media Inbox', 'Emails sent to media@lobistarsfc.com can only be read and answered with the media desk code.', again, unread);

register({ path: 'inbox', label: 'Media Inbox', icon: '📧', async render(main, parts) {
  const again = () => go(`/inbox${parts[0] ? `/${parts[0]}` : ''}`, true);
  if (!state.user.desk) { let n = 0; try { n = (await api('inbox?count=1', { quiet: true })).unread; } catch { /* */ } return locked(main, again, n); }
  try {
    if (parts[0] === 'new') return composeScreen(main);
    if (parts[0]) return threadScreen(main, parts[0]);
    return listScreen(main);
  } catch (e) {
    if (e instanceof ApiError && e.data?.locked) { state.user.desk = false; return locked(main, again, e.data.unread); }
    throw e;
  }
} });

function head(title: string, extra = '') {
  return `<div class="mc-page-head"><h1>${esc(title)}</h1><div class="mc-head-acts">${extra}${state.user.approver || state.user.admin ? '' : '<button type="button" class="mc-btn mc-btn-o mc-btn-sm" data-lock>Lock</button>'}</div></div>`;
}
function wireLock(main: HTMLElement) {
  main.querySelector('[data-lock]')?.addEventListener('click', async () => { await lockDesk(); toast('Locked. The media desk code is needed again.'); go('/inbox', true); });
}

async function listScreen(main: HTMLElement) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const d = await api('inbox');
  main.innerHTML = `${head('Media Inbox', '<a class="mc-btn mc-btn-blue mc-btn-sm" href="/media-centre/inbox/new/" data-go="/inbox/new">New email</a> ')}
    <p class="mc-muted">Emails sent to <b>${esc(d.mailbox)}</b>. Replies and new emails go out from ${esc(d.mailbox)}, signed "Lobi Stars FC Media".</p>
    <section class="mc-card">${d.threads.length ? `<ul class="mc-list mc-mail">${d.threads.map((t: any) => `<li class="${t.unread ? 'unread' : ''}">
      <div class="t"><b>${t.unread ? '<span class="mc-dot" aria-label="unread"></span>' : ''}${esc(t.name)}</b><small>${esc(t.subject)} · ${esc(when(t.at))}</small><small class="mc-prev">${esc(t.preview)}</small></div>
      <span class="mc-pill ${t.status === 'replied' ? 'published' : t.unread ? 'submitted' : ''}">${t.status === 'replied' ? 'Replied' : t.unread ? 'New' : 'Read'}</span>
      <a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/inbox/${esc(t.id)}/" data-go="/inbox/${esc(t.id)}">Open</a></li>`).join('')}</ul>` : '<p class="mc-empty">No emails yet. Emails sent to media@lobistarsfc.com appear here.</p>'}</section>`;
  wireLock(main);
}

async function threadScreen(main: HTMLElement, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const { thread: t } = await api(`inbox?id=${encodeURIComponent(id)}`);
  main.innerHTML = `${head(t.subject, '<a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/inbox/" data-go="/inbox">← All emails</a> ')}
    <p class="mc-muted">${esc(t.name)} &lt;${esc(t.email)}&gt; · reference ${esc(t.ref)}</p>
    <div class="mc-thread">${t.messages.map((m: any) => `<article class="mc-msg ${m.direction}"><p class="mc-msg-h"><b>${esc(m.author)}</b> <small>${esc(when(m.at))}${m.direction === 'out' && m.delivery === 'not_sent' ? ' · not emailed (email service not set up)' : ''}</small></p><div class="mc-msg-b">${m.html}</div></article>`).join('')}</div>
    <section class="mc-card" style="margin-top:14px"><form class="mc-reply" novalidate>
      <div class="mc-field"><label for="rp">Reply to ${esc(t.name)}</label><textarea id="rp" rows="7" maxlength="20000" placeholder="Write your reply…"></textarea></div>
      <button class="mc-btn mc-btn-blue" type="submit">Send reply from media@lobistarsfc.com</button></form></section>`;
  wireLock(main);
  const f = main.querySelector('.mc-reply') as HTMLFormElement;
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const text = (f.querySelector('textarea') as HTMLTextAreaElement).value.trim();
    if (text.length < 2) { toast('Write your reply first.'); return; }
    const b = f.querySelector('button') as HTMLButtonElement; b.disabled = true;
    try { const r = await api('inbox', { method: 'POST', body: { action: 'reply', id, text } }); toast(r.emailed ? `Reply sent to ${r.to}.` : 'Saved, but not emailed: the email service is not set up yet.'); go(`/inbox/${id}`, true); }
    catch (ex: any) { toast(ex.message, 9000); b.disabled = false; }
  });
}

function composeScreen(main: HTMLElement) {
  main.innerHTML = `${head('New email', '<a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/inbox/" data-go="/inbox">← All emails</a> ')}
    <section class="mc-card"><form class="mc-compose" novalidate>
      <p class="mc-muted">Sent from <b>media@lobistarsfc.com</b>, signed "Lobi Stars FC Media". The answer comes back into the Media Inbox.</p>
      <div class="mc-grid two"><div class="mc-field"><label for="cTo">To (email)</label><input id="cTo" type="email" maxlength="254" required /></div>
      <div class="mc-field"><label for="cName">Name <small>(optional)</small></label><input id="cName" maxlength="80" /></div></div>
      <div class="mc-field"><label for="cSub">Subject</label><input id="cSub" maxlength="200" required /></div>
      <div class="mc-field"><label for="cText">Message</label><textarea id="cText" rows="10" maxlength="20000" required></textarea></div>
      <button class="mc-btn mc-btn-blue" type="submit">Send email</button></form></section>`;
  wireLock(main);
  const f = main.querySelector('.mc-compose') as HTMLFormElement;
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = (id: string) => (main.querySelector(`#${id}`) as HTMLInputElement).value.trim();
    const b = f.querySelector('button') as HTMLButtonElement; b.disabled = true;
    try { const r = await api('inbox', { method: 'POST', body: { action: 'compose', to: v('cTo'), name: v('cName'), subject: v('cSub'), text: v('cText') } }); toast(r.emailed ? `Email sent to ${r.to}.` : 'Saved, but not emailed: the email service is not set up yet.'); go(`/inbox/${r.id}`, true); }
    catch (ex: any) { toast(ex.message, 9000); b.disabled = false; }
  });
}
