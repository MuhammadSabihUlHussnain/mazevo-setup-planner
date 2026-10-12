(() => {
  'use strict';

  const P = globalThis.MazevoPlanner;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_ORIGIN = 'https://east.mymazevo.com';
  let lastPlan = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function status(text, isError) {
    const el = $('status');
    el.textContent = text || '';
    el.className = isError ? 'error' : '';
  }

  function savedOrigin() {
    try { return localStorage.getItem('mzvOrigin') || DEFAULT_ORIGIN; } catch (e) { return DEFAULT_ORIGIN; }
  }
  function saveOrigin(origin) {
    try { localStorage.setItem('mzvOrigin', origin); } catch (e) { /* ignore */ }
  }

  // ---------- rendering ----------

  function eventCell(ev, extra) {
    if (!ev) return '<span class="muted">Not used</span>';
    const bits = [ev.number];
    if (ev.status && !/confirmed/i.test(ev.status)) bits.push(ev.status);
    return esc(ev.name) + '<small>' + esc(bits.filter(Boolean).join(' · ')) + (extra ? ' · ' + esc(extra) : '') + '</small>';
  }

  function roomCell(r) {
    return '<td class="room">' + esc(r.room) + '<small>' + esc(r.building) + '</small></td>';
  }

  function notes(r) {
    return r.notes.length ? '<ul class="notes">' + r.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  }

  function section(title, hint, head, rows) {
    if (!rows.length) return '';
    return '<section><h2>' + esc(title) + ' <small>' + esc(hint) + '</small></h2><div class="scroll"><table><thead><tr>' +
      head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div></section>';
  }

  function render(plan) {
    lastPlan = plan;
    const t = P.dayLabel(plan.today);
    const n = P.dayLabel(plan.tomorrow);
    $('title').textContent = 'Room setup plan for ' + n;
    document.title = 'Setup Planner · ' + n;
    const of = (cat) => plan.rows.filter((r) => r.category === cat);

    // Today side: event, the setup it leaves behind, and when the room frees up.
    const todaySide = (r) => eventCell(r.today) +
      (r.today ? "<div class=\"line\"><b>" + esc(r.current || "—") + "</b> · free after " + esc(r.freeAfter) + "</div>" : "");
    // Tomorrow side: event, what it needs, and when setup starts.
    const tomorrowSide = (r) => eventCell(r.tomorrow) +
      "<div class=\"line\"><b>" + esc(r.needed || "No room setup") + "</b>" + (r.extras.length ? " + " + esc(r.extras.join(", ")) : "") +
      " · set up by " + esc(r.setupBy) + "</div>";
    const what = (r) => "<span class=\"tag\">" + esc(r.change) + "</span>" + notes(r);

    const change = of("change").map((r) => "<tr class=\"change\">" + roomCell(r) +
      "<td>" + todaySide(r) + "</td><td>" + tomorrowSide(r) + "</td><td>" + what(r) + "</td></tr>");

    const empty = of("empty").map((r) => "<tr class=\"empty\">" + roomCell(r) +
      "<td>" + tomorrowSide(r) + "</td><td>" + what(r) + "</td></tr>");

    const check = of("check").map((r) => "<tr class=\"check\">" + roomCell(r) +
      "<td>" + (r.today ? todaySide(r) : "<span class=\"muted\">Not used</span>") + "</td><td>" + tomorrowSide(r) + "</td><td>" + what(r) + "</td></tr>");

    const same = of("same").map((r) => "<tr class=\"same\">" + roomCell(r) +
      "<td>" + todaySide(r) + "</td><td>" + tomorrowSide(r) + "</td><td>" + what(r) + "</td></tr>");

    const quiet = of('none').map((r) => '<tr class="none">' + roomCell(r) + '<td>' + eventCell(r.today) + '</td><td>' + eventCell(r.tomorrow, r.setupBy) + '</td></tr>');

    const freed = plan.freed.map((f) => '<tr>' + '<td class="room">' + esc(f.room) + '<small>' + esc(f.building) + '</small></td>' +
      '<td>' + eventCell(f.today) + '</td><td class="setup">' + esc(f.current || 'No setup ordered') + '</td><td class="time">' + esc(f.freeAfter) + '</td></tr>');

    const c = plan.counts;
    const chip = (num, label) => '<div class="chip"><b>' + (num || 0) + '</b>' + esc(label) + '</div>';

    $('out').innerHTML =
      '<div class="summary">' +
        chip(c.change, 'to flip after today’s event') +
        chip(c.empty, 'empty today, set up any time') +
        chip(c.check, 'to check') +
        chip(c.same, 'already set') +
      '</div>' +
      section('Flip after today’s event', 'sorted by when the room frees up', ['Room', 'Today, ' + t, 'Tomorrow, ' + n, 'What to do'], change) +
      section('Not used today: set up any time', 'sorted by setup time', ['Room', 'Tomorrow, ' + n, 'What to do'], empty) +
      section('Check with the requester', 'booked tomorrow but no room setup ordered', ['Room', 'Today, ' + t, 'Tomorrow, ' + n, 'What’s going on'], check) +
      section('Already set, no change', '', ['Room', 'Today, ' + t, 'Tomorrow, ' + n, 'Notes'], same) +
      section('No setup ordered either day', 'usually outdoor spaces', ['Room', 'Today, ' + t, 'Tomorrow, ' + n], quiet) +
      section('Not booked tomorrow', 'used today, nothing to set up', ['Room', 'Today, ' + t, 'Setup left in room', 'Free after'], freed) +
      (plan.rows.length || plan.freed.length ? '' : '<section><h2>No bookings found for ' + esc(t) + ' or ' + esc(n) + '</h2></section>');

    $('foot').textContent = 'Read from Mazevo Manage Operations at ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
      '. Times are setup start (tomorrow) and teardown end (today). Nothing in Mazevo was changed.';
    $('copy').disabled = false;
    $('print').disabled = false;
  }

  function toTsv(plan) {
    const head = ['Category', 'Building', 'Room', 'Today event', 'Current setup', 'Free after', 'Tomorrow event', 'Needs', 'Other services', 'What to do', 'Set up by', 'Notes'];
    const names = { change: 'Flip', empty: 'Empty today', check: 'Check', same: 'No change', none: 'No setup' };
    const clean = (s) => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ');
    const lines = [head];
    for (const r of plan.rows) {
      lines.push([names[r.category], r.building, r.room, r.today ? r.today.number + ' ' + r.today.name : '', r.current, r.freeAfter,
        r.tomorrow.number + ' ' + r.tomorrow.name, r.needed, r.extras.join(', '), r.change, r.setupBy, r.notes.join('; ')]);
    }
    for (const f of plan.freed) {
      lines.push(['Not booked tomorrow', f.building, f.room, f.today ? f.today.number + ' ' + f.today.name : '', f.current, f.freeAfter, '', '', '', '', '', '']);
    }
    return lines.map((l) => l.map(clean).join('\t')).join('\n');
  }

  // ---------- talking to the Mazevo tab ----------

  async function ping(tabId) {
    try { return await chrome.tabs.sendMessage(tabId, { type: 'ping' }); } catch (e) { return null; }
  }

  async function pingUntil(tabId, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const r = await ping(tabId);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 400));
    }
    return null;
  }

  function waitForLoad(tabId) {
    return new Promise((resolve) => {
      const done = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve(); };
      const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
      const timer = setTimeout(done, 30000);
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function findMazevoTab() {
    const param = new URLSearchParams(location.search).get('tab');
    if (param) {
      try {
        const t = await chrome.tabs.get(+param);
        if (t && /mymazevo\.com/.test(t.url || '')) return t;
      } catch (e) { /* tab closed */ }
    }
    const tabs = await chrome.tabs.query({ url: 'https://*.mymazevo.com/*' });
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return tabs[0] || null;
  }

  async function run() {
    const base = $('base').value || P.ymd(new Date());
    const next = P.addDays(base, 1);
    $('run').disabled = true;
    const me = await chrome.tabs.getCurrent();
    let tab = null;
    try {
      status('Looking for your Mazevo tab…');
      tab = await findMazevoTab();
      if (!tab) {
        status('Opening Mazevo…');
        tab = await chrome.tabs.create({ url: savedOrigin() + '/ops-manage', active: false, index: me ? me.index : undefined });
        await waitForLoad(tab.id);
      }

      let info = await pingUntil(tab.id, 3000);
      if (!info || !info.hooked) {
        // The tab was open before the extension was installed or updated.
        status('Reloading Mazevo so the planner can read it…');
        await chrome.tabs.reload(tab.id);
        await waitForLoad(tab.id);
        info = await pingUntil(tab.id, 15000);
      }
      if (!info) throw new Error('Could not connect to the Mazevo tab. Reload it and try again.');
      saveOrigin(info.origin);

      if (/login/i.test(info.path)) throw new Error('Sign in to Mazevo in the other tab, then click Refresh from Mazevo.');
      if (!/ops-manage/i.test(info.path)) {
        status('Opening Manage Operations…');
        await chrome.tabs.update(tab.id, { url: info.origin + '/ops-manage' });
        await waitForLoad(tab.id);
        info = await pingUntil(tab.id, 15000);
        if (!info) throw new Error('Could not open Manage Operations.');
        if (/login/i.test(info.path)) throw new Error('Sign in to Mazevo in the other tab, then click Refresh from Mazevo.');
      }

      // Chrome slows down timers in background tabs, so bring Mazevo forward while it loads.
      status('Reading bookings for ' + P.dayLabel(base) + ' and ' + P.dayLabel(next) + ' from Mazevo…');
      await chrome.tabs.update(tab.id, { active: true });
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'collect', days: [base, next] });
      if (me) await chrome.tabs.update(me.id, { active: true });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Mazevo did not answer.');

      render(P.plan(res.byDay[base] || [], res.byDay[next] || [], { today: base, tomorrow: next }));
      status('');
    } catch (e) {
      if (me && tab) { try { await chrome.tabs.update(me.id, { active: true }); } catch (x) { /* ignore */ } }
      status(e.message || String(e), true);
    } finally {
      $('run').disabled = false;
    }
  }

  // ---------- wiring ----------

  $('base').value = P.ymd(new Date());
  $('run').addEventListener('click', run);
  $('base').addEventListener('change', run);
  $('print').addEventListener('click', () => window.print());
  $('copy').addEventListener('click', async () => {
    if (!lastPlan) return;
    await navigator.clipboard.writeText(toTsv(lastPlan));
    $('copy').textContent = 'Copied';
    setTimeout(() => { $('copy').textContent = 'Copy for Excel'; }, 1500);
  });

  window.__mzvRender = render; // used by tests
  if (globalThis.chrome && chrome.tabs) {
    run();
  } else {
    status('Open this page from the Mazevo Setup Planner toolbar button.', true);
  }
})();
