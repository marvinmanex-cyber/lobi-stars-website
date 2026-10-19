// Google Analytics 4, ONLY after the visitor presses "Accept" in the cookie banner.
// - Before that, nothing is sent to Google (not even a request for the ID).
// - Consent Mode: everything denied by default; only analytics_storage is
//   granted after Accept. Advertising features stay off.
// - The Measurement ID comes from the website (GA4_MEASUREMENT_ID, Cloudflare);
//   when it isn't set, GA4 simply stays off.
// - window.lsGa(name, params) sends a key event. Only safe fields pass
//   (platform, method, location, item_count, value, currency, label); anything
//   that looks like an email or phone number is dropped. Page addresses are sent
//   without their ?query part (order links and sign-in links carry private tokens).
(function () {
  // Loaded again after an in-page navigation: count the new page.
  if (window.lsGa) { if (window.__lsGaPage) window.__lsGaPage(); return; }
  var off = /^\/(admin|scan|helper)(\/|$)/.test(location.pathname);
  var SAFE = { platform: 1, method: 1, location: 1, item_count: 1, value: 1, currency: 1, label: 1 };
  var state = 'idle'; // idle | loading | ready | none
  var queue = [];
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  function consented() { try { return localStorage.getItem('ls_consent') === 'accepted'; } catch (e) { return false; } }
  function clean(p) {
    var o = {};
    for (var k in (p || {})) {
      if (!SAFE[k]) continue;
      var v = p[k];
      if (typeof v === 'number') { if (isFinite(v)) o[k] = Math.round(v * 100) / 100; }
      else if (typeof v === 'string') { v = v.slice(0, 80); if (/@|\d{7,}/.test(v.replace(/[\s-]/g, ''))) continue; o[k] = v; }
    }
    return o;
  }
  function pageLocation() {
    // Keep only campaign tags (utm_*), never other query values.
    var q = (location.search || '').slice(1).split('&').filter(function (kv) { return /^utm_[a-z]+=/.test(kv); }).join('&');
    return location.origin + location.pathname + (q ? '?' + q : '');
  }
  function page() {
    if (state !== 'ready') return;
    gtag('event', 'page_view', { page_location: pageLocation(), page_title: document.title });
  }
  window.__lsGaPage = page;
  // In-page navigation (Astro): count each new page once, on Astro's page-load signal.
  var counted = location.pathname;
  document.addEventListener('astro:page-load', function () { if (location.pathname !== counted) { counted = location.pathname; page(); } });

  function start() {
    if (off || state !== 'idle' || !consented()) return;
    state = 'loading';
    var cached = null;
    try { cached = sessionStorage.getItem('ls_ga_id'); } catch (e) { /* private mode */ }
    var idPromise = cached !== null ? Promise.resolve(cached)
      : fetch('/api/analytics/config', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) { var v = (d && d.ga4) || ''; try { sessionStorage.setItem('ls_ga_id', v); } catch (e) {} return v; });
    idPromise.then(function (id) {
      if (!/^G-[A-Z0-9]{4,20}$/.test(id || '')) { state = 'none'; queue = []; return; } // GA4 not set up: stay off
      gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      gtag('consent', 'update', { analytics_storage: 'granted' });
      gtag('set', { allow_google_signals: false, allow_ad_personalization_signals: false });
      gtag('js', new Date());
      gtag('config', id, { send_page_view: false });
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
      document.head.appendChild(s);
      state = 'ready';
      page();
      queue.splice(0).forEach(function (e) { gtag('event', e[0], e[1]); });
    }).catch(function () { state = 'idle'; });
  }

  /** A key event (no personal data). Dropped unless the visitor accepted analytics. */
  window.lsGa = function (name, params) {
    if (off || !consented() || !/^[a-z_]{3,40}$/.test(name)) return;
    var p = clean(params);
    if (state === 'ready') gtag('event', name, p);
    else if (state !== 'none') { queue.push([name, p]); start(); }
  };

  /** Called by the cookie banner when the visitor chooses. */
  window.__lsGaConsent = function (choice) {
    if (choice === 'accepted') { start(); return; }
    if (state === 'ready') gtag('consent', 'update', { analytics_storage: 'denied' });
    // Remove Google Analytics cookies (_ga, _ga_XXXX) on this domain.
    document.cookie.split(';').forEach(function (c) {
      var n = c.split('=')[0].trim();
      if (/^_ga(_|$)/.test(n)) ['', '; domain=' + location.hostname, '; domain=.' + location.hostname.replace(/^www\./, '')].forEach(function (d) {
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + d;
      });
    });
  };

  // Clicks picked up automatically (the buttons already carry data-track labels).
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a, button');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var t = a.dataset ? a.dataset.track : '';
    if (a.dataset && a.dataset.social) return window.lsGa('social_click', { platform: a.dataset.social });
    if (/whatsapp\.com\/channel\//.test(href) || (t === 'whatsapp_click' && /^channel-/.test(a.dataset.trackLabel || ''))) {
      return window.lsGa('whatsapp_channel_join_click', { location: (a.dataset.trackLabel || 'link').replace(/^channel-/, '') });
    }
    if (t === 'watch_play' || /^\/watch\/?$/.test(href)) return window.lsGa('watch_live_click', { location: t === 'watch_play' ? 'player' : 'link' });
  }, true);

  start();
})();
