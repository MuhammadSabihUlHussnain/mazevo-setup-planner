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
      ready: !!raw.bookingIsReady, // the "Ready" column crews tick in Manage Operations
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
    // "See Notes (1)": the real layout is written in the booking's notes, which
    // only Mazevo's booking details show. The number is a placeholder.
    if (/^see\s*notes?\b/i.test(s.description)) return { label: 'See notes in Mazevo', style: 'See notes', count: null, seeNotes: true, state: s.state };
    const m = s.description.match(/^(.*?)\s*\((\d+)\)\s*$/);
    return m
      ? { label: s.description, style: m[1].trim(), count: +m[2], state: s.state }
      : { label: s.description, style: s.description, count: null, state: s.state };
  }

  // Services the crew cares about besides the room setup (not billing lines).
  function otherServices(b) {
    return b.services.filter((s) => !isRoomSetup(s) && !/misc|charge|fee|billing|invoice/i.test(s.provider))
      .map((s) => s.provider).filter(Boolean);
  }

  // Booking statuses that mean "not settled yet". Other statuses such as
  // "Setup (Union Staff)" are normal working statuses.
  const isTentative = (status) => /hold|tentativ|pending|request|wait|inquir|cancel/i.test(status || '');

  // "Classroom Style (50)" -> "Classroom (50)"
  function short(setup) {
    return setup ? setup.label.replace(/\s+style\b/i, '') : '';
  }

  const norm = (s) => String(s).toLowerCase().replace(/\bstyle\b/g, '').replace(/[^a-z0-9]/g, '');

  const isTabling = (setup) => /tabl/i.test(setup.style);

  const sameSetup = (a, b) => !!a && !!b && !a.seeNotes && !b.seeNotes && norm(a.style) === norm(b.style) && a.count === b.count;

  function event(b) {
    return b ? {
      id: b.id, number: b.eventNumber, name: b.eventName, status: b.status, organization: b.organization,
      contact: b.contact, changed: b.changed, diagram: b.diagram, instructions: b.instructions, headcount: b.headcount
    } : null;
  }

  const roomKey = (b) => b.building + '\u0000' + b.room;

  // What it takes to turn `from` into `to`, in words.
  function describeChange(from, to) {
    if (to.seeNotes) return 'Set up as described in the booking notes (open it in Mazevo)';
    if (!from) return 'Set up ' + short(to);
    if (from.seeNotes) return 'Set up ' + short(to) + ' (the room was set from booking notes)';
    if (norm(from.style) === norm(to.style)) {
      const diff = to.count != null && from.count != null ? to.count - from.count : 0;
      if (!diff) return 'No change';
      const unit = isTabling(to) ? (Math.abs(diff) === 1 ? 'table' : 'tables') : (Math.abs(diff) === 1 ? 'seat' : 'seats');
      return (diff > 0 ? 'Add ' : 'Remove ') + Math.abs(diff) + ' ' + unit;
    }
    return short(from) + ' → ' + short(to);
  }

  // ---------- furniture ----------

  // Table types and how many chairs go at each one.
  const TABLES = [
    { key: 't8', label: '8-ft table', many: '8-ft tables' },
    { key: 't6', label: '6-ft table', many: '6-ft tables' },
    { key: 'round', label: 'banquet round', many: 'banquet rounds' }
  ];

  // Editable in Settings. Each layout uses one table type ('' = chairs only).
  // Tabling counts tables rather than people. A building can have its own
  // chairs-per-table, and 0 means that table type isn't used there.
  const DEFAULT_FURNITURE = {
    seats: { t8: 4, t6: 2, round: 8 },
    layouts: [
      { name: 'Classroom', match: 'classroom, schoolroom', table: 't6' },
      { name: 'Banquet', match: 'banquet, rounds, crescent', table: 'round' },
      { name: 'Hollow square', match: 'hollow square, conference, boardroom', table: 't8' },
      { name: 'U-shape', match: 'u-shape, u shape', table: 't8' },
      { name: 'Theatre', match: 'theater, theatre, auditorium', table: '' },
      { name: 'Tabling', match: 'tabling, vendor, exhibit', table: 't6', perTable: true, chairsPerTable: 2 }
    ],
    buildings: [
      { match: 'trent lott', seats: { t8: 3, t6: 0, round: 6 } }
    ]
  };

  const ZERO = { chairs: 0, t8: 0, t6: 0, round: 0 };

  const matches = (list, text) => String(list).split(',').map(norm).some((w) => w && norm(text).includes(w));

  // Chairs per table for this building; a type set to 0 there is swapped for
  // the other rectangular table (or rounds as a last resort).
  function seatsFor(cfg, building, type) {
    const b = (cfg.buildings || []).find((x) => x.match && matches(x.match, building));
    const seat = (t) => {
      if (b && b.seats && b.seats[t] !== undefined && b.seats[t] !== null && b.seats[t] !== '') return +b.seats[t];
      return +(cfg.seats || DEFAULT_FURNITURE.seats)[t] || 0;
    };
    const order = { t6: ['t6', 't8', 'round'], t8: ['t8', 't6', 'round'], round: ['round', 't8', 't6'] }[type] || [type];
    for (const t of order) if (seat(t) > 0) return { type: t, seats: seat(t) };
    return null;
  }

  /** What a setup is built from: { chairs, t8, t6, round }, ZERO for no setup, null if unknown. */
  function furniture(setup, cfg, building) {
    cfg = cfg || DEFAULT_FURNITURE;
    if (!setup) return ZERO;
    if (setup.count == null) return null;
    const layout = (cfg.layouts || []).find((l) => l.match && matches(l.match, setup.style));
    if (!layout) return null;
    const out = { chairs: 0, t8: 0, t6: 0, round: 0 };
    const n = setup.count;
    if (!layout.table) {
      out.chairs = n;
      return out;
    }
    const t = seatsFor(cfg, building, layout.table);
    if (!t) return null;
    if (layout.perTable) {
      out[t.type] = n;
      out.chairs = n * (+layout.chairsPerTable || 0);
    } else {
      out[t.type] = Math.ceil(n / t.seats);
      out.chairs = n;
    }
    return out;
  }

  // Furniture to bring in (+) or take out (-) to go from one setup to another.
  function moves(from, to, cfg, building) {
    const a = furniture(from, cfg, building);
    const b = furniture(to, cfg, building);
    if (!a || !b) return null;
    return { chairs: b.chairs - a.chairs, t8: b.t8 - a.t8, t6: b.t6 - a.t6, round: b.round - a.round };
  }

  // Readiness from Mazevo: the booking's Ready flag (what crews tick in Manage
  // Operations), else the Room Setup service status.
  function readiness(setup, booking) {
    if (booking && booking.ready) return 'ready';
    const st = setup && setup.state ? setup.state : '';
    if (/complete|done|finish|ready/i.test(st)) return 'done';
    if (/progress|started/i.test(st) && !/not\s*started/i.test(st)) return 'progress';
    return st ? 'todo' : '';
  }

  // ---------- planning ----------

  /**
   * Plan one day. `history` maps each room to { last, setup }: the last booking
   * seen in it on earlier days of the window, and the last one that ordered a
   * room setup (a later booking with no setup leaves that setup in place); `prevList` is the day before; `list` is the
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
    const cfg = ctx.furniture || DEFAULT_FURNITURE;
    const rooms = new Map();
    for (const b of list) {
      const k = roomKey(b);
      if (!rooms.has(k)) rooms.set(k, { building: b.building, room: b.room, list: [] });
      rooms.get(k).list.push(b);
    }

    const rows = [];
    const midday = [];
    // Every booking on the day, for the status board (matches Mazevo's Ready column).
    const board = [];
    const entry = (key, b, setup, what, category) => ({
      key, category, building: b.building, room: b.room, event: event(b),
      setup: setup ? short(setup) : '', extras: otherServices(b), build: setup ? furniture(setup, cfg, b.building) : null,
      setupBy: time(b.setupStart), setupBySort: String(b.setupStart), ready: readiness(setup, b), what
    });

    for (const [k, r] of rooms) {
      r.list.sort((a, b) => String(a.setupStart).localeCompare(String(b.setupStart)));
      const seen = history.get(k);
      const last = seen ? seen.last : null;
      const first = r.list[0];
      const current = seen && seen.setup ? roomSetup(seen.setup) : null;
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
        change = describeChange(null, needed);
      } else if (!current) {
        category = 'change';
        change = needed.seeNotes ? describeChange(null, needed) : 'Set up ' + short(needed) + ' (nothing was set before)';
      } else {
        change = describeChange(current, needed);
        category = change === 'No change' ? 'same' : 'change';
      }

      if (isTentative(first.status)) notes.push('On ' + first.status + ', not confirmed yet');
      for (const s of [current, needed]) {
        if (s && s.count === 1 && !isTabling(s)) notes.push('“' + s.label + '” has a count of 1. Check the real number in Mazevo');
      }
      if (needed && needed.count && first.headcount > needed.count && !isTabling(needed)) {
        notes.push('Expecting ' + first.headcount + ' people but set for ' + needed.count);
      }

      // Changeovers between this room's events later the same day. A booking
      // with no setup ordered leaves the previous setup in the room.
      let inRoom = needed || current;
      for (let i = 1; i < r.list.length; i++) {
        const a = r.list[i - 1];
        const b = r.list[i];
        const sa = inRoom;
        const sb = roomSetup(b);
        if (!sb || sameSetup(sa, sb)) {
          notes.push('Then ' + b.eventName + ' at ' + time(b.setupStart) + (sb ? ' (same setup)' : ' (no setup ordered)'));
          board.push(entry('bk:' + b.id, b, sb, sb ? 'Same setup as the earlier event' : 'No setup ordered' + (sa ? '. ' + short(sa) + ' stays' : ''), 'same'));
          continue;
        }
        board.push(entry('mid:' + b.id, b, sb, describeChange(sa, sb), 'change'));
        inRoom = sb;
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
          moves: moves(sa, sb, cfg, r.building),
          build: furniture(sb, cfg, r.building),
          ready: readiness(sb, b),
          state: sb.state || '',
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
        moves: category === 'change' || category === 'empty' ? moves(current, needed, cfg, r.building) : null,
        build: needed ? furniture(needed, cfg, r.building) : null,
        ready: readiness(needed, first),
        state: needed ? needed.state || '' : '',
        notes
      });
      board.push(entry('first:' + first.id, first, needed, change, category));
    }
    board.sort((a, b) => a.setupBySort.localeCompare(b.setupBySort) || (a.building + a.room).localeCompare(b.building + b.room));

    // Rooms used the day before that have nothing on this day.
    const freed = [];
    const freedSeen = new Set();
    const prevSorted = prevList.slice().sort((a, b) => String(b.teardownEnd).localeCompare(String(a.teardownEnd)));
    for (const b of prevSorted) {
      const k = roomKey(b);
      if (rooms.has(k) || freedSeen.has(k)) continue;
      freedSeen.add(k);
      const seen = history.get(k);
      freed.push({ building: b.building, room: b.room, today: event(b), current: seen && seen.setup ? short(roomSetup(seen.setup)) : '', freeAfter: time(b.teardownEnd) });
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
      const t = totals.get(r.building) || { building: r.building, chairs: 0, t8: 0, t6: 0, round: 0, rooms: 0 };
      for (const f of ['chairs', 't8', 't6', 'round']) t[f] += r.moves[f];
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
      board,
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
    const later = (a, b) => !b || String(a.teardownEnd) > String(b.teardownEnd);
    const remember = (list) => {
      for (const b of list) {
        const k = roomKey(b);
        const h = history.get(k) || { last: null, setup: null };
        if (later(b, h.last)) h.last = b;
        if (roomSetup(b) && later(b, h.setup)) h.setup = b;
        history.set(k, h);
      }
    };
    remember(per[0]);
    const plans = [];
    for (let i = 1; i < days.length; i++) {
      plans.push(planDay(history, per[i - 1], per[i], { prevDay: days[i - 1], day: days[i], furniture: opts && opts.furniture }));
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

  // Combine an earlier diff with a newer one, so changes add up across refreshes.
  function mergeDiff(older, newer) {
    if (!older) return newer;
    if (!newer) return older;
    const byId = (list) => new Map(list.map((x) => [String(x.id), x]));
    const added = byId(older.added);
    const removed = byId(older.removed);
    const changed = byId(older.changed);
    for (const a of newer.added) { removed.delete(String(a.id)); added.set(String(a.id), a); }
    for (const r of newer.removed) {
      const id = String(r.id);
      if (added.has(id)) added.delete(id); else removed.set(id, r);
      changed.delete(id);
    }
    for (const c of newer.changed) {
      const id = String(c.id);
      if (added.has(id)) { added.set(id, { ...c, what: undefined }); continue; } // still "new"
      const prev = changed.get(id);
      changed.set(id, prev ? { ...c, what: prev.what.concat(c.what) } : c);
    }
    const out = { added: [...added.values()], removed: [...removed.values()], changed: [...changed.values()] };
    out.any = out.added.length + out.removed.length + out.changed.length > 0;
    return out;
  }

  const api = {
    ymd, addDays, parseLabelDate, time, dayLabel, weekday, longWeekday, condense,
    plan, planChain, diff, mergeDiff, furniture, isTentative, DEFAULT_FURNITURE, TABLES
  };
  root.MazevoPlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
