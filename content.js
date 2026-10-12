// Runs on Mazevo pages. Collects the GetBookings data captured by hook.js and,
// when the report asks, steps the Manage Operations date to each day needed
// so Mazevo loads that day's bookings.
(() => {
  if (window.__mzvPlannerContent) return;
  window.__mzvPlannerContent = true;

  const P = globalThis.MazevoPlanner;
  const captures = new Map(); // "YYYY-MM-DD" -> { ts, bookings }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'mzv-planner-hook') return;
    const { request } = e.data;
    let list = e.data.bookings;
    if (list && !Array.isArray(list) && Array.isArray(list.data)) list = list.data;
    if (!Array.isArray(list)) return;

    const bookings = list.map(P.condense);
    const ts = Date.now();
    if (request && request.startDate) {
      captures.set(P.ymd(new Date(request.startDate)), { ts, bookings });
    } else {
      const byDay = {};
      for (const b of bookings) (byDay[String(b.start).slice(0, 10)] ||= []).push(b);
      for (const day of Object.keys(byDay)) captures.set(day, { ts, bookings: byDay[day] });
    }
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout, interval = 150) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(interval);
    }
  }

  function dateLabel() {
    return [...document.querySelectorAll('label.linkButton, label, span')]
      .find((el) => el.children.length === 0 && P.parseLabelDate(el.textContent));
  }

  function displayedDay() {
    const l = dateLabel();
    return l ? P.parseLabelDate(l.textContent) : null;
  }

  function arrow(dir) {
    let box = dateLabel();
    for (let i = 0; i < 5 && box; i++) {
      box = box.parentElement;
      if (box && box.querySelector('svg[data-icon="chevron-' + dir + '"]')) break;
    }
    if (!box) return null;
    return [...box.querySelectorAll('svg[data-icon="chevron-' + dir + '"]')]
      .map((svg) => svg.closest('fa-icon') || svg)
      .find((el) => el.offsetParent !== null && getComputedStyle(el).display !== 'none') || null;
  }

  function refreshButton() {
    return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Refresh') || null;
  }

  async function goTo(day) {
    for (let step = 0; step < 60; step++) {
      const cur = displayedDay();
      if (!cur) throw new Error('Could not find the date on the Manage Operations page. Make sure it is in day view.');
      if (cur === day) return;
      const a = arrow(cur < day ? 'right' : 'left');
      if (!a) throw new Error('Could not find the next/previous day arrows on the Manage Operations page.');
      a.click();
      if (!(await waitFor(() => displayedDay() !== cur, 10000))) {
        throw new Error('Clicking the date arrow did not change the day.');
      }
    }
    throw new Error('That date is too far from the one shown in Mazevo.');
  }

  const fresh = (day, since) => () => {
    const c = captures.get(day);
    return c && c.ts >= since ? c : null;
  };

  async function load(day) {
    const t0 = Date.now();
    if (displayedDay() !== day) await goTo(day);
    let got = await waitFor(fresh(day, t0), 5000);
    if (!got) {
      // Same day was already showing (or the response was slow): ask Mazevo to reload it.
      const r = refreshButton();
      if (r) {
        const t1 = Date.now();
        r.click();
        got = await waitFor(fresh(day, t1), 25000);
      }
    }
    if (!got) throw new Error('Mazevo did not send the bookings for ' + P.dayLabel(day) + '. Try again.');
    return got.bookings;
  }

  async function collect(days) {
    if (!(await waitFor(dateLabel, 20000))) {
      throw new Error(/login/i.test(location.pathname)
        ? 'Sign in to Mazevo first.'
        : 'Open Manage Operations in day view, then try again.');
    }
    const original = displayedDay();
    const byDay = {};
    for (const day of days) byDay[day] = await load(day);
    try { await goTo(original); } catch (e) { /* leaving it on another day is harmless */ }
    return { byDay };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'ping') {
      sendResponse({
        ok: true,
        hooked: document.documentElement.dataset.mzvPlannerHook === '1',
        path: location.pathname,
        origin: location.origin,
        displayed: displayedDay()
      });
      return;
    }
    if (msg.type === 'collect') {
      collect(msg.days).then(
        (r) => sendResponse({ ok: true, ...r }),
        (e) => sendResponse({ ok: false, error: e.message })
      );
      return true;
    }
  });
})();
