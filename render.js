// Turns a day plan from planner.js into HTML for the report page. No browser
// APIs beyond string building, so it stays easy to test.
(function (root) {
  'use strict';

  const P = root.MazevoPlanner;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

  function fmtDelta(n, one, many) {
    return (n > 0 ? '+' : '−') + Math.abs(n) + ' ' + (Math.abs(n) === 1 ? one : many);
  }

  function movesText(m) {
    if (!m) return '';
    const parts = [];
    if (m.chairs) parts.push(fmtDelta(m.chairs, 'chair', 'chairs'));
    if (m.tables) parts.push(fmtDelta(m.tables, '6-ft table', '6-ft tables'));
    if (m.rounds) parts.push(fmtDelta(m.rounds, 'round', 'rounds'));
    return parts.length ? '<div class="moves">≈ ' + parts.join(' · ') + '</div>' : '';
  }

  function eventCell(ev, opts) {
    opts = opts || {};
    if (!ev) return '<span class="muted">Not used</span>';
    const meta = [ev.number];
    if (opts.time) meta.push(opts.time);
    if (opts.contact && ev.contact) meta.push('Contact: ' + ev.contact);
    let h = '<div class="ev">' + esc(ev.name) + '</div><small>' + esc(meta.filter(Boolean).join(' · ')) + '</small>';
    const badges = [];
    if (ev.status && !/confirmed/i.test(ev.status)) badges.push('<span class="badge hold">' + esc(ev.status) + '</span>');
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

  function setupLine(label, extras, when) {
    return '<div class="line"><b>' + esc(label || 'No room setup') + '</b>' +
      (extras && extras.length ? ' + ' + esc(extras.join(', ')) : '') + (when ? ' · ' + esc(when) : '') + '</div>';
  }

  function roomCell(r) {
    return '<td class="room">' + esc(r.room) + '<small>' + esc(r.building) + '</small></td>';
  }

  function check(key, done) {
    return '<td class="ck"><input type="checkbox" data-key="' + esc(key) + '"' + (done ? ' checked' : '') + ' aria-label="Mark done"></td>';
  }

  function tr(cls, r, inner, searchExtra) {
    const text = [r.room, r.building, r.today && r.today.name, r.tomorrow && r.tomorrow.name, r.from && r.from.name, r.to && r.to.name,
      r.current, r.needed, r.fromSetup, r.toSetup, r.change, searchExtra]
      .filter(Boolean).join(' ').toLowerCase();
    return '<tr class="' + cls + '" data-building="' + esc(r.building) + '" data-search="' + esc(text) + '">' + inner + '</tr>';
  }

  function section(id, title, hint, head, rows, extra) {
    if (!rows.length) return '';
    return '<section id="sec-' + id + '"><h2>' + esc(title) + (hint ? ' <small>' + esc(hint) + '</small>' : '') + '</h2>' +
      '<div class="scroll"><table><thead><tr>' + head.map((h) => '<th' + (h === '' ? ' class="ck"' : '') + '>' + esc(h) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' + (extra || '') + '</section>';
  }

  function freshLabel(id, fresh) {
    if (!fresh) return '';
    if (fresh.added.has(String(id))) return 'New since last check';
    if (fresh.changed.has(String(id))) return 'Updated since last check';
    return '';
  }

  /**
   * plan: one day from planChain. state: { done: Set, fresh: {added:Set, changed:Set}|null }
   */
  function day(plan, state) {
    const done = state.done || new Set();
    const before = P.dayLabel(plan.prevDay);
    const on = P.dayLabel(plan.day);
    const of = (cat) => plan.rows.filter((r) => r.category === cat);
    const what = (r) => '<span class="tag">' + esc(r.change) + '</span>' + movesText(r.moves) + notes(r.notes);
    const beforeSide = (r) => r.today
      ? eventCell(r.today) + setupLine(r.current, null, 'free after ' + r.freeAfter)
      : '<span class="muted">Not used</span>';
    const daySide = (r) => eventCell(r.tomorrow, { planned: true, fresh: freshLabel(r.tomorrow.id, state.fresh) }) +
      setupLine(r.needed, r.extras, 'set up by ' + r.setupBy);

    const flip = of('change').map((r) => tr('change' + (done.has(r.key) ? ' done' : ''), r,
      check(r.key, done.has(r.key)) + roomCell(r) + '<td>' + beforeSide(r) + '</td><td>' + daySide(r) + '</td><td>' + what(r) + '</td>'));

    const free = of('empty').map((r) => tr('empty' + (done.has(r.key) ? ' done' : ''), r,
      check(r.key, done.has(r.key)) + roomCell(r) + '<td>' + daySide(r) + '</td><td>' + what(r) + '</td>'));

    const mid = plan.midday.map((m) => {
      const gap = m.gap <= 0 ? '<span class="badge hold">Back to back</span>'
        : m.gap < 30 ? '<span class="badge hold">Only ' + m.gap + ' min</span>'
          : '<span class="badge plain">' + (m.gap >= 60 ? Math.floor(m.gap / 60) + ' h ' + (m.gap % 60 ? (m.gap % 60) + ' min' : '') : m.gap + ' min') + ' to flip</span>';
      return tr('change' + (done.has(m.key) ? ' done' : ''), m,
        check(m.key, done.has(m.key)) + roomCell(m) +
        '<td>' + eventCell(m.from) + setupLine(m.fromSetup, null, 'free at ' + m.freeAt) + '</td>' +
        '<td>' + eventCell(m.to, { planned: true, fresh: freshLabel(m.to.id, state.fresh) }) + setupLine(m.toSetup, m.extras, 'set up by ' + m.setupBy) + '</td>' +
        '<td><span class="tag">' + esc(m.change) + '</span><div class="badges">' + gap + '</div>' + movesText(m.moves) + '</td>');
    });

    const chk = of('check').map((r) => tr('check', r,
      roomCell(r) + '<td>' + beforeSide(r) + '</td><td>' + eventCell(r.tomorrow, { planned: true, contact: true, fresh: freshLabel(r.tomorrow.id, state.fresh) }) +
      setupLine(r.needed, r.extras, 'starts ' + r.setupBy) + '</td><td>' + what(r) + '</td>'));

    const same = of('same').map((r) => tr('same', r,
      roomCell(r) + '<td>' + beforeSide(r) + '</td><td>' + daySide(r) + '</td><td>' + what(r) + '</td>'));

    const quiet = of('none').map((r) => tr('none', r,
      roomCell(r) + '<td>' + eventCell(r.today) + '</td><td>' + eventCell(r.tomorrow, { time: r.setupBy }) + '</td>'));

    const freed = plan.freed.map((f) => tr('none', f,
      roomCell(f) + '<td>' + eventCell(f.today) + '</td><td>' + esc(f.current || 'No setup ordered') + '</td><td class="time">' + esc(f.freeAfter) + '</td>'));

    const fur = plan.furniture.buildings.map((b) => {
      const cell = (n, one, many) => '<td class="num">' + (n ? fmtDelta(n, one, many) : '<span class="muted">0</span>') + '</td>';
      return tr('none', { building: b.building, room: '' },
        '<td class="room">' + esc(b.building) + '</td><td class="num">' + b.rooms + '</td>' +
        cell(b.chairs, 'chair', 'chairs') + cell(b.tables, 'table', 'tables') + cell(b.rounds, 'round', 'rounds'));
    });
    const furNote = '<p class="foot-note">Estimated from each layout and count, before each room’s first event. ' +
      '+ means bring in, − means take out. ' +
      (plan.furniture.unknown ? plan.furniture.unknown + ' room(s) have a layout the rules don’t cover. ' : '') +
      '<button class="linkish" data-open-settings>Edit the rules</button></p>';

    return '<div class="sections">' +
      section('flip', 'Flip before the first event', 'sorted by when each room frees up', ['', 'Room', 'Before · ' + before, on, 'What to do'], flip) +
      section('free', 'Free rooms: set up any time', 'nothing in the room before then', ['', 'Room', on, 'What to do'], free) +
      section('mid', 'Changeovers during ' + P.longWeekday(plan.day), 'between events in the same room', ['', 'Room', 'Earlier event', 'Next event', 'What to do'], mid) +
      section('check', 'Check with the requester', 'booked, but no room setup ordered', ['Room', 'Before · ' + before, on, 'What’s going on'], chk) +
      section('furniture', 'Furniture to move', 'estimate, per building', ['Building', 'Rooms', 'Chairs', '6-ft tables', 'Rounds'], fur, furNote) +
      section('same', 'Already set', 'no change needed', ['Room', 'Before · ' + before, on, 'Notes'], same) +
      section('none', 'No setup ordered', 'usually outdoor spaces', ['Room', 'Before · ' + before, on], quiet) +
      section('freed', 'Not booked on ' + on, 'used ' + before + ', nothing to set up', ['Room', before, 'Setup left in room', 'Free after'], freed) +
      (plan.rows.length || plan.freed.length ? '' : '<section><h2>No bookings found for ' + esc(before) + ' or ' + esc(on) + '</h2></section>') +
      '</div>';
  }

  function changes(diff, sinceText) {
    if (!diff || !diff.any) return '';
    const items = [];
    for (const a of diff.added) items.push('<li><b>New:</b> ' + esc(a.name) + ' — ' + esc(a.room) + (a.setup ? ', ' + esc(a.setup) : '') + ', set up by ' + esc(P.time(a.setupStart)) + '</li>');
    for (const c of diff.changed) items.push('<li><b>Updated:</b> ' + esc(c.name) + ' — ' + esc(c.room) + ': ' + esc(c.what.join('; ')) + '</li>');
    for (const r of diff.removed) items.push('<li><b>Gone:</b> ' + esc(r.name) + ' — ' + esc(r.room) + ' (cancelled or moved to another day)</li>');
    return '<section class="changes"><h2>Changed since you last checked <small>' + esc(sinceText) + '</small></h2><ul>' + items.join('') + '</ul></section>';
  }

  function summary(plan, doneCount, total) {
    const c = plan.counts;
    const chip = (num, label, target) => '<button class="chip" data-jump="' + target + '"' + (num ? '' : ' disabled') + '><b>' + num + '</b>' + esc(label) + '</button>';
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    return '<div class="summary">' +
      chip(c.change, 'to flip', 'flip') +
      chip(c.empty, 'free to set up', 'free') +
      chip(c.midday, 'during the day', 'mid') +
      chip(c.check, 'to check', 'check') +
      chip(c.same, 'already set', 'same') +
      (total ? '<div class="progress" title="Tick rows as they are done"><div class="bar"><span style="width:' + pct + '%"></span></div>' +
        '<span><b>' + doneCount + '</b> of ' + total + ' done</span></div>' : '') +
      '</div>';
  }

  // Rows for Copy / CSV, across every planned day.
  function table(chain) {
    const head = ['Day', 'Section', 'Building', 'Room', 'Earlier event', 'Setup in room', 'Free after', 'Event', 'Needs', 'Other services',
      'What to do', 'Set up by', 'Chairs', '6-ft tables', 'Rounds', 'Notes'];
    const names = { change: 'Flip', empty: 'Free room', check: 'Check', same: 'Already set', none: 'No setup' };
    const out = [head];
    for (const p of chain.plans) {
      const d = P.dayLabel(p.day);
      for (const r of p.rows) {
        const m = r.moves || {};
        out.push([d, names[r.category], r.building, r.room, r.today ? r.today.number + ' ' + r.today.name : '', r.current, r.freeAfter,
          r.tomorrow.number + ' ' + r.tomorrow.name, r.needed, r.extras.join(', '), r.change, r.setupBy,
          m.chairs || '', m.tables || '', m.rounds || '', r.notes.join('; ')]);
      }
      for (const x of p.midday) {
        const m = x.moves || {};
        out.push([d, 'During the day', x.building, x.room, x.from.number + ' ' + x.from.name, x.fromSetup, x.freeAt,
          x.to.number + ' ' + x.to.name, x.toSetup, x.extras.join(', '), x.change, x.setupBy, m.chairs || '', m.tables || '', m.rounds || '',
          x.gap < 30 ? 'Only ' + Math.max(0, x.gap) + ' min to flip' : '']);
      }
      for (const f of p.freed) {
        out.push([d, 'Not booked', f.building, f.room, f.today ? f.today.number + ' ' + f.today.name : '', f.current, f.freeAfter, '', '', '', '', '', '', '', '', '']);
      }
    }
    return out;
  }

  root.MzvRender = { day, changes, summary, table, esc };
})(typeof globalThis !== 'undefined' ? globalThis : this);
