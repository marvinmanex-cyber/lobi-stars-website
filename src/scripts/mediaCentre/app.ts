// Media Centre: sign-in, the required password change, the 30-minute idle
// sign-out, the menu and the dashboard. Each section adds its own screen
// (register() in its file).
import { state, $, esc, api, ApiError, toast, SCREENS, go, setRouteHandler, setSignedOutHandler, guard } from './core';
import './sections';

// ── Router ──
// The media approver (approval password) sees only the Approval Queue; nobody else sees it.
const visible = () => SCREENS.filter(s => s.nav !== false && (state.user?.approver ? s.path === 'approvals' : state.user?.admin || s.path !== 'approvals'));
function nav(active: string) {
  $('nav').innerHTML = visible().map(s => `<a href="/media-centre/${s.path ? `${s.path}/` : ''}" data-go="/${s.path}" class="${s.path === active ? 'on' : ''}"><span aria-hidden="true">${s.icon}</span>${esc(s.label)}</a>`).join('');
}
async function route() {
  if (!state.user) return;
  const parts = location.pathname.replace(/^\/media-centre\/?/, '').split('/').filter(Boolean);
  const list = visible();
  const screen = list.find(s => s.path === (parts[0] || '')) || list[0];
  if (state.user.approver && parts[0] !== 'approvals') parts.splice(0, parts.length, 'approvals');
  guard.dirty = () => false;
  nav(screen.path);
  $('nav').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false');
  const main = $('main') as HTMLElement;
  document.title = `${screen.label} | Media Centre | Lobi Stars FC`;
  try { await screen.render(main, parts.slice(1)); }
  catch (e) { if (!(e instanceof ApiError && e.status === 401)) main.innerHTML = `<p class="mc-alert">${esc(e instanceof Error ? e.message : 'Something went wrong.')}</p>`; }
  main.focus({ preventScroll: true }); window.scrollTo(0, 0);
}
setRouteHandler(route);
window.addEventListener('popstate', () => route());
document.addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
  if (!a || (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) return;
  e.preventDefault();
  if (guard.dirty() && !confirm('You have changes that are not saved yet. Leave anyway?')) return;
  go(a.dataset.go!);
});
$('menuBtn').addEventListener('click', () => { const open = $('nav').classList.toggle('open'); $('menuBtn').setAttribute('aria-expanded', String(open)); });

// ── Screens: sign in / password / app ──
function show(which: 'signin' | 'changepw' | 'shell') {
  for (const id of ['signin', 'changepw', 'shell']) $(id).hidden = id !== which;
}
function signedOut(message?: string) {
  if (message === 'password') { show('changepw'); return; }
  state.user = null; state.csrf = '';
  if (location.pathname !== '/media-centre/login/') history.replaceState(null, '', '/media-centre/login/');
  show('signin');
  const m = $('signinMsg'); m.hidden = !message; m.textContent = message || '';
  $('siId').focus();
}
setSignedOutHandler(signedOut);
async function start() {
  let s: any;
  try { s = await fetch('/api/media-centre/session', { cache: 'no-store' }).then(r => r.json()); } catch { s = { signedIn: false }; }
  state.idleMs = s.idleMs || state.idleMs;
  if (!s.signedIn) { signedOut(); return; }
  enter(s);
}
function enter(s: any) {
  state.user = s.user; state.csrf = s.csrf;
  if (s.user.mustChange) { show('changepw'); $('pwCur').focus(); return; }
  show('shell');
  $('who').innerHTML = s.user.approver ? 'Media approver' : s.user.admin ? `${esc(s.user.fullName)} <small>(Super Admin)</small>` : `${esc(s.user.fullName)} <small>(${esc(s.user.loginId)})</small>`;
  if (location.pathname === '/media-centre/login/') history.replaceState(null, '', '/media-centre/');
  bumpIdle();
  route();
}
document.querySelectorAll<HTMLButtonElement>('[data-show]').forEach(b => b.addEventListener('click', () => { const i = $(b.dataset.show!); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Show' : 'Hide'; }));
$('signinForm').addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  const m = $('signinMsg'), btn = (e.target as HTMLFormElement).querySelector('button[type=submit]') as HTMLButtonElement;
  const loginId = $('siId').value.trim(), password = $('siPw').value;
  const approver = !$('siIdWrap').hidden ? false : true;
  const isEmail = loginId.includes('@');
  if (!approver && !isEmail && !/^[A-Za-z]{2,30}[0-9]{2,4}$/.test(loginId)) { m.textContent = 'Your Login ID is your name followed by 2 to 4 digits, e.g. Iorbee68.'; m.hidden = false; return; }
  btn.disabled = true;
  try {
    const r = await fetch('/api/media-centre/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(approver ? { approver: true, password } : { loginId, password, code: $('siCode').value.trim() || undefined }), credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (d.needCode) { $('siCodeWrap').hidden = false; $('siCode').focus(); }
    if (!r.ok) { m.textContent = d.error || 'Could not sign in.'; m.hidden = false; return; }
    $('siPw').value = ''; m.hidden = true;
    enter(d);
  } catch { m.textContent = 'No connection. Please try again.'; m.hidden = false; }
  finally { btn.disabled = false; }
});
// Approver sign-in: the approval password only (no Login ID).
$('siApprover').addEventListener('click', () => {
  const toApprover = !$('siIdWrap').hidden;
  $('siIdWrap').hidden = toApprover;
  $('siTitle').textContent = toApprover ? 'Approver sign-in' : 'Sign in';
  ($('siPwLabel') as HTMLElement).textContent = toApprover ? 'Approval password' : 'Password';
  $('siApprover').textContent = toApprover ? 'Sign in with your Login ID instead' : 'Approver sign-in';
  $('signinMsg').hidden = true;
  (toApprover ? $('siPw') : $('siId')).focus();
});
$('pwForm').addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  const m = $('pwMsg'), a = $('pwNew').value, b = $('pwNew2').value;
  if (a.length < 8) { m.textContent = 'The new password must have at least 8 characters.'; m.hidden = false; return; }
  if (a !== b) { m.textContent = 'The two new passwords are not the same.'; m.hidden = false; return; }
  try {
    await api('password', { method: 'POST', body: { current: $('pwCur').value, password: a } });
    for (const id of ['pwCur', 'pwNew', 'pwNew2']) $(id).value = '';
    m.hidden = true;
    const s = await fetch('/api/media-centre/session', { cache: 'no-store' }).then(r => r.json());
    toast('Your password is saved.');
    enter(s);
  } catch (err) { m.textContent = err instanceof Error ? err.message : 'Could not save.'; m.hidden = false; }
});
async function signOutNow(why?: string) {
  try { await api('logout', { method: 'POST', body: { why } }); } catch { /* signed out anyway */ }
  signedOut(why === 'idle' ? 'You were signed out after 30 minutes without activity.' : 'You are signed out.');
}
$('signOut').addEventListener('click', () => { if (guard.dirty() && !confirm('You have changes that are not saved yet. Sign out anyway?')) return; signOutNow(); });
$('pwOut').addEventListener('click', () => signOutNow());

// ── 30 minutes without activity: signed out (the server ends the session too) ──
let idleT = 0, lastBump = 0;
function bumpIdle() {
  const now = Date.now();
  if (now - lastBump < 5000) return;
  lastBump = now;
  clearTimeout(idleT);
  idleT = window.setTimeout(() => { if (state.user) signOutNow('idle'); }, state.idleMs);
}
for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.addEventListener(ev, () => { if (state.user) bumpIdle(); }, { passive: true });
// Keep the server session alive while the person is active on this page (a quiet check otherwise).
setInterval(() => { if (state.user && Date.now() - lastBump < 5 * 60e3) fetch('/api/media-centre/session', { cache: 'no-store' }).catch(() => {}); }, 5 * 60e3);
// Editor forms never submit (they save as you type); Enter in a field must not reload the page.
document.addEventListener('submit', e => { const f = e.target as HTMLFormElement; if (f.closest('#main') && f.method !== 'dialog') e.preventDefault(); });
window.addEventListener('beforeunload', e => { if (guard.dirty()) { e.preventDefault(); e.returnValue = ''; } });

start();
