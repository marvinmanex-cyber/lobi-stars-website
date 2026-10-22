// Squad & Staff Data Portal: sign in, the signed-in shell and the inactivity
// sign-out (60 minutes without activity, with a 2-minute warning).
import { api, state, $, toast, ApiError } from './api';
import { showHome } from './home';
import { startForms } from './form';

const IDLE_MS = 60 * 60e3, WARN_MS = 2 * 60e3;
let lastActivity = Date.now(), lastPing = Date.now(), idleTimer = 0, warnTimer = 0;
declare global { interface Window { turnstile?: any } }

function showSignIn(message?: string) {
  $('portal').hidden = true; $('idleWarn').hidden = true; $('signin').hidden = false;
  clearInterval(idleTimer);
  document.title = 'Sign in | Squad & Staff Data Portal';
  if (message) { $('signinMsg').textContent = message; $('signinMsg').hidden = false; }
  refreshStatus();
}

async function refreshStatus() {
  try {
    const s = await (await fetch('/api/squad-portal/status', { cache: 'no-store' })).json();
    const btn = $<HTMLButtonElement>('siBtn');
    if (!s.open) { $('signinMsg').textContent = 'The portal is currently closed.'; $('signinMsg').hidden = false; btn.disabled = true; return; }
    btn.disabled = false;
    if (s.locked) { const m = Math.max(1, Math.ceil((Date.parse(s.lockedUntil) - Date.now()) / 60000)); $('signinMsg').textContent = `Too many wrong passwords. The sign-in is locked for ${m} more minute${m === 1 ? '' : 's'}.`; $('signinMsg').hidden = false; }
    if (s.needTurnstile) showTurnstile();
  } catch { /* offline: the form still works when the connection returns */ }
}

let turnstileOn = false;
function showTurnstile() {
  const key = $('app').dataset.turnstile;
  if (!key || turnstileOn) return;
  turnstileOn = true;
  const box = $('siTurnstile'); box.hidden = false;
  const draw = () => window.turnstile?.render(box, { sitekey: key });
  if (window.turnstile) return draw();
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = draw;
  document.head.append(s);
}

async function signedIn() {
  $('signin').hidden = true; $('portal').hidden = false;
  $('whoName').textContent = state.name;
  document.title = 'Squad & Staff Data Portal | Lobi Stars FC';
  lastActivity = Date.now();
  clearInterval(idleTimer); idleTimer = window.setInterval(checkIdle, 15000);
  startForms();
  await showHome();
}

function checkIdle() {
  const idle = Date.now() - lastActivity;
  if (idle >= IDLE_MS) { signOut('idle'); return; }
  if (idle >= IDLE_MS - WARN_MS) {
    if ($('idleWarn').hidden) { $('idleWarn').hidden = false; $('idleStay').focus(); clearInterval(warnTimer); warnTimer = window.setInterval(tickWarn, 1000); tickWarn(); }
  }
}
function tickWarn() {
  const left = Math.max(0, IDLE_MS - (Date.now() - lastActivity));
  $('idleLeft').textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  if (left <= 0) { clearInterval(warnTimer); signOut('idle'); }
}
/** Something happened: the inactivity clock restarts (the server is told at most every 5 minutes). */
export function activity() {
  lastActivity = Date.now();
  if ($('portal').hidden || !$('idleWarn').hidden) return;
  if (Date.now() - lastPing > 5 * 60e3) { lastPing = Date.now(); api('session', { method: 'POST' }).catch(() => {}); }
}

async function signOut(why?: string) {
  clearInterval(warnTimer); clearInterval(idleTimer);
  try { await fetch('/api/squad-portal/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ why }), credentials: 'same-origin' }); } catch { /* offline */ }
  state.csrf = ''; state.name = '';
  showSignIn(why === 'idle' ? 'You were signed out after 60 minutes without activity. Your saved answers are kept.' : undefined);
}

export function startPortal() {
  state.onSignedOut = (msg?: string) => showSignIn(msg || 'Please sign in again.');
  for (const ev of ['pointerdown', 'keydown', 'input', 'touchstart']) document.addEventListener(ev, activity, { passive: true, capture: true });
  $('idleStay').addEventListener('click', async () => {
    clearInterval(warnTimer); $('idleWarn').hidden = true; lastActivity = Date.now(); lastPing = Date.now();
    try { await api('session', { method: 'POST' }); } catch { /* handled */ }
  });
  $('signOut').addEventListener('click', () => signOut());
  $('siShow').addEventListener('click', () => {
    const p = $<HTMLInputElement>('siPass'), show = p.type === 'password';
    p.type = show ? 'text' : 'password'; $('siShow').textContent = show ? 'Hide' : 'Show'; $('siShow').setAttribute('aria-pressed', String(show));
  });
  $('siForgot').addEventListener('click', () => {
    const box = $('forgotBox'), open = box.hidden;
    box.hidden = !open; $('siForgot').setAttribute('aria-expanded', String(open));
    if (open) ($('siName') as HTMLInputElement).value.trim() ? $('fgContact').focus() : $('siName').focus();
  });
  $('fgBtn').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('fgBtn'), msg = $('fgMsg');
    const name = $<HTMLInputElement>('siName').value.trim(), contact = $<HTMLInputElement>('fgContact').value.trim();
    const show = (t: string, ok: boolean) => { msg.textContent = t; msg.classList.toggle('sp-ok', ok); msg.hidden = false; };
    if (!name) { show('Please enter your name in "Your name" above.', false); $('siName').focus(); return; }
    if (!contact) { show('Please enter your WhatsApp number or email.', false); $('fgContact').focus(); return; }
    btn.disabled = true;
    try {
      const turnstile = (document.querySelector('#signinForm [name="cf-turnstile-response"]') as HTMLInputElement | null)?.value || '';
      const r = await fetch('/api/squad-portal/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ name, contact, turnstile }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { show(d.error || 'The request could not be sent. Please try again.', false); if (d.needTurnstile) showTurnstile(); return; }
      show('Request sent. A Super Admin will send you the new password on WhatsApp or in person.', true);
    } catch { show('No connection. Please try again when you are online.', false); }
    finally { btn.disabled = false; }
  });
  $('signinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target as HTMLFormElement, btn = $<HTMLButtonElement>('siBtn');
    const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim();
    for (const [n, label] of [['username', 'your username'], ['password', 'the password'], ['name', 'your name']]) {
      if (!val(n)) { $('signinMsg').textContent = `Please enter ${label}.`; $('signinMsg').hidden = false; (f.elements.namedItem(n) as HTMLInputElement).focus(); return; }
    }
    btn.disabled = true; btn.textContent = 'SIGNING IN…'; $('signinMsg').hidden = true;
    try {
      const turnstile = (f.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value || '';
      const r = await fetch('/api/squad-portal/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ username: val('username'), password: (f.elements.namedItem('password') as HTMLInputElement).value, name: val('name'), turnstile }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        $('signinMsg').textContent = d.error || 'Could not sign in.'; $('signinMsg').hidden = false;
        if (d.needTurnstile) { showTurnstile(); try { window.turnstile?.reset(); } catch { /* not drawn yet */ } }
        if (d.field === 'name') $('siName').focus();
        return;
      }
      state.csrf = d.csrf; state.name = d.name;
      (f.elements.namedItem('password') as HTMLInputElement).value = '';
      const s = await api('session');
      state.season = s.season;
      await signedIn();
    } catch (err) {
      $('signinMsg').textContent = err instanceof ApiError ? err.message : 'No connection. Please try again.'; $('signinMsg').hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'SIGN IN'; }
  });
  // Already signed in (page reloaded)?
  (async () => {
    try {
      const r = await fetch('/api/squad-portal/session', { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok) { const s = await r.json(); state.csrf = s.csrf; state.name = s.name; state.season = s.season; await signedIn(); return; }
    } catch { /* offline */ }
    showSignIn();
  })();
}
export { toast };
