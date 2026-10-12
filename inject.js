// Adds hook.js to the Mazevo page itself. Content scripts run in a separate
// JavaScript world and can't see the page's own network calls; a <script> tag
// works the same way in Chrome, Edge and Safari.
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const s = document.createElement('script');
  s.src = api.runtime.getURL('hook.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();
