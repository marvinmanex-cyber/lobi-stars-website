// Never live commentary and a video at the same time.
//
// - A video starting (a YouTube/Facebook/Vimeo player being loaded or tapped,
//   or a <video> playing) pauses the commentary.
// - Commentary starting pauses every <video> and swaps any video player that
//   was started for a "Resume video" button (tapping it brings the video back
//   and pauses the commentary again).
// Installed once, when the commentary engine is first created.

type Engine = { wantPlay?: boolean; active: boolean; pause(track?: boolean): void };

const VIDEO_SRC = /(^|\/\/)(www\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be|player\.vimeo\.com|facebook\.com\/plugins\/video|fb\.watch)/i;
const isVideoFrame = (n: Node): n is HTMLIFrameElement => n instanceof HTMLIFrameElement && VIDEO_SRC.test(n.src || n.getAttribute('src') || '');

export function installMediaGuard(engine: Engine) {
  const w = window as any;
  if (w.__lsMediaGuard) return;
  w.__lsMediaGuard = true;

  const started = new WeakSet<HTMLIFrameElement>(); // video players the fan has started
  let swapping = false; // ignore players that arrive with a new page (they haven't been started)
  document.addEventListener('astro:before-swap', () => { swapping = true; });
  document.addEventListener('astro:after-swap', () => { setTimeout(() => { swapping = false; }, 0); });

  const listening = () => !!(engine as any).wantPlay;
  const pauseCommentary = () => {
    if (!listening()) return;
    engine.pause(false);
    (window as any).showToast?.('Live commentary paused while the video plays.');
  };

  // A video player added by a tap (the site's players load only when you press play).
  new MutationObserver(records => {
    if (swapping) return;
    for (const r of records) r.addedNodes.forEach(n => {
      const frames = isVideoFrame(n) ? [n] : n instanceof Element ? [...n.querySelectorAll('iframe')].filter(isVideoFrame) : [];
      for (const f of frames) { started.add(f); pauseCommentary(); }
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // A tap inside a video player that was already on the page (e.g. a video in a news story).
  window.addEventListener('blur', () => setTimeout(() => {
    const f = document.activeElement;
    if (isVideoFrame(f as Node)) { started.add(f as HTMLIFrameElement); pauseCommentary(); }
  }, 0));

  // A <video> element starting.
  document.addEventListener('play', e => { if (e.target instanceof HTMLVideoElement) pauseCommentary(); }, true);

  // Commentary starting: stop all videos.
  window.addEventListener('ls:commentary-play', () => {
    document.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); });
    document.querySelectorAll('iframe').forEach(f => {
      if (!isVideoFrame(f) || !started.has(f) || !f.isConnected) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ls-video-paused';
      btn.textContent = '▶ Video paused for live commentary. Tap to resume the video.';
      btn.addEventListener('click', () => btn.replaceWith(f)); // re-adding it pauses the commentary
      f.replaceWith(btn);
    });
  });
}
