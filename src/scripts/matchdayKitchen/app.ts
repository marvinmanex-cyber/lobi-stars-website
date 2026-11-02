// MatchDay Kitchen staff app: install it on the phone, tablet or laptop as its own
// app (separate from the Lobi Stars app; it only opens the kitchen staff area),
// the service worker (/matchday-kitchen/sw.js), and "Fan menu", which opens the
// public ordering page in the normal browser.
const $ = (id: string) => document.getElementById(id) as HTMLElement | null;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || (navigator as any).standalone === true;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferred: any = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/matchday-kitchen/sw.js', { scope: '/matchday-kitchen/' }).catch(() => {}); });
}

function draw() {
  const inApp = standalone();
  document.documentElement.classList.toggle('mk-in-app', inApp);
  const can = !inApp && (!!deferred || ios);
  for (const id of ['installBox', 'installTop']) { const el = $(id); if (el) el.hidden = !can; }
  const how = $('iosHow'); if (how) how.hidden = !(ios && !inApp);
  const btn = $('installBtn'); if (btn) btn.hidden = !deferred;
}
async function install() {
  if (deferred) {
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    deferred = null;
    if (choice?.outcome === 'accepted') { const t = $('installBox'); if (t) t.innerHTML = '<p class="mk-ok">Installed. Open <b>MD Kitchen</b> from your home screen or app list.</p>'; }
    draw();
  } else if (ios) {
    const how = $('iosHow'); if (how) { how.hidden = false; how.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    const box = $('installBox'); if (box) box.hidden = false;
    $('app') && !$('app')!.hidden && alert('To install on iPhone or iPad: tap the Share button (the square with an arrow), then "Add to Home Screen", then "Add".');
  }
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; draw(); });
window.addEventListener('appinstalled', () => { deferred = null; draw(); });
window.matchMedia('(display-mode: standalone)').addEventListener?.('change', draw);
$('installBtn')?.addEventListener('click', install);
$('installTop')?.addEventListener('click', install);
// The public ordering page (what fans see) opens in the normal browser, never inside the staff app.
$('fanBtn')?.addEventListener('click', () => { window.open('https://lobistarsfc.com/kitchen/', '_blank', 'noopener'); });
draw();
