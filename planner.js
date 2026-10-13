// Pure planning logic: no DOM, no browser APIs. Shared by content.js and the
// report page, and runnable under Node for testing.
(function (root) {
  'use strict';

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  // ---------- dates and times ----------

  function pad(n) { return String(n).padStart(2, '0'); }

  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function toDate(day) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(day, n) {
    const d = toDate(day);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  // "Tuesday Oct 13, 2026" -> "2026-10-13"
  function parseLabelDate(text) {
    const m = String(text).trim().match(/^[A-Za-z]+,? ([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})$/);
    if (!m || MONTHS[m[1].toLowerCase()] === undefined) return null;
    return ymd(new Date(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
  }

  // "2026-10-13T15:00:00" -> "3:00 PM"
  function time(local) {
    if (!local) return '';
    const m = String(local).match(/T(\d{2}):(\d{2})/);
    if (!m) return '';
    const h = +m[1];
    return ((h % 12) || 12) + ':' + m[2] + (h < 12 ? ' AM' : ' PM');
  }

  function minutes(local) {
    const m = String(local).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (!m) return 0;
    return Math.round(toDate(m[1]).getTime() / 60000) + (+m[2]) * 60 + (+m[3]);
  }

  function dayLabel(day) {
    return toDate(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function weekday(day) {
    return toDate(day).toLocaleDateString('en-US', { weekday: 'short' });
  }

  function longWeekday(day) {
    return toDate(day).toLocaleDateString('en-US', { weekday: 'long' });
  }

  // ---------- bookings ----------

  const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  // Keep only the fields the planner uses from a raw GetBookings row.
  function condense(raw) {
    const url = typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url) ? raw.url : null;
    return {
      id: raw.bookingId,
      eventNumber: raw.eventNumber || '',
      eventName: (raw.eventName || '').trim(),
      organization: (raw.organizationName || '').trim(),
      contact: (raw.contactName || '').trim(),
      building: (raw.building || '').trim(),
      room: (raw.room || '').trim(),
      status: raw.statusDescription || '',
      setupStart: raw.localSetupDateTimeStart || raw.localDateTimeStart,
      start: raw.localDateTimeStart,
      end: raw.localDateTimeEnd,
      teardownEnd: raw.localTeardownDateTimeEnd || raw.localDateTimeEnd,
      headcount: +raw.attendance || 0,
      changed: !!raw.bookingChanged,
      diagram: url && raw.showUrl !== false ? { url, label: (raw.urlDescription || 'Diagram').trim() } : null,
      instructions: stripHtml(raw.reviewedNotes || raw.originalNotes),
      services: (raw.statuses || []).map((s) => ({
        provider: (s.serviceProvider || '').trim(),
        description: (s.serviceDescription || '').trim(),
        state: s.statusDescription || ''
      }))
    };
  }

  function onDay(b, day) {
    return String(b.start).slice(0, 10) <= day && String(b.end).slice(0, 10) >= day;
  }

  const isRoomSetup = (s) => /room\s*set\s*up/i.test(s.provider);

  // "Classroom Style (50)" -> { label, style: "Classroom Style", count: 50 }
  function roomSetup(b) {
    const s = b && b.services.find(isRoomSetup);
    if (!s) return null;
    if (!s.description) return { label: 'Room Setup (no layout given)', style: '', count: null, state: s.state };
    const m = s.description.match(/^(.*?)\s*\((\d+)\)\s*$/);
    return m
      ? { label: s.description, style: m[1].trim(), count: +m[2], state: s.state }
      : { label: s.description, style: s.description, count: null, state: s.state };
  }

  function otherServices(b) {
    return b.services.filter((s) => !isRoomSetup(s)).map((s) => s.provider).filter(Boolean);
  }

  // "Classroom Style (50)" -> "Classroom (50)"
  function short(setup) {
    return setup ? setup.label.replace(/\s+style\b/i, '') : '';
  }

  const norm = (s) => String(s).toLowerCase().replace(/\bstyle\b/g, '').replace(/[^a-z0-9]/g, '');

  const isTabling = (setup) => /tabl/i.test(setup.style);

  const sameSetup = (a, b) => !!a && !!b && norm(a.style) === norm(b.style) && a.count === b.count;

  function event(b) {
    return b ? {
      id: b.id, number: b.eventNumber, name: b.eventName, status: b.status, organization: b.organization,
      contact: b.contact, changed: b.changed, diagram: b.diagram, instructions: b.instructions, headcount: b.headcount
    } : null;
  }

  const roomKey = (b) => b.building + '\u0000' + b.room;

  // What it takes to turn `from` into `to`, in words.
  function describeChange(from, to) {
    if (!from) return 'Set up ' + short(to);
    if (norm(from.style) === norm(to.style)) {
      const diff = to.count != null && from.count != null ? to.count - from.count : 0;
      if (!diff) return 'No change';
      const unit = isTabling(to) ? (Math.abs(diff) === 1 ? 'table' : 'tables') : (Math.abs(diff) === 1 ? 'seat' : 'seats');
      return (diff > 0 ? 'Add ' : 'Remove ') + Math.abs(diff) + ' ' + unit;
    }
    return short(from) + ' → ' + short(to);
  }

  // ---------- furniture estimates ----------

  // Per unit of the setup count (guests, or tables for tabling). Editable in Settings.
  const DEFAULT_RULES = [
    { match: 'theater, theatre, auditorium', chairs: 1, tables: 0, rounds: 0 },
    { match: 'classroom, schoolroom', chairs: 1, tables: 0.5, rounds: 0 },
    { match: 'banquet, rounds, crescent', chairs: 1, tables: 0, rounds: 0.125 },
    { match: 'hollow square, u-shape, conference, boardroom', chairs: 1, tables: 0.5, rounds: 0 },
    { match: 'tabling, vendor, exhibit', chairs: 2, tables: 1, rounds: 0 }
  ];

  const ZERO = { chairs: 0, tables: 0, rounds: 0 };

  function furniture(setup, rules) {
    if (!setup) return ZERO;
    if (setup.count == null) return null;
    const s = norm(setup.style);
    const rule = (rules || DEFAULT_RULES).find((r) =>
      String(r.match).split(',').map(norm).some((w) => w && s.includes(w)));
    if (!rule) return null;
    const n = setup.count;
    return {
      chairs: Math.ceil(n * (+rule.chairs || 0)),
      tables: Math.ceil(n * (+rule.tables || 0)),
      rounds: Math.ceil(n * (+rule.rounds || 0))
    };
  }

  // Furniture to bring in (+) or take out (-) to go from one setup to another.
  function moves(from, to, rules) {
    const a = furniture(from, rules);
    const b = furniture(to, rules);
    if (!a || !b) return null;
    return { chairs: b.chairs - a.chairs, tables: b.tables - a.tables, rounds: b.rounds - a.rounds };
  }

  // ---------- planning ----------

  /**
   * Plan one day. `history` maps each room to the last booking seen in it on
   * earlier days of the window; `prevList` is the day before; `list` is the
   * day being planned.
   *
   * Row categories:
   *   change - needs a different setup or count than what was left in the room
   *   same   - what was left in the room already matches
   *   empty  - no earlier booking in the window, so it can be set up any time
   *   check  - booked, but no room setup ordered (worth asking)
   *   none   - no setup ordered on either side (outdoor spaces etc.)
   * `midday` lists changeovers between events on the same day; `freed` lists
   * rooms used the day before with nothing on this day.
   */
  function planDay(history, prevList, list, ctx) {
    const rules = ctx.rules || DEFAULT_RULES;
    const rooms = new Map();
    for (const b of list) {
      const k = roomKey(b);
      if (!rooms.has(k)) rooms.set(k, { building: b.building, room: b.room, list: [] });
      rooms.get(k).list.push(b);
    }

    const rows = [];
    const midday = [];

    for (const [k, r] of rooms) {
      r.list.sort((a, b) => String(a.setupStart).localeCompare(String(b.setupStart)));
      const last = history.get(k) || null;
      const first = r.list[0];
      const current = last ? roomSetup(last) : null;
      const needed = roomSetup(first);
      const extras = otherServices(first);
      const notes = [];
      let category;
      let change;

      if (last && last.id === first.id) {
        category = 'same';
        change = 'Booking continues from ' + weekday(String(last.start).slice(0, 10));
      } else if (!needed) {
        if (current) {
          category = 'check';
          change = 'No setup ordered. ' + short(current) + ' is still in the room';
        } else if (extras.length) {
          category = 'check';
          change = 'No room setup ordered, only ' + extras.join(', ');
        } else {
          category = 'none';
          change = 'No setup ordered';
        }
      } else if (!last) {
        category = 'empty';
        change = 'Set up ' + short(needed);
      } else if (!current) {
        category = 'change';
        change = 'Set up ' + short(needed) + ' (nothing was set before)';
      } else {
        change = describeChange(current, needed);
        category = change === 'No change' ? 'same' : 'change';
      }

      if (first.status && !/confirmed/i.test(first.status)) notes.push('On ' + first.status + ', not confirmed yet');
      for (const s of [current, needed]) {
        if (s && s.count === 1 && !isTabling(s)) notes.push('“' + s.label + '” has a count of 1, which looks like a typo');
      }
      if (needed && needed.count && first.headcount > needed.count && !isTabling(needed)) {
        notes.push('Expecting ' + first.headcount + ' people but set for ' + needed.count);
      }

      // Changeovers between this room's events later the same day.
      for (let i = 1; i < r.list.length; i++) {
        const a = r.list[i - 1];
        const b = r.list[i];
        const sa = roomSetup(a);
        const sb = roomSetup(b);
        if (!sb || sameSetup(sa, sb)) {
          notes.push('Then ' + b.eventName + ' at ' + time(b.setupStart) + (sb ? ' (same setup)' : ' (no setup ordered)'));
          continue;
        }
        notes.push('Changes to ' + short(sb) + ' at ' + time(a.teardownEnd) + ' for ' + b.eventName);
        const gap = minutes(b.setupStart) - minutes(a.teardownEnd);
        midday.push({
          key: 'mid:' + b.id,
          building: r.building,
          room: r.room,
          from: event(a),
          fromSetup: sa ? short(sa) : 'No setup ordered',
          to: event(b),
          toSetup: short(sb),
          extras: otherServices(b),
          change: describeChange(sa, sb),
          freeAt: time(a.teardownEnd),
          setupBy: time(b.setupStart),
          gap,
          moves: moves(sa, sb, rules),
          sort: String(a.teardownEnd)
        });
      }

      const lastDay = last ? String(last.teardownEnd).slice(0, 10) : '';
      rows.push({
        key: 'first:' + first.id,
        category,
        building: r.building,
        room: r.room,
        today: event(last),
        current: last ? (current ? short(current) : 'No setup ordered') : '',
        freeAfter: last ? (lastDay && lastDay !== ctx.prevDay ? weekday(lastDay) + ' ' : '') + time(last.teardownEnd) : '',
        freeAfterSort: last ? String(last.teardownEnd) : '',
        tomorrow: event(first),
        needed: needed ? short(needed) : '',
        extras,
        change,
        setupBy: time(first.setupStart),
        setupBySort: String(first.setupStart),
        moves: category === 'change' || category === 'empty' ? moves(current, needed, rules) : null,
        notes
      });
    }

    // Rooms used the day before that have nothing on this day.
    const freed = [];
    const freedSeen = new Set();
    const prevSorted = prevList.slice().sort((a, b) => String(b.teardownEnd).localeCompare(String(a.teardownEnd)));
    for (const b of prevSorted) {
      const k = roomKey(b);
      if (rooms.has(k) || freedSeen.has(k)) continue;
      freedSeen.add(k);
      freed.push({ building: b.building, room: b.room, today: event(b), current: short(roomSetup(b)), freeAfter: time(b.teardownEnd) });
    }

    const byRoom = (a, b) => (a.building + a.room).localeCompare(b.building + b.room);
    const order = { change: 0, empty: 1, check: 2, same: 3, none: 4 };
    rows.sort((a, b) => {
      if (order[a.category] !== order[b.category]) return order[a.category] - order[b.category];
      if (a.category === 'change') return a.freeAfterSort.localeCompare(b.freeAfterSort) || byRoom(a, b);
      if (a.category === 'empty' || a.category === 'check') return a.setupBySort.localeCompare(b.setupBySort) || byRoom(a, b);
      return byRoom(a, b);
    });
    midday.sort((a, b) => a.sort.localeCompare(b.sort) || byRoom(a, b));
    freed.sort(byRoom);

    // Furniture to move before each room's first event, per building.
    const totals = new Map();
    let unknown = 0;
    for (const r of rows) {
      if (r.category !== 'change' && r.category !== 'empty') continue;
      if (!r.moves) { unknown++; continue; }
      const t = totals.get(r.building) || { building: r.building, chairs: 0, tables: 0, rounds: 0, rooms: 0 };
      t.chairs += r.moves.chairs;
      t.tables += r.moves.tables;
      t.rounds += r.moves.rounds;
      t.rooms++;
      totals.set(r.building, t);
    }

    const counts = { change: 0, empty: 0, check: 0, same: 0, none: 0 };
    for (const r of rows) counts[r.category]++;
    counts.midday = midday.length;
    counts.freed = freed.length;

    return {
      prevDay: ctx.prevDay,
      day: ctx.day,
      rows,
      midday,
      freed,
      furniture: { buildings: [...totals.values()].sort((a, b) => a.building.localeCompare(b.building)), unknown },
      counts,
      snapshot: snapshot(list)
    };
  }

  /**
   * days: [base, base+1, ...]; lists: the bookings for each of those days.
   * Plans every day after the base, carrying forward what was left in each room.
   */
  function planChain(lists, days, opts) {
    const per = days.map((d, i) => (lists[i] || []).filter((b) => onDay(b, d)));
    const history = new Map();
    const remember = (list) => {
      for (const b of list) {
        const k = roomKey(b);
        const prev = history.get(k);
        if (!prev || String(b.teardownEnd) > String(prev.teardownEnd)) history.set(k, b);
      }
    };
    remember(per[0]);
    const plans = [];
    for (let i = 1; i < days.length; i++) {
      plans.push(planDay(history, per[i - 1], per[i], { prevDay: days[i - 1], day: days[i], rules: opts && opts.rules }));
      remember(per[i]);
    }
    return { base: days[0], plans };
  }

  // Back-compatible two-day plan.
  function plan(todayRaw, tomorrowRaw, days, opts) {
    return planChain([todayRaw, tomorrowRaw], [days.today, days.tomorrow], opts).plans[0];
  }

  // ---------- "what changed since you last looked" ----------

  function snapshot(list) {
    const items = {};
    for (const b of list) {
      const s = roomSetup(b);
      items[b.id] = {
        name: b.eventName, building: b.building, room: b.room,
        setup: s ? short(s) : '', setupStart: b.setupStart, end: b.end, status: b.status
      };
    }
    return items;
  }

  function diff(before, after) {
    const added = [];
    const removed = [];
    const changed = [];
    for (const id of Object.keys(after)) {
      const a = after[id];
      const b = before[id];
      if (!b) { added.push({ id, ...a }); continue; }
      const what = [];
      if (b.building !== a.building || b.room !== a.room) what.push('moved from ' + b.room + ' to ' + a.room);
      if (b.setup !== a.setup) what.push('setup ' + (b.setup || 'none') + ' → ' + (a.setup || 'none'));
      if (b.setupStart !== a.setupStart) what.push('setup time ' + time(b.setupStart) + ' → ' + time(a.setupStart));
      if (b.end !== a.end) what.push('ends ' + time(b.end) + ' → ' + time(a.end));
      if (b.status !== a.status) what.push(b.status + ' → ' + a.status);
      if (what.length) changed.push({ id, ...a, what });
    }
    for (const id of Object.keys(before)) if (!after[id]) removed.push({ id, ...before[id] });
    return { added, removed, changed, any: added.length + removed.length + changed.length > 0 };
  }

  const api = {
    ymd, addDays, parseLabelDate, time, dayLabel, weekday, longWeekday, condense,
    plan, planChain, diff, furniture, DEFAULT_RULES
  };
  root.MazevoPlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
