// Turns planner.js output into HTML for the report page. Only builds strings,
// so it stays easy to test.
(function (root) {
  'use strict';

  const P = root.MazevoPlanner;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

  const PIECES = [
    ['t8', '8-ft table', '8-ft tables'],
    ['t6', '6-ft table', '6-ft tables'],
    ['round', 'banquet round', 'banquet rounds'],
    ['chairs', 'chair', 'chairs']
  ];

  const plural = (n, one, many) => (Math.abs(n) === 1 ? one : many);

  // { t6: 15, chairs: 30 } -> "15 × 6-ft tables · 30 chairs"
  function buildText(f) {
    if (!f) return '';
    return PIECES.filter(([k]) => f[k])
      .map(([k, one, many]) => f[k] + (k === 'chairs' ? ' ' : ' × ') + plural(f[k], one, many)).join(' · ');
  }

  // { chairs: -20, t6: -10 } -> "Move: −10 6-ft tables · −20 chairs"
  function movesText(m) {
    if (!m) return '';
    const parts = PIECES.filter(([k]) => m[k]).map(([k, one, many]) => (m[k] > 0 ? '+' : '−') + Math.abs(m[k]) + ' ' + plural(m[k], one, many));
    return parts.length ? '<div class="moves" title="+ bring in, − take out">Move: ' + parts.join(' · ') + '</div>' : '';
  }

  // Done if ticked here or marked complete in Mazevo.
  function status(item, done) {
    if (done.has(item.key)) return { cls: 'done', label: 'Done' };
    if (item.ready === 'ready') return { cls: 'done', label: 'Ready in Mazevo' };
    if (item.ready === 'done') return { cls: 'done', label: 'Done in Mazevo' };
    if (item.ready === 'progress') return { cls: 'progress', label: 'In progress' };
    return { cls: 'todo', label: 'Not done' };
  }

  const statusBadge = (st) => '<span class="st st-' + st.cls + '">' + esc(st.label) + '</span>';

  function eventCell(ev, opts) {
    opts = opts || {};
    if (!ev) return '<span class="muted">Not used</span>';
    const meta = [ev.number];
    if (opts.time) meta.push(opts.time);
    if (opts.contact && ev.contact) meta.push('Contact: ' + ev.contact);
    let h = '<div class="ev">' + esc(ev.name) + '</div><small>' + esc(meta.filter(Boolean).join(' · ')) + '</small>';
    const badges = [];
    if (P.isTentative(ev.status)) badges.push('<span class="badge hold">' + esc(ev.status) + '</span>');
    if (opts.fresh) badges.push('<span class="badge new">' + esc(opts.fresh) + '</span>');
    else if (opts.planned && ev.changed) badges.push('<span class="badge info" title="Mazevo marks this booking as changed since operations last reviewed it">Changed in Mazevo</span>');
    if (ev.diagram && safeUrl(ev.diagram.url)) {
      badges.push('<a class="badge link" href="' + esc(ev.diagram.url) + '" target="_blank" rel="noopener noreferrer">' + esc(ev.diagram.label || 'Diagram') + ' ↗</a>');
    }
    if (badges.length) h += '<div class="badges">' + badges.join('') + '</div>';
    if (ev.instructions) h += '<div class="instr">' + esc(ev.instructions) + '</div>';
    return h;
  }

  function notes(list) {
    return list && list.length ? '<ul class="notes">' + list.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  }

  function setupLine(label, extras, when, build) {
    return '<div class="line"><b>' + esc(label || 'No room setup') + '</b>' +
      (extras && extras.length ? ' + ' + esc(extras.join(', ')) : '') + (when ? ' · ' + esc(when) : '') + '</div>' +
      (build ? '<div class="build">' + esc(buildText(build)) + '</div>' : '');
  }

  function roomCell(r) {
    return '<td class="room">' + esc(r.room) + '<small>' + esc(r.building) + '</small></td>';
  }

  function check(day, key, done) {
    return '<td class="ck"><input type="checkbox" data-day="' + esc(day) + '" data-key="' + esc(key) + '"' + (done ? ' checked' : '') + ' aria-label="Mark done"></td>';
  }

  function tr(cls, r, inner) {
    const text = [r.room, r.building, r.today && r.today.name, r.tomorrow && r.tomorrow.name, r.from && r.from.name, r.to && r.to.name,
      r.current, r.needed, r.fromSetup, r.toSetup, r.change].filter(Boolean).join(' ').toLowerCase();
    return '<tr class="' + cls + '" data-building="' + esc(r.building) + '" data-search="' + esc(text) + '">' + inner + '</tr>';
  }

  function section(id, title, hint, head, rows, extra, cls) {
    if (!rows.length) return '';
    return '<section id="' + esc(id) + '"' + (cls ? ' class="' + cls + '"' : '') + '><h3>' + esc(title) + (hint ? ' <small>' + esc(hint) + '</small>' : '') + '</h3>' +
      '<div class="scroll"><table><thead><tr>' + head.map((h) => '<th' + (h === '' ? ' class="ck"' : '') + '>' + esc(h) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' + (extra || '') + '</section>';
  }

  function freshLabel(id, fresh) {
    if (!fresh) return '';
    if (fresh.added.has(String(id))) return 'New since last check';
    if (fresh.changed.has(String(id))) return 'Updated since last check';
    return '';
  }

  function freshSets(diff) {
    return diff ? { added: new Set(diff.added.map((a) => String(a.id))), changed: new Set(diff.changed.map((c) => String(c.id))) } : null;
  }

  // Setups that need work on a day: flips, free rooms and same-day changeovers.
  function work(plan) {
    return plan.rows.filter((r) => r.category === 'change' || r.category === 'empty').concat(plan.midday);
  }

  function progress(plan, done) {
    const items = work(plan);
    return { done: items.filter((i) => status(i, done).cls === 'done').length, total: items.length };
  }

  const dayTitle = (day) => P.longWeekday(day) + ', ' + P.dayLabel(day).replace(/^\w+, /, '');

  function changes(diff, sinceText, day) {
    if (!diff || !diff.any) return '';
    const items = [];
    for (const a of diff.added) items.push('<li><b>New:</b> ' + esc(a.name) + ' — ' + esc(a.room) + (a.setup ? ', ' + esc(a.setup) : '') + ', set up by ' + esc(P.time(a.setupStart)) + '</li>');
    for (const c of diff.changed) items.push('<li><b>Updated:</b> ' + esc(c.name) + ' — ' + esc(c.room) + ': ' + esc(c.what.join('; ')) + '</li>');
    for (const r of diff.removed) items.push('<li><b>Gone:</b> ' + esc(r.name) + ' — ' + esc(r.room) + ' (cancelled or moved to another day)</li>');
    return '<section class="changes"><h3>Changed since you last checked <small>' + esc(sinceText) + '</small>' +
      '<button class="linkish dismiss" data-dismiss="' + esc(day || '') + '">Dismiss</button></h3><ul>' + items.join('') + '</ul></section>';
  }

  /** One planned day. st: { done: Set, diff, since } */
  function day(plan, st) {
    const done = st.done || new Set();
    const fresh = freshSets(st.diff);
    const before = P.dayLabel(plan.prevDay);
    const on = P.dayLabel(plan.day);
    const id = (s) => 'sec-' + plan.day + '-' + s;
    const of = (cat) => plan.rows.filter((r) => r.category === cat);
    const isDone = (x) => status(x, done).cls === 'done';
    const mazevoState = (x) => (x.ready && x.ready !== 'todo' ? '<div class="badges">' + statusBadge(status(x, new Set())) + '</div>' : '');
    const what = (r) => '<span class="tag">' + esc(r.change) + '</span>' + mazevoState(r) + movesText(r.moves) + notes(r.notes);
    const beforeSide = (r) => r.today
      ? eventCell(r.today) + setupLine(r.current, null, 'free after ' + r.freeAfter)
      : '<span class="muted">Not used</span>';
    const daySide = (r) => eventCell(r.tomorrow, { planned: true, fresh: freshLabel(r.tomorrow.id, fresh) }) +
      setupLine(r.needed, r.extras, 'set up by ' + r.setupBy, r.build);

    const flip = of('change').map((r) => tr('change' + (isDone(r) ? ' done' : ''), r,
      check(plan.day, r.key, done.has(r.key)) + roomCell(r) + '<td>' + beforeSide(r) + '</td><td>' + daySide(r) + '</td><td>' + what(r) + '</td>'));

    const free = of('empty').map((r) => tr('empty' + (isDone(r) ? ' done' : ''), r,
      check(plan.day, r.key, done.has(r.key)) + roomCell(r) + '<td>' + daySide(r) + '</td><td>' + what(r) + '</td>'));

    const mid = plan.midday.map((m) => {
      const gap = m.gap < 0 ? '<span class="badge hold">Overlaps by ' + (-m.gap) + ' min: check for a double booking</span>'
        : m.gap === 0 ? '<span class="badge hold">Back to back</span>'
          : m.gap < 30 ? '<span class="badge hold">Only ' + m.gap + ' min</span>'
            : '<span class="badge plain">' + (m.gap >= 60 ? Math.floor(m.gap / 60) + ' h' + (m.gap % 60 ? ' ' + (m.gap % 60) + ' min' : '') : m.gap + ' min') + ' to flip</span>';
      return tr('change' + (isDone(m) ? ' done' : ''), m,
        check(plan.day, m.key, done.has(m.key)) + roomCell(m) +
        '<td>' + eventCell(m.from) + setupLine(m.fromSetup, null, 'free at ' + m.freeAt) + '</td>' +
        '<td>' + eventCell(m.to, { planned: true, fresh: freshLabel(m.to.id, fresh) }) + setupLine(m.toSetup, m.extras, 'set up by ' + m.setupBy, m.build) + '</td>' +
        '<td><span class="tag">' + esc(m.change) + '</span><div class="badges">' + gap + '</div>' + mazevoState(m) + movesText(m.moves) + '</td>');
    });

    const chk = of('check').map((r) => tr('check', r,
      roomCell(r) + '<td>' + beforeSide(r) + '</td><td>' + eventCell(r.tomorrow, { planned: true, contact: true, fresh: freshLabel(r.tomorrow.id, fresh) }) +
      setupLine(r.needed, r.extras, 'starts ' + r.setupBy) + '</td><td>' + what(r) + '</td>'));

    const same = of('same').map((r) => tr('same', r,
      roomCell(r) + '<td>' + beforeSide(r) + '</td><td>' + daySide(r) + '</td><td>' + what(r) + '</td>'));

    const quiet = of('none').map((r) => tr('none', r,
      roomCell(r) + '<td>' + eventCell(r.today) + '</td><td>' + eventCell(r.tomorrow, { time: r.setupBy }) + '</td>'));

    const freed = plan.freed.map((f) => tr('none', f,
      roomCell(f) + '<td>' + eventCell(f.today) + '</td><td>' + esc(f.current || 'No setup ordered') + '</td><td class="num">' + esc(f.freeAfter) + '</td>'));

    const fur = plan.furniture.buildings.map((b) => {
      const cell = ([k, one, many]) => '<td class="num">' + (b[k] ? (b[k] > 0 ? '+' : '−') + Math.abs(b[k]) + ' ' + plural(b[k], one, many) : '<span class="muted">0</span>') + '</td>';
      return tr('none', { building: b.building, room: '' },
        '<td class="room">' + esc(b.building) + '</td><td class="num">' + b.rooms + '</td>' + PIECES.map(cell).join(''));
    });
    const furNote = '<p class="foot-note">Before each room’s first event. + means bring in, − means take out. ' +
      (plan.furniture.unknown ? 'Not counted: ' + plan.furniture.unknown + ' room(s) whose layout is in the booking notes or isn’t in the furniture rules. ' : '') +
      '<button class="linkish" data-open-settings>Edit furniture rules</button></p>';

    const pr = progress(plan, done);
    const toSet = plan.counts.change + plan.counts.empty + plan.counts.midday;

    return '<div class="day" data-day="' + esc(plan.day) + '">' +
      '<h2 class="dayhead">' + esc(dayTitle(plan.day)) +
      ' <small>' + (toSet ? toSet + ' to set up · ' + pr.done + ' of ' + pr.total + ' done' : 'nothing to set up') + '</small></h2>' +
      changes(st.diff, st.since, plan.day) +
      section(id('flip'), 'Flip before the first event', 'sorted by when each room frees up', ['', 'Room', 'Before · ' + before, on, 'What to do'], flip) +
      section(id('free'), 'Free rooms: set up any time', 'nothing in the room before then', ['', 'Room', on, 'What to do'], free) +
      section(id('mid'), 'Changeovers during ' + P.longWeekday(plan.day), 'between events in the same room', ['', 'Room', 'Earlier event', 'Next event', 'What to do'], mid) +
      section(id('check'), 'Check with the requester', 'booked, but no room setup ordered', ['Room', 'Before · ' + before, on, 'What’s going on'], chk) +
      section(id('furniture'), 'Furniture to move', 'per building', ['Building', 'Rooms', '8-ft tables', '6-ft tables', 'Banquet rounds', 'Chairs'], fur, furNote) +
      section(id('same'), 'Already set', 'no change needed', ['Room', 'Before · ' + before, on, 'Notes'], same) +
      section(id('none'), 'No setup ordered', 'usually outdoor spaces', ['Room', 'Before · ' + before, on], quiet, '', 'print-skip') +
      section(id('freed'), 'Not booked on ' + on, 'used ' + before + ', nothing to set up', ['Room', before, 'Setup left in room', 'Free after'], freed, '', 'print-skip') +
      (plan.rows.length || plan.freed.length ? '' : '<section><h3>No bookings found for ' + esc(before) + ' or ' + esc(on) + '</h3></section>') +
      '</div>';
  }

  /**
   * Status board: every setup that needs doing, marked Done / In progress / Not done.
   * doneFor(day) -> Set of keys ticked for that day.
   */
  function board(chain, doneFor, readAt) {
    let all = 0;
    let ready = 0;
    const rank = { todo: 0, progress: 1, done: 2 };
    const days = chain.plans.map((plan) => {
      const done = doneFor(plan.day);
      // Everything still to do first, then by setup time.
      const items = (plan.board || []).map((x) => ({ x, st: status(x, done) }))
        .sort((a, b) => rank[a.st.cls] - rank[b.st.cls] || a.x.setupBySort.localeCompare(b.x.setupBySort));
      const rows = items.map(({ x, st }) => tr('board ' + x.category + ' st-row-' + st.cls, x,
        '<td class="stcell">' + statusBadge(st) + '</td>' + check(plan.day, x.key, done.has(x.key)) + roomCell(x) +
        '<td>' + eventCell(x.event) + '</td>' +
        '<td><b>' + esc(x.setup || 'No room setup') + '</b>' + (x.extras.length ? ' + ' + esc(x.extras.join(', ')) : '') +
        (x.build ? '<div class="build">' + esc(buildText(x.build)) + '</div>' : '') + '</td>' +
        '<td><span class="tag">' + esc(x.what) + '</span></td>' +
        '<td class="num">' + esc(x.setupBy) + '</td>'));
      const d = items.filter((i) => i.st.cls === 'done').length;
      all += items.length;
      ready += d;
      return '<div class="day" data-day="' + esc(plan.day) + '"><h2 class="dayhead">' + esc(dayTitle(plan.day)) +
        ' <small>' + d + ' of ' + items.length + ' ready' + (items.length - d ? ' · ' + (items.length - d) + ' still to do' : '') + '</small></h2>' +
        (rows.length
          ? section('board-' + plan.day, 'Bookings', 'still to do first, then by setup time', ['Status', '', 'Room', 'Event', 'Setup', 'What to do', 'Set up by'], rows)
          : '<section><h3>No bookings</h3></section>') +
        '</div>';
    });
    const pct = all ? Math.round((ready / all) * 100) : 0;
    return '<div class="board-top"><div class="big"><b>' + ready + '</b> of ' + all + ' bookings ready</div>' +
      '<div class="bar big-bar"><span style="width:' + pct + '%"></span></div>' +
      '<p class="muted">Ready = marked Ready in Mazevo Manage Operations, marked complete in Mazevo, or ticked here (ticks stay in this browser).' +
      (readAt ? ' Read from Mazevo at ' + esc(readAt) + '. Click Refresh from Mazevo to update now.' : '') + '</p></div>' +
      days.join('');
  }

  function summary(chain, doneFor) {
    const c = { change: 0, empty: 0, midday: 0, check: 0, same: 0 };
    let d = 0;
    let t = 0;
    for (const p of chain.plans) {
      for (const k of Object.keys(c)) c[k] += p.counts[k] || 0;
      const pr = progress(p, doneFor(p.day));
      d += pr.done;
      t += pr.total;
    }
    const target = { change: 'flip', empty: 'free', mid: 'mid', check: 'check', same: 'same' };
    const first = (cat) => {
      const p = chain.plans.find((x) => (cat === 'mid' ? x.midday.length : x.rows.some((r) => r.category === cat)));
      return p ? 'sec-' + p.day + '-' + target[cat] : '';
    };
    const chip = (num, label, cat) => '<button class="chip" data-jump="' + first(cat) + '"' + (num ? '' : ' disabled') + '><b>' + num + '</b>' + esc(label) + '</button>';
    const pct = t ? Math.round((d / t) * 100) : 0;
    return '<div class="summary">' +
      chip(c.change, 'to flip', 'change') + chip(c.empty, 'free to set up', 'empty') + chip(c.midday, 'during the day', 'mid') +
      chip(c.check, 'to check', 'check') + chip(c.same, 'already set', 'same') +
      (t ? '<div class="progress" title="Done = ticked here or complete in Mazevo"><div class="bar"><span style="width:' + pct + '%"></span></div>' +
        '<span><b>' + d + '</b> of ' + t + ' done</span></div>' : '') +
      '</div>';
  }

  // Rows for Copy / CSV, across every planned day.
  function table(chain, doneFor) {
    const head = ['Day', 'Section', 'Status', 'Building', 'Room', 'Earlier event', 'Setup in room', 'Free after', 'Event', 'Needs', 'Other services',
      'What to do', 'Set up by', 'Build', '8-ft tables +/-', '6-ft tables +/-', 'Rounds +/-', 'Chairs +/-', 'Notes'];
    const names = { change: 'Flip', empty: 'Free room', check: 'Check', same: 'Already set', none: 'No setup' };
    const out = [head];
    for (const p of chain.plans) {
      const d = P.dayLabel(p.day);
      const done = doneFor(p.day);
      for (const r of p.rows) {
        const m = r.moves || {};
        const st = r.category === 'change' || r.category === 'empty' ? status(r, done).label : '';
        out.push([d, names[r.category], st, r.building, r.room, r.today ? r.today.number + ' ' + r.today.name : '', r.current, r.freeAfter,
          r.tomorrow.number + ' ' + r.tomorrow.name, r.needed, r.extras.join(', '), r.change, r.setupBy, buildText(r.build),
          m.t8 || '', m.t6 || '', m.round || '', m.chairs || '', r.notes.join('; ')]);
      }
      for (const x of p.midday) {
        const m = x.moves || {};
        out.push([d, 'During the day', status(x, done).label, x.building, x.room, x.from.number + ' ' + x.from.name, x.fromSetup, x.freeAt,
          x.to.number + ' ' + x.to.name, x.toSetup, x.extras.join(', '), x.change, x.setupBy, buildText(x.build),
          m.t8 || '', m.t6 || '', m.round || '', m.chairs || '',
          x.gap < 0 ? 'Overlaps by ' + (-x.gap) + ' min' : x.gap < 30 ? 'Only ' + x.gap + ' min to flip' : '']);
      }
      for (const f of p.freed) {
        out.push([d, 'Not booked', '', f.building, f.room, f.today ? f.today.number + ' ' + f.today.name : '', f.current, f.freeAfter,
          '', '', '', '', '', '', '', '', '', '', '']);
      }
    }
    return out;
  }

  root.MzvRender = { day, board, changes, summary, table, buildText, esc };
})(typeof globalThis !== 'undefined' ? globalThis : this);
