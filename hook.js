// Runs in Mazevo's own page context so it can see the booking data the page
// already downloads. Mazevo signs every API call, so instead of calling the
// API ourselves we copy the GetBookings responses as they arrive and hand
// them to content.js. Nothing is sent anywhere else.
(() => {
  if (window.__mzvPlannerHook) return;
  window.__mzvPlannerHook = true;

  const mark = () => {
    if (document.documentElement) document.documentElement.dataset.mzvPlannerHook = '1';
  };
  mark();
  if (!document.documentElement) document.addEventListener('readystatechange', mark, { once: true });

  const MATCH = /\/api\/operations\/GetBookings\b/i;

  function emit(body, payload) {
    let request = null;
    try { request = typeof body === 'string' ? JSON.parse(body) : null; } catch (e) { /* ignore */ }
    let data = payload;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return; }
    }
    window.postMessage({ source: 'mzv-planner-hook', type: 'bookings', request, bookings: data }, location.origin);
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__mzvUrl = String(url);
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (MATCH.test(this.__mzvUrl || '')) {
      this.addEventListener('load', () => {
        if (this.status !== 200) return;
        const type = this.responseType;
        emit(body, type === '' || type === 'text' ? this.responseText : this.response);
      });
    }
    return xhrSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (MATCH.test(url) && res.ok) {
        const body = init && typeof init.body === 'string' ? init.body : null;
        res.clone().text().then((text) => emit(body, text)).catch(() => {});
      }
    } catch (e) { /* never break the page */ }
    return res;
  };
})();
