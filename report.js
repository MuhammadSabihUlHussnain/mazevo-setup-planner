(() => {
  'use strict';

  const P = globalThis.MazevoPlanner;
  const R = globalThis.MzvRender;
  const api = globalThis.browser || globalThis.chrome;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_ORIGIN = 'https://east.mymazevo.com';
  const KEEP_DAYS = 21;

  const state = {
    lists: null,      // bookings per day from the last read
    days: null,       // [base, base+1, ...]
    chain: null,      // planner output
    fresh: {},        // day -> { diff, since } from the last read
    tab: 0,           // which planned day is showing
    building: '',     // building filter
    search: '',
    dateTouched: false,
    readAt: null
  };

  // ---------- small storage helpers (this page's own storage; nothing leaves the browser) ----------

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

  const settings = Object.assign({ rules: P.DEFAULT_RULES, hideOutdoor: false, span: 1 }, load('mzvSettings', {}));
  const saveSettings = () => save('mzvSettings', settings);

  const doneSet = (day) => new Set(load('mzvDone:' + day, []));

  // ---------- status line ----------

  function status(text, kind) {
    const el = $('status');
    el.textContent = text || '';
    el.className = kind || '';
  }

  const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // ---------- rendering ----------

  function actionable(plan) {
    return plan.rows.filter((r) => r.category === 'change' || r.category === 'empty').map((r) => r.key)
      .concat(plan.midday.map((m) => m.key));
  }

  function renderTabs() {
    const plans = state.chain.plans;
    if (plans.length < 2) { $('tabs').innerHTML = ''; return; }
    $('tabs').innerHTML = plans.map((p, i) => {
      const work = p.counts.change + p.counts.empty + p.counts.midday;
      return '<button role="tab" data-tab="' + i + '" aria-selected="' + (i === state.tab) + '">' + R.esc(P.dayLabel(p.day)) +
        '<small>' + work + ' to set</small></button>';
    }).join('');
  }

  function renderFilters(plan) {
    const buildings = [...new Set(plan.rows.map((r) => r.building).concat(plan.freed.map((f) => f.building)))].sort();
    if (state.building && !buildings.includes(state.building)) state.building = '';
    const pill = (value, label) => '<button class="pill" data-building="' + R.esc(value) + '" aria-pressed="' + (state.building === value) + '">' + R.esc(label) + '</button>';
    $('filters').innerHTML = (buildings.length > 1 ? pill('', 'All buildings') + buildings.map((b) => pill(b, b)).join('') : '') +
      '<input type="search" id="search" placeholder="Find a room or event" value="' + R.esc(state.search) + '">';
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

  function renderProgress(plan) {
    const keys = actionable(plan);
    const done = doneSet(plan.day);
    $('summary').innerHTML = R.summary(plan, keys.filter((k) => done.has(k)).length, keys.length);
  }

  function render() {
    const plans = state.chain.plans;
    if (state.tab >= plans.length) state.tab = 0;
    const plan = plans[state.tab];
    const fresh = state.fresh[plan.day];
    const diff = fresh && fresh.diff;

    $('title').textContent = plans.length > 1
      ? 'Room setup plan, ' + P.dayLabel(plans[0].day) + ' to ' + P.dayLabel(plans[plans.length - 1].day)
      : 'Room setup plan for ' + P.dayLabel(plan.day);
    document.title = 'Setup Planner · ' + P.dayLabel(plan.day);

    renderTabs();
    $('changes').innerHTML = R.changes(diff, fresh ? 'at ' + clock(new Date(fresh.since)) : '');
    renderProgress(plan);
    renderFilters(plan);
    $('out').innerHTML = R.day(plan, {
      done: doneSet(plan.day),
      fresh: diff ? { added: new Set(diff.added.map((a) => String(a.id))), changed: new Set(diff.changed.map((c) => String(c.id))) } : null
    });
    applyFilters();

    $('foot').textContent = 'Read from Mazevo Manage Operations at ' + clock(state.readAt) +
      '. Times are setup start and teardown end, as Mazevo shows them. Nothing in Mazevo was changed.';
    for (const id of ['copy', 'csv', 'print']) $(id).disabled = false;
  }

  function replan() {
    state.chain = P.planChain(state.lists, state.days, { rules: settings.rules });
    render();
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

  function waitForLoad(tabId) {
    return new Promise((resolve) => {
      const done = () => { api.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve(); };
      const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
      const timer = setTimeout(done, 30000);
      api.tabs.onUpdated.addListener(listener);
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

  async function run() {
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
        await waitForLoad(tab.id);
      }

      let info = await pingUntil(tab.id, 3000);
      if (!info || !info.hooked) {
        // The tab was open before the extension was installed or updated.
        status('Reloading Mazevo so the planner can read it…', 'busy');
        await api.tabs.reload(tab.id);
        await waitForLoad(tab.id);
        info = await pingUntil(tab.id, 15000);
      }
      if (!info) throw new Error('Could not connect to the Mazevo tab. Reload it and try again.');
      save('mzvOrigin', info.origin);

      const signIn = 'Sign in to Mazevo in the other tab, then click Refresh from Mazevo.';
      if (/login/i.test(info.path)) throw new Error(signIn);
      if (!/ops-manage/i.test(info.path)) {
        status('Opening Manage Operations…', 'busy');
        await api.tabs.update(tab.id, { url: info.origin + '/ops-manage' });
        await waitForLoad(tab.id);
        info = await pingUntil(tab.id, 15000);
        if (!info) throw new Error('Could not open Manage Operations.');
        if (/login/i.test(info.path)) throw new Error(signIn);
      }

      // Browsers slow down timers in background tabs, so bring Mazevo forward while it loads.
      status('Reading ' + days.map(P.dayLabel).join(', ') + ' from Mazevo…', 'busy');
      await api.tabs.update(tab.id, { active: true });
      const res = await api.tabs.sendMessage(tab.id, { type: 'collect', days });
      if (me) await api.tabs.update(me.id, { active: true });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Mazevo did not answer.');

      state.lists = days.map((d) => res.byDay[d] || []);
      state.days = days;
      state.readAt = new Date();
      state.chain = P.planChain(state.lists, days, { rules: settings.rules });

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
      if (me && tab) { try { await api.tabs.update(me.id, { active: true }); } catch (x) { /* ignore */ } }
      status(e.message || String(e), 'error');
    } finally {
      $('run').disabled = false;
    }
  }

  // ---------- Friday hint ----------

  function showHint() {
    const base = $('base').value || P.ymd(new Date());
    const span = +$('span').value || 1;
    const dow = new Date(base + 'T12:00:00').getDay();
    if (dow === 5 && span < 3) {
      $('hint').innerHTML = 'It’s Friday. Plan the weekend and Monday too? <button id="weekend">Plan through Monday</button>';
    } else if (dow === 6 && span < 2) {
      $('hint').innerHTML = 'It’s Saturday. Plan through Monday too? <button id="weekend" data-span="2">Plan through Monday</button>';
    } else {
      $('hint').innerHTML = '';
    }
  }

  // ---------- export ----------

  function tsv() {
    return R.table(state.chain).map((r) => r.map((c) => String(c == null ? '' : c).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  }

  function csv() {
    const q = (c) => {
      const s = String(c == null ? '' : c);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + R.table(state.chain).map((r) => r.map(q).join(',')).join('\r\n');
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

  function ruleRow(r) {
    const num = (v, name) => '<td><input type="number" step="0.001" min="0" name="' + name + '" value="' + R.esc(v) + '"></td>';
    return '<tr><td><input type="text" name="match" value="' + R.esc(r.match) + '"></td>' +
      num(r.chairs, 'chairs') + num(r.tables, 'tables') + num(r.rounds, 'rounds') +
      '<td><button type="button" class="linkish" data-remove-rule>Remove</button></td></tr>';
  }

  function openSettings() {
    $('rules').innerHTML = settings.rules.map(ruleRow).join('');
    $('hideOutdoor').checked = !!settings.hideOutdoor;
    $('settings').returnValue = ''; // Esc must not reuse an old "save"
    $('settings').showModal();
  }

  function readRules() {
    return [...$('rules').querySelectorAll('tr')].map((tr) => {
      const v = (n) => tr.querySelector('[name=' + n + ']').value;
      return { match: v('match').trim(), chairs: +v('chairs') || 0, tables: +v('tables') || 0, rounds: +v('rounds') || 0 };
    }).filter((r) => r.match);
  }

  // ---------- wiring ----------

  prune();
  $('base').value = P.ymd(new Date());
  $('span').value = String(settings.span || 1);
  showHint();

  $('run').addEventListener('click', run);
  $('base').addEventListener('change', () => { state.dateTouched = $('base').value !== P.ymd(new Date()); run(); });
  $('span').addEventListener('change', () => { settings.span = +$('span').value; saveSettings(); run(); });

  $('hint').addEventListener('click', (e) => {
    const b = e.target.closest('#weekend');
    if (!b) return;
    $('span').value = b.dataset.span || '3';
    run();
  });

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = +b.dataset.tab;
    render();
  });

  $('summary').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    const sec = b && $('sec-' + b.dataset.jump);
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
    const plan = state.chain.plans[state.tab];
    const done = doneSet(plan.day);
    if (box.checked) done.add(box.dataset.key); else done.delete(box.dataset.key);
    save('mzvDone:' + plan.day, [...done]);
    box.closest('tr').classList.toggle('done', box.checked);
    renderProgress(plan);
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
  $('print').addEventListener('click', () => window.print());

  $('settingsBtn').addEventListener('click', openSettings);
  $('addRule').addEventListener('click', () => {
    $('rules').insertAdjacentHTML('beforeend', ruleRow({ match: '', chairs: 1, tables: 0, rounds: 0 }));
  });
  $('resetRules').addEventListener('click', () => {
    $('rules').innerHTML = P.DEFAULT_RULES.map(ruleRow).join('');
  });
  $('rules').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove-rule]');
    if (b) b.closest('tr').remove();
  });
  $('settings').addEventListener('close', () => {
    if ($('settings').returnValue !== 'save') return;
    settings.rules = readRules();
    settings.hideOutdoor = $('hideOutdoor').checked;
    saveSettings();
    if (state.lists) replan();
  });

  window.__mzvTest = { state, render, replan, settings }; // used by tests
  if (api && api.tabs) {
    run();
  } else {
    status('Open this page from the Mazevo Setup Planner button.', 'error');
  }
})();
