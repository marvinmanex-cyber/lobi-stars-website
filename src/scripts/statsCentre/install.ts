// "Install the app" prompt for the Statistics Center (27 Nov 2026). When the page is opened on a phone or tablet
// (and it is not already installed), a card asks to put it on the home screen:
//  - Android / Chrome / Edge / Samsung Internet: one "Install" button (the browser's own install box);
//  - iPhone / iPad (Safari): Apple allows no button, so the card shows "Share → Add to Home Screen";
//  - other browsers: how to install from the browser menu.
// "Not now" hides it for 7 days (on this device). Settings › "Install the app" shows it again at any time.
/* eslint-disable @typescript-eslint/no-explicit-any */
let deferred: any = null;
const KEY = 'sx_install_later';
const ua = navigator.userAgent;
const isIos = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = isIos || /Android|Mobile/i.test(ua);
export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const later = () => { try { return Number(localStorage.getItem(KEY) || 0) > Date.now(); } catch { return false; } };
const setLater = () => { try { localStorage.setItem(KEY, String(Date.now() + 7 * 864e5)); } catch { /* private mode */ } };

function sheet(force = false) {
  if (isInstalled()) { if (force) alert('The Statistics Center is already installed on this device.'); return; }
  if (!force && (later() || !isMobile)) return;
  document.getElementById('sxInstall')?.remove();
  const box = document.createElement('div');
  box.id = 'sxInstall';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'sxInstallT');
  const how = deferred
    ? '<p>Put the Statistics Center on your home screen. It opens full screen like an app, keeps your taps when the signal drops, and is quicker to reach on match day.</p><div class="sx-inst-row"><button class="sx-btn sx-btn--p" type="button" data-go>Install the app</button><button class="sx-btn" type="button" data-later>Not now</button></div>'
    : isIos
      ? `<p>Put the Statistics Center on your home screen. It opens full screen like an app.</p><ol class="sx-inst-steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button <span aria-hidden="true" class="sx-inst-ico">⬆︎</span> (bottom of the screen on iPhone, top on iPad).</li><li>Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><div class="sx-inst-row"><button class="sx-btn sx-btn--p" type="button" data-later>OK</button></div>`
      : `<p>Put the Statistics Center on your home screen. It opens full screen like an app.</p><ol class="sx-inst-steps"><li>Open the browser menu <span aria-hidden="true" class="sx-inst-ico">⋮</span> (top right in Chrome).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol><p class="sx-small">Best in Chrome on Android.</p><div class="sx-inst-row"><button class="sx-btn sx-btn--p" type="button" data-later>OK</button></div>`;
  box.innerHTML = `<div class="sx-inst-card"><div class="sx-inst-head"><img src="/images/icon-192.png" alt="" width="56" height="56"><div><h2 id="sxInstallT">Get the Lobi Stats app</h2><p class="sx-small">Free · no app store needed</p></div></div>${how}</div>`;
  document.body.appendChild(box);
  const close = () => { box.remove(); };
  box.querySelector('[data-go]')?.addEventListener('click', async () => {
    const p = deferred; deferred = null; close();
    if (!p) return;
    try { p.prompt(); const r = await p.userChoice; if (r?.outcome !== 'accepted') setLater(); } catch { /* the browser said no */ }
  });
  box.querySelectorAll('[data-later]').forEach(b => b.addEventListener('click', () => { setLater(); close(); }));
  box.addEventListener('click', e => { if (e.target === box) { setLater(); close(); } });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { setLater(); close(); document.removeEventListener('keydown', esc); } });
  (box.querySelector('[data-go], [data-later]') as HTMLElement | null)?.focus();
}

/** Called once when the page loads. */
export function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e: any) => { e.preventDefault(); deferred = e; sheet(); });
  window.addEventListener('appinstalled', () => { deferred = null; document.getElementById('sxInstall')?.remove(); });
  // iPhone and browsers without the install event: show the steps shortly after opening.
  setTimeout(() => { if (!deferred) sheet(); }, isIos ? 2500 : 6000);
}
/** Settings › "Install the app". */
export const showInstall = () => sheet(true);
