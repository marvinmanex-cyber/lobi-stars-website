// MatchDay Kitchen home screen: sign-in, the ticket rail, pages opened as tabs
// inside this browser tab (iframes of the panel page), the clock, and the
// shared-tablet idle sign-out ("Still there?" after 20 minutes without a tap,
// then a 60-second countdown). Inner pages report taps through window.mkShell.
import { $, esc, api, session, loadSession, setSignedOutHandler, GROUPS, whatsappUrl, WA_PATH, TG_PATH, iconFor, pageTitle, hm } from './common';
import { startAlarms, stopAlarms, alarmsNow } from './alarm';

const IDLE_MS = 20 * 60e3, COUNTDOWN = 60, MAX_TABS = 6, SAVE_KEY = 'mdk_tabs';
type TabRec = { page: string; frame: HTMLIFrameElement; shownAt: number };
const tabs: TabRec[] = [];
let current = '';                       // '' = Home
let lastActivity = Date.now(), lastPing = Date.now(), idleTimer = 0, countdown = 0, started = false;
// App shortcuts (press and hold the app icon): /matchday-kitchen/?open=kitchen|live|orders|menu.
const SHORTCUTS = ['kitchen', 'live', 'orders', 'menu'];
let wantOpen = new URLSearchParams(location.search).get('open') || '';

// ── Sign in: kitchen staff type their login code; Super Admins can switch to their website email ──
let adminMode = false;
$('modeBtn').addEventListener('click', () => {
  adminMode = !adminMode;
  $('adminFields').hidden = !adminMode; $('codeFields').hidden = adminMode;
  $('modeBtn').textContent = adminMode ? 'Kitchen staff? Sign in with your login code' : 'Super Admin? Sign in with your website email';
  $('signinNote').textContent = adminMode ? 'This signs you in to MatchDay Kitchen only.' : "Everything you do in the kitchen is recorded under your name. Don't share your login code.";
  $('signinErr').hidden = true;
  $(adminMode ? 'login' : 'loginCode').focus();
});
$('loginCode').addEventListener('input', () => { const d = $('loginCode').value.replace(/\D/g, '').slice(0, 8); $('loginCode').value = d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d; });
function showSignin(msg = '') {
  $('app').hidden = true; $('idle').hidden = true; $('signin').hidden = false;
  closeAllTabs(false);
  document.title = 'Sign in | MatchDay Kitchen | Lobi Stars FC';
  if (location.pathname !== '/matchday-kitchen/login/') history.replaceState(null, '', '/matchday-kitchen/login/');
  $('signinMsg').textContent = msg; $('signinMsg').hidden = !msg;
  $('password').value = ''; $('loginCode').value = '';
  setTimeout(() => $(adminMode ? 'login' : 'loginCode').focus(), 50);
}
$('pwToggle').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('pwToggle').textContent = show ? 'Hide' : 'Show';
  $('pwToggle').setAttribute('aria-pressed', String(show));
});
$('signinForm').addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  const err = $('signinErr'), btn = $('signinBtn');
  err.hidden = true; $('signinMsg').hidden = true;
  const login = $('login').value.trim(), password = $('password').value, loginCode = $('loginCode').value.replace(/\D/g, '');
  if (adminMode && (!login || !password)) { err.textContent = 'Enter your website email and password.'; err.hidden = false; return; }
  if (!adminMode && loginCode.length !== 8) { err.textContent = 'Enter your 8-number login code, e.g. 1234-5678.'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch('/api/matchday-kitchen/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(adminMode ? { login, password } : { loginCode }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Sign-in failed. Please try again.');
    await startApp();
  } catch (ex) {
    err.textContent = (ex as Error).message === 'Failed to fetch' ? 'No connection. Check the Wi-Fi and try again.' : (ex as Error).message; err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});

// ── Home ──
function greeting() {
  const h = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Lagos' }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function renderWho() {
  const u = session.user, sh = session.shift;
  $('who').innerHTML = u.kind === 'admin'
    ? `<b>${esc(u.code)}</b><span>Super admin${sh?.onShift ? ` · on shift since ${esc(hm(sh.since))}` : ''}</span>`
    : `<b>${esc(u.name)} · ${esc(u.code)}</b><span>${sh?.onShift ? `on shift since ${esc(hm(sh.since))}` : 'not on shift'}</span>`;
  $('shiftNag').hidden = !!sh?.onShift || u.kind === 'admin';
}
// Food ordering for fans: everyone sees whether it is open; supervisors and Super Admins have the buttons.
function drawOrdering(o: any) {
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
  $('ordering').hidden = false;
  $('ordering').classList.toggle('on', !!o.open);
  $('ordState').textContent = o.open ? 'Food ordering is OPEN' : 'Food ordering is CLOSED';
  $('ordNote').textContent = o.mode === 'auto'
    ? (o.open ? `Automatic${o.closesAt ? `: closes ${when(o.closesAt)}` : ''}` : `Automatic${o.opensAt ? `: opens ${when(o.opensAt)}` : ': opens before the next home match'}`)
    : o.open ? 'Fans can order and pay now. It stays open until someone closes it.' : 'Fans cannot order. It stays closed until someone opens it.';
  $('ordBtns').hidden = !o.canChange;
  document.querySelectorAll<HTMLElement>('[data-ordering]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ordering === o.mode)));
}
async function loadOrdering(quiet = true) {
  try { drawOrdering(await api('ordering', { quiet })); } catch { /* keep the last answer */ }
}
$('ordBtns').addEventListener('click', async (e: Event) => {
  const b = (e.target as HTMLElement).closest('[data-ordering]') as HTMLButtonElement | null;
  if (!b) return;
  const mode = b.dataset.ordering!;
  const ask = mode === 'open' ? 'Open food ordering? Fans can order and pay straight away, so make sure the kitchen is ready.'
    : mode === 'closed' ? 'Close food ordering? Fans cannot order until someone opens it again. Orders already placed are not affected.'
    : 'Set food ordering to automatic? It then opens by itself before each home match and closes after it.';
  if (!confirm(ask)) return;
  b.disabled = true;
  try {
    drawOrdering(await api('ordering', { method: 'POST', body: { mode } }));
    toast(mode === 'open' ? 'Food ordering is open.' : mode === 'closed' ? 'Food ordering is closed.' : 'Food ordering is on automatic.');
  } catch (ex) { toast((ex as Error).message); } finally { b.disabled = false; }
});
setInterval(() => { if (session.csrf && !document.hidden && !$('home').hidden) loadOrdering(); }, 30e3);

function renderHome() {
  $('hello').textContent = `${greeting()}, ${session.user.firstName}`;
  renderWho();
  loadOrdering();
  const sa = !!session.perms.staff;
  $('groups').innerHTML = GROUPS.filter(g => !g.superOnly || sa).map(g => {
    const tiles = g.tiles;
    return `<section class="mk-group"><h2>${esc(g.title)}</h2><div class="mk-rail"><div class="mk-tickets">${tiles.map(t => {
      const text = t.id === 'activity' && !sa ? 'Everything you have done here' : t.text;
      const note = t.external === 'whatsapp' ? 'Opens WhatsApp in a new tab' : t.external ? 'Opens the app' : '';
      return `<button type="button" class="mk-tile ${t.style || ''}" data-open="${t.id}"><span class="mk-ico">${iconFor(t.id)}</span><b>${esc(t.title)}</b><span>${esc(text)}</span>${note ? `<small>${note}</small>` : ''}</button>`;
    }).join('')}</div></div></section>`;
  }).join('');
}
$('groups').addEventListener('click', (e: Event) => {
  const b = (e.target as HTMLElement).closest('[data-open]') as HTMLElement | null;
  if (b) open(b.dataset.open!);
});
$('shiftNag').addEventListener('click', () => open('shift'));

// ── Tabs ──
function persist() { try { sessionStorage.setItem(SAVE_KEY, JSON.stringify(tabs.map(t => t.page))); } catch { /* private mode */ } }
function drawTabs() {
  $('tabs').hidden = !tabs.length;
  $('tabs').innerHTML = tabs.map(t => `<span class="mk-tab${t.page === current ? ' on' : ''}"><button type="button" class="t" data-tab="${esc(t.page)}" aria-current="${t.page === current ? 'page' : 'false'}">${iconFor(t.page)}${esc(pageTitle(t.page))}</button><button type="button" class="x" data-close="${esc(t.page)}" aria-label="Close ${esc(pageTitle(t.page))}">×</button></span>`).join('');
  $('homeBtn').classList.toggle('on', !current);
  $('reloadBtn').hidden = !current;
  document.title = current ? `${pageTitle(current)} | MatchDay Kitchen | Lobi Stars FC` : 'MatchDay Kitchen | Lobi Stars FC';
}
$('tabs').addEventListener('click', (e: Event) => {
  const el = e.target as HTMLElement;
  const close = el.closest('[data-close]') as HTMLElement | null;
  if (close) { closeTab(close.dataset.close!); return; }
  const tab = el.closest('[data-tab]') as HTMLElement | null;
  if (tab) show(tab.dataset.tab!);
});
function show(page: string) {
  current = page;
  $('home').hidden = !!page;
  for (const t of tabs) { t.frame.hidden = t.page !== page; if (t.page === page) t.shownAt = Date.now(); }
  drawTabs();
  if (!page) { renderHome(); window.scrollTo(0, 0); }
}
function home() { show(''); }
function frameFor(page: string) {
  const f = document.createElement('iframe');
  f.src = `/matchday-kitchen/${page.split('/').map(encodeURIComponent).join('/')}/`;
  f.title = pageTitle(page);
  f.allow = 'web-share; clipboard-write'; // the receipt picture is shared from inside the page
  f.hidden = true;
  $('frames').append(f);
  return f;
}
/** Opens a page as a tab (or switches to it); WhatsApp / Telegram open in their apps. */
function open(page: string, { log = true, focus = true } = {}) {
  if (page === 'whatsapp' || page === 'telegram') {
    const url = page === 'whatsapp' ? whatsappUrl() : session.settings.telegramUrl;
    // The same browser tab each time (named), so WhatsApp Web stays signed in and isn't opened twice.
    if (url) { window.open(url, page === 'whatsapp' ? 'mdk-whatsapp' : 'mdk-telegram'); api('open', { method: 'POST', body: { page } }).catch(() => {}); }
    // No Telegram link yet: Super Admins go to the setting; staff are told who can add it.
    else if (session.perms.staff) { open('staff'); toast('Paste the Telegram channel link in Settings (at the bottom of Staff accounts).'); }
    else toast("The Telegram channel hasn't been set up yet. Ask a super admin.");
    return;
  }
  const have = tabs.find(t => t.page === page);
  if (have) { if (focus) show(page); return; }
  if (tabs.length >= MAX_TABS) {
    // Quietly close the oldest page that isn't on screen.
    const oldest = tabs.filter(t => t.page !== current).sort((a, b) => a.shownAt - b.shownAt)[0];
    if (oldest) closeTab(oldest.page, false);
  }
  tabs.push({ page, frame: frameFor(page), shownAt: Date.now() });
  persist();
  if (log && !page.startsWith('orders/')) api('open', { method: 'POST', body: { page } }).catch(() => {});
  if (focus) show(page); else drawTabs();
}
function closeTab(page: string, redraw = true) {
  const i = tabs.findIndex(t => t.page === page);
  if (i < 0) return;
  tabs[i].frame.remove(); tabs.splice(i, 1); persist();
  if (current === page) show(tabs.length ? tabs[Math.max(0, i - 1)].page : ''); else if (redraw) drawTabs();
}
function closeAllTabs(save = true) { while (tabs.length) tabs.pop()!.frame.remove(); current = ''; if (save) persist(); }
$('homeBtn').addEventListener('click', home);
$('waPath').setAttribute('d', WA_PATH);
$('waBtn').addEventListener('click', () => open('whatsapp'));
$('tgPath').setAttribute('d', TG_PATH);
$('tgBtn').addEventListener('click', () => open('telegram'));
let toastT = 0;
function toast(t: string) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = window.setTimeout(() => { el.hidden = true; }, 6000); }
// The tab frames fill the space under the top bar (taller when the tabs row is showing).
const topH = () => document.documentElement.style.setProperty('--top-h', `${$('top').offsetHeight}px`);
if ('ResizeObserver' in window) new ResizeObserver(topH).observe($('top')); else window.addEventListener('resize', topH);
$('reloadBtn').addEventListener('click', () => { const t = tabs.find(x => x.page === current); if (t) t.frame.contentWindow?.location.reload(); });

// ── Full screen and clock ──
if (document.fullscreenEnabled) {
  $('fsBtn').hidden = false;
  $('fsBtn').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); });
}
const tick = () => { $('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }); };
tick(); setInterval(tick, 10e3);

// ── Signed out (from anywhere): the whole tablet goes to the sign-in page ──
function signedOut(msg = 'You were signed out. Please sign in again.') { stopIdle(); stopAlarms(); try { sessionStorage.removeItem(SAVE_KEY); } catch { /* */ } showSignin(started ? msg : ''); started = false; }
setSignedOutHandler(() => signedOut());
$('signoutBtn').addEventListener('click', async () => {
  try { localStorage.removeItem('ls_kitchen_manager'); } catch { /* private mode */ }
  try { await api('logout', { method: 'POST', body: {} }); } catch { /* signed out anyway */ }
  signedOut('You have signed out.');
});

// ── Idle sign-out on shared tablets ──
function activity() {
  if (!$('idle').hidden) return;          // only "Keep me signed in" ends the countdown
  lastActivity = Date.now();
  // Tell the server now and then, so a busy tablet isn't signed out there.
  if (Date.now() - lastPing > 120e3) { lastPing = Date.now(); api('session').catch(() => {}); }
}
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, activity, { passive: true }));
function stopIdle() { clearInterval(idleTimer); clearInterval(countdown); $('idle').hidden = true; }
function startIdle() {
  stopIdle(); lastActivity = Date.now();
  idleTimer = window.setInterval(() => { if ($('idle').hidden && Date.now() - lastActivity >= IDLE_MS) askStillThere(); }, 5000);
}
function askStillThere() {
  let left = COUNTDOWN;
  $('idleCount').textContent = String(left); $('idle').hidden = false; $('idleKeep').focus();
  clearInterval(countdown);
  countdown = window.setInterval(async () => {
    left -= 1; $('idleCount').textContent = String(Math.max(0, left));
    if (left <= 0) {
      clearInterval(countdown);
      try { await api('logout', { method: 'POST', body: { idle: true } }); } catch { /* */ }
      signedOut('You were signed out because nobody tapped for 20 minutes.');
    }
  }, 1000);
}
$('idleKeep').addEventListener('click', () => { clearInterval(countdown); $('idle').hidden = true; lastActivity = Date.now(); lastPing = Date.now(); api('session').catch(() => {}); });

// For the pages inside the tabs.
(window as any).mkShell = {
  home, open: (p: string) => open(p), activity, signedOut: () => signedOut(), alarmsNow,
  shiftChanged: async () => { try { await loadSession(); renderWho(); } catch { /* */ } },
};

async function startApp() {
  await loadSession();
  $('signin').hidden = true; $('app').hidden = false;
  if (location.pathname !== '/matchday-kitchen/' || location.search) history.replaceState(null, '', '/matchday-kitchen/');
  try { if (session.perms.menu) localStorage.setItem('ls_kitchen_manager', '1'); else localStorage.removeItem('ls_kitchen_manager'); } catch { /* private mode */ }
  renderHome(); show('');
  // Refreshed by accident: reopen the pages that were open, but stay on Home.
  let saved: string[] = [];
  try { saved = JSON.parse(sessionStorage.getItem(SAVE_KEY) || '[]'); } catch { /* */ }
  for (const p of saved.slice(0, MAX_TABS)) if (typeof p === 'string' && /^[a-z/0-9_-]+$/i.test(p)) open(p, { log: false, focus: false });
  if (SHORTCUTS.includes(wantOpen)) { open(wantOpen); wantOpen = ''; }
  startIdle();
  startAlarms(p => open(p));
  started = true;
}

(async () => {
  try { await startApp(); } catch { showSignin(); }
})();
