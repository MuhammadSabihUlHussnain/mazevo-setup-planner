(() => {
  'use strict';

  const P = globalThis.MazevoPlanner;
  const R = globalThis.MzvRender;
  const api = globalThis.browser || globalThis.chrome;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_ORIGIN = 'https://east.mymazevo.com';
  const KEEP_DAYS = 21;
  const TABLE_LABELS = { '': 'Chairs only', t8: '8-ft table', t6: '6-ft table', round: 'Banquet round' };

  const state = {
    lists: null,      // bookings per day from the last read
    days: null,       // [base, base+1, ...]
    chain: null,      // planner output
    fresh: {},        // day -> { diff, since } from the last read
    view: 'plan',     // 'plan' or 'board'
    building: '',     // building filter
    search: '',
    dateTouched: false,
    readAt: null
  };

  // ---------- storage (this page's own storage; nothing leaves the browser) ----------

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }

  function prune() {
    const cutoff = P.addDays(P.ymd(new Date()), -KEEP_DAYS);
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        const m = k && k.match(/^mzv(?:Done|Snap):(\d{4}-\d{2}-\d{2})$/);
        if (m && m[1] < cutoff) localStorage.removeItem(k);
      }
    } catch (e) { /* ignore */ }
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const stored = load('mzvSettings', {});
  const settings = {
    furniture: stored.furniture && stored.furniture.layouts ? stored.furniture : clone(P.DEFAULT_FURNITURE),
    hideOutdoor: !!stored.hideOutdoor,
    span: stored.span || 1,
    view: stored.view === 'board' ? 'board' : 'plan'
  };
  state.view = settings.view;
  const saveSettings = () => save('mzvSettings', settings);

  const doneFor = (day) => new Set(load('mzvDone:' + day, []));

  // ---------- status line ----------

  function status(text, kind) {
    const el = $('status');
    el.textContent = text || '';
    el.className = kind || '';
  }

  const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // ---------- rendering ----------

  function renderFilters() {
    const seen = new Set();
    for (const p of state.chain.plans) {
      for (const r of p.rows) seen.add(r.building);
      for (const f of p.freed) seen.add(f.building);
    }
    const buildings = [...seen].sort();
    if (state.building && !buildings.includes(state.building)) state.building = '';
    const pill = (value, label) => '<button class="pill" data-building="' + R.esc(value) + '" aria-pressed="' + (state.building === value) + '">' + R.esc(label) + '</button>';
    $('filters').innerHTML = (buildings.length > 1 ? pill('', 'All buildings') + buildings.map((b) => pill(b, b)).join('') : '') +
      '<input type="search" id="search" placeholder="Find a room, event or layout" value="' + R.esc(state.search) + '">';
  }

  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    for (const row of document.querySelectorAll('#out tr[data-building]')) {
      const b = row.dataset.building;
      const hide = (state.building && b !== state.building) ||
        (settings.hideOutdoor && /^outside/i.test(b)) ||
        (q && !row.dataset.search.includes(q));
      row.classList.toggle('hidden', !!hide);
    }
    for (const sec of document.querySelectorAll('#out section')) {
      const rows = sec.querySelectorAll('tbody tr');
      if (!rows.length) continue;
      sec.classList.toggle('hidden', [...rows].every((r) => r.classList.contains('hidden')));
    }
  }

  function render() {
    const plans = state.chain.plans;
    const first = plans[0];
    const last = plans[plans.length - 1];
    const range = plans.length > 1 ? P.dayLabel(first.day) + ' to ' + P.dayLabel(last.day) : P.dayLabel(first.day);
    $('title').textContent = (state.view === 'board' ? 'Setup status, ' : 'Room setup plan, ') + range;
    document.title = 'Setup Planner · ' + range;
    $('printed').textContent = 'Printed ' + new Date().toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('viewPlan').setAttribute('aria-pressed', String(state.view === 'plan'));
    $('viewBoard').setAttribute('aria-pressed', String(state.view === 'board'));

    $('summary').innerHTML = state.view === 'plan' ? R.summary(state.chain, doneFor) : '';
    renderFilters();
    $('out').innerHTML = state.view === 'board'
      ? R.board(state.chain, doneFor)
      : plans.map((p) => {
        const f = state.fresh[p.day];
        return R.day(p, { done: doneFor(p.day), diff: f && f.diff, since: f ? 'at ' + clock(new Date(f.since)) : '' });
      }).join('');
    applyFilters();

    $('foot').textContent = 'Read from Mazevo Manage Operations at ' + clock(state.readAt) +
      '. Times are setup start and teardown end, as Mazevo shows them. Nothing in Mazevo was changed.';
    for (const id of ['copy', 'csv', 'print']) $(id).disabled = false;
  }

  function rerender() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function replan() {
    state.chain = P.planChain(state.lists, state.days, { furniture: settings.furniture });
    rerender();
  }

  // ---------- talking to the Mazevo tab ----------

  async function ping(tabId) {
    try { return await api.tabs.sendMessage(tabId, { type: 'ping' }); } catch (e) { return null; }
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

  // Start waiting before triggering the navigation, so a fast load isn't missed.
  // For a brand-new tab, also check whether it has already finished.
  function waitForLoad(tabId, checkNow) {
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        api.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      };
      const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
      const timer = setTimeout(done, 30000);
      api.tabs.onUpdated.addListener(listener);
      if (checkNow) {
        Promise.resolve(api.tabs.get(tabId)).then((t) => { if (t && t.status === 'complete') done(); }, () => {});
      }
    });
  }

  async function findMazevoTab() {
    const param = new URLSearchParams(location.search).get('tab');
    if (param) {
      try {
        const t = await api.tabs.get(+param);
        if (t && /mymazevo\.com/.test(t.url || '')) return t;
      } catch (e) { /* tab closed */ }
    }
    const tabs = await api.tabs.query({ url: 'https://*.mymazevo.com/*' });
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return tabs[0] || null;
  }

  let runSeq = 0;

  async function run() {
    const my = ++runSeq;
    const stale = () => my !== runSeq; // a newer run (other date or span) has started
    if (!state.dateTouched) $('base').value = P.ymd(new Date());
    const base = $('base').value || P.ymd(new Date());
    const span = Math.min(3, Math.max(1, +$('span').value || 1));
    const days = [base];
    for (let i = 1; i <= span; i++) days.push(P.addDays(base, i));
    showHint();

    $('run').disabled = true;
    const me = await Promise.resolve(api.tabs.getCurrent()).catch(() => null);
    let tab = null;
    try {
      status('Looking for your Mazevo tab…', 'busy');
      tab = await findMazevoTab();
      if (!tab) {
        status('Opening Mazevo…', 'busy');
        tab = await api.tabs.create({ url: load('mzvOrigin', DEFAULT_ORIGIN) + '/ops-manage', active: false, index: me ? me.index : undefined });
        await waitForLoad(tab.id, true);
      }

      let info = await pingUntil(tab.id, 3000);
      if (!info || !info.hooked) {
        // The tab was open before the extension was installed or updated.
        status('Reloading Mazevo so the planner can read it…', 'busy');
        const reloaded = waitForLoad(tab.id);
        await api.tabs.reload(tab.id);
        await reloaded;
        info = await pingUntil(tab.id, 15000);
      }
      if (!info) throw new Error('Could not connect to the Mazevo tab. Reload it and try again.');
      save('mzvOrigin', info.origin);

      const signIn = 'Sign in to Mazevo in the other tab, then click Refresh from Mazevo.';
      if (/login/i.test(info.path)) throw new Error(signIn);
      if (!/ops-manage/i.test(info.path)) {
        status('Opening Manage Operations…', 'busy');
        const opened = waitForLoad(tab.id);
        await api.tabs.update(tab.id, { url: info.origin + '/ops-manage' });
        await opened;
        info = await pingUntil(tab.id, 15000);
        if (!info) throw new Error('Could not open Manage Operations.');
        if (/login/i.test(info.path)) throw new Error(signIn);
      }

      // Browsers slow down timers in background tabs, so bring Mazevo forward while it loads.
      status('Reading ' + days.map(P.dayLabel).join(', ') + ' from Mazevo…', 'busy');
      await api.tabs.update(tab.id, { active: true });
      const res = await api.tabs.sendMessage(tab.id, { type: 'collect', days });
      if (stale()) return;
      if (me) await api.tabs.update(me.id, { active: true });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Mazevo did not answer.');

      state.lists = days.map((d) => res.byDay[d] || []);
      state.days = days;
      state.readAt = new Date();
      state.chain = P.planChain(state.lists, days, { furniture: settings.furniture });

      // Compare with what this browser saw last time for each day, then remember this read.
      state.fresh = {};
      for (const plan of state.chain.plans) {
        const prev = load('mzvSnap:' + plan.day, null);
        if (prev && prev.items) state.fresh[plan.day] = { diff: P.diff(prev.items, plan.snapshot), since: prev.ts };
        save('mzvSnap:' + plan.day, { ts: Date.now(), items: plan.snapshot });
      }

      render();
      status('');
    } catch (e) {
      if (stale()) return;
      if (me && tab) { try { await api.tabs.update(me.id, { active: true }); } catch (x) { /* ignore */ } }
      status(e.message || String(e), 'error');
    } finally {
      if (!stale()) $('run').disabled = false;
    }
  }

  // ---------- Friday hint ----------

  function showHint() {
    const base = $('base').value || P.ymd(new Date());
    const span = +$('span').value || 1;
    const dow = new Date(base + 'T12:00:00').getDay();
    if (dow === 5 && span < 3) {
      $('hint').innerHTML = 'It’s Friday. Plan the weekend and Monday too? <button id="weekend" data-span="3">Plan through Monday</button>';
    } else if (dow === 6 && span < 2) {
      $('hint').innerHTML = 'It’s Saturday. Plan through Monday too? <button id="weekend" data-span="2">Plan through Monday</button>';
    } else {
      $('hint').innerHTML = '';
    }
  }

  // ---------- export ----------

  // Event names come from requesters; never let a cell start a spreadsheet formula.
  function cell(c) {
    if (c == null) return '';
    if (typeof c === 'number') return String(c);
    const s = String(c);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  function tsv() {
    return R.table(state.chain, doneFor).map((r) => r.map((c) => cell(c).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  }

  function csv() {
    const q = (c) => {
      const s = cell(c);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + R.table(state.chain, doneFor).map((r) => r.map(q).join(',')).join('\r\n');
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function flash(id, text) {
    const b = $(id);
    const old = b.textContent;
    b.textContent = text;
    setTimeout(() => { b.textContent = old; }, 1500);
  }

  // ---------- settings ----------

  const num = (v) => (v === '' || v == null ? '' : R.esc(v));

  function layoutRow(l) {
    const opts = Object.keys(TABLE_LABELS).map((k) => '<option value="' + k + '"' + ((l.table || '') === k ? ' selected' : '') + '>' + TABLE_LABELS[k] + '</option>').join('');
    return '<tr><td><input type="text" name="name" value="' + R.esc(l.name || '') + '"></td>' +
      '<td><input type="text" name="match" value="' + R.esc(l.match || '') + '"></td>' +
      '<td><select name="table">' + opts + '</select></td>' +
      '<td><select name="per"><option value="people"' + (l.perTable ? '' : ' selected') + '>People</option><option value="tables"' + (l.perTable ? ' selected' : '') + '>Tables</option></select></td>' +
      '<td><input type="number" step="any" min="0" name="cpt" value="' + num(l.perTable ? l.chairsPerTable : '') + '" placeholder="—"></td>' +
      '<td><button type="button" class="linkish" data-remove>Remove</button></td></tr>';
  }

  function buildingRow(b) {
    const s = b.seats || {};
    return '<tr><td><input type="text" name="match" value="' + R.esc(b.match || '') + '"></td>' +
      ['t8', 't6', 'round'].map((k) => '<td><input type="number" step="any" min="0" name="' + k + '" value="' + num(s[k]) + '"></td>').join('') +
      '<td><button type="button" class="linkish" data-remove>Remove</button></td></tr>';
  }

  function fillSettings(f) {
    $('seat-t8').value = f.seats.t8;
    $('seat-t6').value = f.seats.t6;
    $('seat-round').value = f.seats.round;
    $('layouts').innerHTML = f.layouts.map(layoutRow).join('');
    $('buildings').innerHTML = (f.buildings || []).map(buildingRow).join('');
  }

  function openSettings() {
    fillSettings(settings.furniture);
    $('hideOutdoor').checked = !!settings.hideOutdoor;
    $('settings').returnValue = ''; // Esc must not reuse an old "save"
    $('settings').showModal();
  }

  function readSettings() {
    const val = (tr, n) => tr.querySelector('[name=' + n + ']').value;
    const layouts = [...$('layouts').querySelectorAll('tr')].map((tr) => {
      const perTable = val(tr, 'per') === 'tables';
      return { name: val(tr, 'name').trim(), match: val(tr, 'match').trim(), table: val(tr, 'table'), perTable, chairsPerTable: perTable ? +val(tr, 'cpt') || 0 : undefined };
    }).filter((l) => l.match);
    const buildings = [...$('buildings').querySelectorAll('tr')].map((tr) => {
      const seats = {};
      for (const k of ['t8', 't6', 'round']) {
        const v = val(tr, k);
        if (v !== '') seats[k] = +v;
      }
      return { match: val(tr, 'match').trim(), seats };
    }).filter((b) => b.match);
    return {
      seats: { t8: +$('seat-t8').value || 0, t6: +$('seat-t6').value || 0, round: +$('seat-round').value || 0 },
      layouts,
      buildings
    };
  }

  // ---------- wiring ----------

  prune();
  $('base').value = P.ymd(new Date());
  $('span').value = String(settings.span || 1);
  showHint();

  $('run').addEventListener('click', run);

  // Typing a date fires "change" for each part; wait until it settles.
  let dateTimer = 0;
  $('base').addEventListener('change', () => {
    clearTimeout(dateTimer);
    dateTimer = setTimeout(() => {
      if (!$('base').value) return;
      state.dateTouched = $('base').value !== P.ymd(new Date());
      run();
    }, 700);
  });
  $('span').addEventListener('change', () => { settings.span = +$('span').value; saveSettings(); run(); });

  $('hint').addEventListener('click', (e) => {
    const b = e.target.closest('#weekend');
    if (!b) return;
    $('span').value = b.dataset.span || '3';
    run();
  });

  const setView = (v) => {
    state.view = v;
    settings.view = v;
    saveSettings();
    if (state.chain) render();
    else {
      $('viewPlan').setAttribute('aria-pressed', String(v === 'plan'));
      $('viewBoard').setAttribute('aria-pressed', String(v === 'board'));
    }
  };
  $('viewPlan').addEventListener('click', () => setView('plan'));
  $('viewBoard').addEventListener('click', () => setView('board'));

  $('summary').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    const sec = b && b.dataset.jump && document.getElementById(b.dataset.jump);
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-building]');
    if (!b) return;
    state.building = b.dataset.building;
    for (const p of document.querySelectorAll('#filters .pill')) p.setAttribute('aria-pressed', String(p === b));
    applyFilters();
  });
  $('filters').addEventListener('input', (e) => {
    if (e.target.id !== 'search') return;
    state.search = e.target.value;
    applyFilters();
  });

  $('out').addEventListener('change', (e) => {
    const box = e.target.closest('input[type=checkbox][data-key]');
    if (!box) return;
    const day = box.dataset.day;
    const done = doneFor(day);
    if (box.checked) done.add(box.dataset.key); else done.delete(box.dataset.key);
    save('mzvDone:' + day, [...done]);
    rerender();
  });
  $('out').addEventListener('click', (e) => {
    if (e.target.closest('[data-open-settings]')) openSettings();
  });

  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(tsv()); flash('copy', 'Copied'); } catch (e) { flash('copy', 'Copy failed'); }
  });
  $('csv').addEventListener('click', () => {
    const p = state.chain.plans;
    download('setup-plan-' + p[0].day + (p.length > 1 ? '-to-' + p[p.length - 1].day : '') + '.csv', csv(), 'text/csv;charset=utf-8');
  });
  $('print').addEventListener('click', () => {
    $('printed').textContent = 'Printed ' + new Date().toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    window.print();
  });

  $('settingsBtn').addEventListener('click', openSettings);
  $('cancelSettings').addEventListener('click', () => $('settings').close('cancel'));
  $('addLayout').addEventListener('click', () => {
    $('layouts').insertAdjacentHTML('beforeend', layoutRow({ name: '', match: '', table: 't6' }));
  });
  $('addBuilding').addEventListener('click', () => {
    $('buildings').insertAdjacentHTML('beforeend', buildingRow({ match: '', seats: {} }));
  });
  $('resetRules').addEventListener('click', () => fillSettings(P.DEFAULT_FURNITURE));
  $('settings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (b) b.closest('tr').remove();
  });
  $('settings').addEventListener('close', () => {
    if ($('settings').returnValue !== 'save') return;
    settings.furniture = readSettings();
    settings.hideOutdoor = $('hideOutdoor').checked;
    saveSettings();
    if (state.lists) replan();
    else if (state.chain) rerender();
  });

  window.__mzvTest = { state, render, replan, settings }; // used by tests
  if (api && api.tabs) {
    run();
  } else {
    status('Open this page from the Mazevo Setup Planner button.', 'error');
  }
})();
