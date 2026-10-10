// First-party analytics beacon (see functions/api/track.js).
// - Always sends an ANONYMOUS page view (no id, nothing stored on the device).
// - Only if the visitor ACCEPTED the cookie banner does it add a random
//   browser id (localStorage) so returning visitors can be counted.
// - window.lsTrack(name, label) records click events; common clicks are
//   picked up automatically below.
(function () {
  // Loaded again after an in-page navigation (while live commentary keeps
  // playing): just count the new page.
  if (window.lsTrack) { if (window.__lsPageview) window.__lsPageview(true); return; }
  var path = location.pathname || '/';
  if (path.indexOf('/admin') === 0 || path.indexOf('/scan') === 0) { window.lsTrack = function () {}; return; }

  function consented() {
    try { return localStorage.getItem('ls_consent') === 'accepted'; } catch (e) { return false; }
  }
  function ids() {
    if (!consented()) return { consent: false };
    var vid = '', sid = '', isNew = false;
    try {
      vid = localStorage.getItem('ls_vid') || '';
      if (!vid) { vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('ls_vid', vid); isNew = true; }
      sid = sessionStorage.getItem('ls_sid') || '';
      if (!sid) { sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('ls_sid', sid); }
    } catch (e) { return { consent: false }; }
    return { consent: true, vid: vid, sid: sid, new: isNew };
  }
  function device() {
    var w = window.innerWidth || (screen && screen.width) || 0;
    return w > 0 && w < 768 ? 'mobile' : (w < 1024 ? 'tablet' : 'desktop');
  }
  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) return;
    } catch (e) { /* fall back */ }
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
  }

  // Page view
  function pageview(inPage) {
    try {
      path = location.pathname || '/';
      if (path.indexOf('/admin') === 0 || path.indexOf('/scan') === 0) return;
      var ref = '';
      if (!inPage && document.referrer) {
        var r = new URL(document.referrer);
        if (r.host && r.host !== location.host) ref = r.host;
      }
      var q = new URLSearchParams(location.search);
      var i = ids();
      send({
        type: 'pageview', path: path, ref: ref, dev: device(), consent: i.consent, vid: i.vid, sid: i.sid, new: inPage ? false : i.new,
        utm: { source: q.get('utm_source') || '', medium: q.get('utm_medium') || '', campaign: q.get('utm_campaign') || '' },
      });
    } catch (e) { /* analytics must never break the page */ }
  }
  window.__lsPageview = pageview;
  pageview(false);

  // Events
  window.lsTrack = function (name, label) {
    try {
      var i = ids();
      send({ type: 'event', name: name, label: label || '', path: location.pathname, dev: device(), consent: i.consent, vid: i.vid });
    } catch (e) {}
  };

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a, button') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (a.dataset && a.dataset.track) return window.lsTrack(a.dataset.track, a.dataset.trackLabel || '');
    if (/wa\.me\//.test(href)) return window.lsTrack('whatsapp_click', path);
    if (/jumia\.com\.ng/.test(href) && a.closest('.pc')) return window.lsTrack('shop_click', (a.closest('.pc').querySelector('.pc-name') || {}).textContent || href);
    if (a.id === 'prog-download' || a.id === 'progDlBtn') return window.lsTrack('programme_download', href);
  }, true);
})();
