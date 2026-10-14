// Browser side of the match cards (functions/api/_lib/fixtureCard.js):
// the countdown tiles and the Share button. One timer for the whole page,
// stopped when no countdown is left or the page is hidden.

let timer: number | undefined;

function pad(n: number) { return String(n).padStart(2, '0'); }

function update(): boolean {
  let running = false;
  document.querySelectorAll<HTMLElement>('[data-fx-cd]').forEach(cd => {
    const js = cd.querySelector<HTMLElement>('.fx-cd-js');
    if (!js) return;
    const plain = cd.querySelector<HTMLElement>('.fx-cd-plain');
    const s = Math.floor((Date.parse(cd.dataset.fxCd!) - Date.now()) / 1000);
    if (s <= 0) {
      // Kick-off: the red LIVE badge replaces the tiles.
      js.hidden = true; if (plain) plain.hidden = true;
      cd.querySelector<HTMLElement>('.fx-cd-live')?.removeAttribute('hidden');
      cd.removeAttribute('data-fx-cd');
      return;
    }
    js.hidden = false; if (plain) plain.hidden = true;
    const v: Record<string, number> = { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
    const secs = cd.querySelector<HTMLElement>('[data-u="s"]');
    if (secs) secs.hidden = s >= 86400;
    cd.querySelectorAll<HTMLElement>('[data-u]').forEach(t => {
      const n = t.querySelector('.fx-num')!;
      const text = t.dataset.u === 'd' ? String(v.d) : pad(v[t.dataset.u!]);
      if (n.textContent !== text) n.textContent = text;
    });
    cd.querySelector('.fx-tiles')?.setAttribute('aria-label', `${v.d} days, ${v.h} hours, ${v.m} minutes to kick-off`);
    running = true;
  });
  return running;
}

function stop() { if (timer !== undefined) { clearInterval(timer); timer = undefined; } }

/** Starts (or restarts, after cards are replaced) the page's one countdown timer. */
export function startCountdowns() {
  stop();
  if (!update()) return;
  timer = window.setInterval(() => { if (!update()) stop(); }, 1000);
}

addEventListener('pagehide', stop);
addEventListener('pageshow', e => { if ((e as PageTransitionEvent).persisted) startCountdowns(); });

// Share: the phone's share sheet, or copy the link.
document.addEventListener('click', async e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fx-share]');
  if (!b) return;
  const url = new URL(b.dataset.url || location.href, location.origin).href;
  const title = b.dataset.title || document.title;
  if (navigator.share) { try { await navigator.share({ title, url }); } catch { /* closed */ } return; }
  try {
    await navigator.clipboard.writeText(url);
    const old = b.textContent; b.textContent = 'Link copied'; setTimeout(() => { b.textContent = old; }, 2000);
  } catch { location.href = `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`; }
});
