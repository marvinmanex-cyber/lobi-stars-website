// First-party page-view beacon. Fires once per page load and posts a small
// JSON payload to /api/track. Stores only two random ids in the visitor's
// own browser (localStorage + sessionStorage) -- no fingerprinting, no
// personal data. Silently does nothing if storage is unavailable.
(function () {
  try {
    var path = location.pathname || '/';
    if (path.indexOf('/admin') === 0 || path === '/scan') return;

    var vid = '';
    var isNew = 0;
    try {
      vid = localStorage.getItem('ls_vid') || '';
      if (!vid) {
        vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('ls_vid', vid);
        isNew = 1;
      }
    } catch (e) { return; }

    var sid = '';
    try {
      sid = sessionStorage.getItem('ls_sid') || '';
      if (!sid) {
        sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('ls_sid', sid);
      }
    } catch (e) { return; }

    var refHost = '';
    if (document.referrer) {
      try {
        var r = new URL(document.referrer);
        if (r.host && r.host !== location.host) refHost = r.host;
      } catch (e) { /* ignore */ }
    }

    var w = window.innerWidth || (screen && screen.width) || 0;
    var dev = w > 0 && w < 768 ? 'mobile' : (w < 1024 ? 'tablet' : 'desktop');

    var payload = JSON.stringify({
      path: path, vid: vid, sid: sid, ref: refHost, dev: dev, new: isNew
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(function () {});
    }
  } catch (e) { /* analytics must never break the page */ }
})();
