// Media Centre: the media desk code. The Approval Queue and the Media Inbox are
// locked until the code is entered (once per session); everyone still sees how
// many emails are waiting. A Super Admin sets the code in the admin.
import { api, state, esc, toast } from './core';

/** Draws the "enter the media desk code" box in place of a locked screen; calls done() once unlocked. */
export function deskGate(main: HTMLElement, title: string, what: string, done: () => void, unread?: number) {
  main.innerHTML = `<div class="mc-page-head"><h1>${esc(title)}</h1></div>
    <section class="mc-card mc-desk">
      <div class="mc-desk-ico" aria-hidden="true">🔒</div>
      <h2 class="mc-h3">Enter the media desk code</h2>
      <p class="mc-muted">${esc(what)} The code is given by a Super Admin. It unlocks the Approval Queue and the Media Inbox until you sign out.</p>
      ${unread ? `<p class="mc-pill submitted" style="display:inline-block">${unread} unread email${unread === 1 ? '' : 's'} waiting</p>` : ''}
      <form class="mc-desk-form" novalidate><div class="mc-field"><label for="deskCode">Media desk code</label>
        <div class="mc-pw"><input id="deskCode" type="password" autocomplete="off" required /><button type="button" class="mc-btn mc-btn-o" data-show="deskCode">Show</button></div></div>
        <p class="mc-alert" role="alert" hidden></p>
        <button class="mc-btn mc-btn-blue" type="submit">Unlock</button></form>
    </section>`;
  const f = main.querySelector('form') as HTMLFormElement, err = f.querySelector('.mc-alert') as HTMLElement, input = f.querySelector('input') as HTMLInputElement;
  (f.querySelector('[data-show]') as HTMLButtonElement).addEventListener('click', e => { input.type = input.type === 'password' ? 'text' : 'password'; (e.target as HTMLElement).textContent = input.type === 'password' ? 'Show' : 'Hide'; });
  input.focus();
  f.addEventListener('submit', async e => {
    e.preventDefault(); err.hidden = true;
    try {
      await api('desk', { method: 'POST', body: { code: input.value } });
      state.user.desk = true;
      toast('Unlocked: the Approval Queue and the Media Inbox are open until you sign out.');
      done();
    } catch (ex: any) { err.textContent = ex.message; err.hidden = false; input.select(); }
  });
}

/** Locks them again (button on both screens). */
export async function lockDesk() {
  try { await api('desk', { method: 'DELETE' }); } catch { /* signed out anyway */ }
  state.user.desk = false;
}

/** Unread emails for the menu badge (every user). */
export async function unreadEmails(): Promise<number> {
  try { return (await api('inbox?count=1', { quiet: true })).unread || 0; } catch { return 0; }
}
