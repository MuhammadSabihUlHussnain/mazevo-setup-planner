// Pure planning logic: no DOM, no Chrome APIs. Shared by content.js and
// report.js, and runnable under Node for testing.
(function (root) {
  'use strict';

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function pad(n) { return String(n).padStart(2, '0'); }

  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function addDays(day, n) {
    const [y, m, d] = day.split('-').map(Number);
    return ymd(new Date(y, m - 1, d + n));
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

  function dayLabel(day) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // Keep only the fields the planner needs from a raw GetBookings row.
  function condense(raw) {
    return {
      id: raw.bookingId,
      eventNumber: raw.eventNumber || '',
      eventName: (raw.eventName || '').trim(),
      organization: raw.organizationName || '',
      building: (raw.building || '').trim(),
      room: (raw.room || '').trim(),
      status: raw.statusDescription || '',
      setupStart: raw.localSetupDateTimeStart || raw.localDateTimeStart,
      start: raw.localDateTimeStart,
      end: raw.localDateTimeEnd,
      teardownEnd: raw.localTeardownDateTimeEnd || raw.localDateTimeEnd,
      services: (raw.statuses || []).map((s) => ({
        provider: (s.serviceProvider || '').trim(),
        description: (s.serviceDescription || '').trim()
      }))
    };
  }

  function onDay(b, day) {
    return String(b.start).slice(0, 10) <= day && String(b.end).slice(0, 10) >= day;
  }

  const isRoomSetup = (s) => /room\s*set\s*up/i.test(s.provider);

  // "Classroom Style (50)" -> { label, style: "Classroom Style", count: 50 }
  function roomSetup(b) {
    const s = b.services.find(isRoomSetup);
    if (!s) return null;
    if (!s.description) return { label: 'Room Setup (no layout given)', style: '', count: null };
    const m = s.description.match(/^(.*?)\s*\((\d+)\)\s*$/);
    return m
      ? { label: s.description, style: m[1].trim(), count: +m[2] }
      : { label: s.description, style: s.description, count: null };
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

  function event(b) {
    return b ? { id: b.id, number: b.eventNumber, name: b.eventName, status: b.status } : null;
  }

  /**
   * Compare the last setup left in each room today with the first setup each
   * room needs tomorrow.
   *
   * Row categories:
   *   change - room is used today and needs a different setup or count tomorrow
   *   same   - today's setup already matches tomorrow's
   *   empty  - room is not used today, so it can be set up any time
   *   check  - tomorrow's booking has no room setup ordered (worth asking)
   *   none   - no setup ordered today or tomorrow (outdoor spaces etc.)
   * Rooms used today with nothing tomorrow are returned in `freed`.
   */
  function plan(todayRaw, tomorrowRaw, days) {
    const rooms = new Map();
    const slot = (b) => {
      const key = b.building + '\u0000' + b.room;
      if (!rooms.has(key)) rooms.set(key, { building: b.building, room: b.room, today: [], tomorrow: [] });
      return rooms.get(key);
    };
    todayRaw.filter((b) => onDay(b, days.today)).forEach((b) => slot(b).today.push(b));
    tomorrowRaw.filter((b) => onDay(b, days.tomorrow)).forEach((b) => slot(b).tomorrow.push(b));

    const rows = [];
    const freed = [];

    for (const r of rooms.values()) {
      r.today.sort((a, b) => String(a.teardownEnd).localeCompare(String(b.teardownEnd)));
      r.tomorrow.sort((a, b) => String(a.setupStart).localeCompare(String(b.setupStart)));
      const last = r.today[r.today.length - 1] || null;
      const first = r.tomorrow[0] || null;
      const current = last ? roomSetup(last) : null;

      if (!first) {
        freed.push({ building: r.building, room: r.room, today: event(last), current: short(current), freeAfter: time(last.teardownEnd) });
        continue;
      }

      const needed = roomSetup(first);
      const extras = otherServices(first);
      const notes = [];
      let category;
      let change;

      if (last && last.id === first.id) {
        category = 'same';
        change = 'Booking continues from today';
      } else if (!needed) {
        if (current) {
          category = 'check';
          change = 'No setup ordered for tomorrow. ' + short(current) + ' from today is still in place';
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
        change = 'Set up ' + short(needed) + ' (nothing was ordered today)';
      } else if (norm(current.style) === norm(needed.style)) {
        const diff = needed.count != null && current.count != null ? needed.count - current.count : 0;
        if (!diff) {
          category = 'same';
          change = 'No change';
        } else {
          const unit = isTabling(needed) ? (Math.abs(diff) === 1 ? 'table' : 'tables') : (Math.abs(diff) === 1 ? 'seat' : 'seats');
          category = 'change';
          change = (diff > 0 ? 'Add ' : 'Remove ') + Math.abs(diff) + ' ' + unit;
        }
      } else {
        category = 'change';
        change = short(current) + ' → ' + short(needed);
      }

      if (first.status && !/confirmed/i.test(first.status)) {
        notes.push('Tomorrow’s booking is on ' + first.status + ', not confirmed');
      }
      for (const s of [current, needed]) {
        if (s && s.count === 1 && !isTabling(s)) notes.push('“' + s.label + '” has a count of 1, which looks like a typo');
      }
      for (const later of r.tomorrow.slice(1)) {
        const ls = roomSetup(later);
        const same = ls && needed && norm(ls.label) === norm(needed.label);
        notes.push('Then ' + later.eventName + ' at ' + time(later.setupStart) + ': ' +
          (ls ? (same ? 'same setup' : short(ls)) : 'no setup ordered'));
      }

      rows.push({
        category,
        building: r.building,
        room: r.room,
        today: event(last),
        current: last ? (current ? short(current) : 'No setup ordered') : '',
        freeAfter: last ? time(last.teardownEnd) : '',
        freeAfterSort: last ? String(last.teardownEnd) : '',
        tomorrow: event(first),
        needed: needed ? short(needed) : '',
        extras,
        change,
        setupBy: time(first.setupStart),
        setupBySort: String(first.setupStart),
        notes
      });
    }

    const byRoom = (a, b) => (a.building + a.room).localeCompare(b.building + b.room);
    rows.sort((a, b) => {
      const order = { change: 0, empty: 1, check: 2, same: 3, none: 4 };
      if (order[a.category] !== order[b.category]) return order[a.category] - order[b.category];
      if (a.category === 'change') return a.freeAfterSort.localeCompare(b.freeAfterSort) || byRoom(a, b);
      if (a.category === 'empty' || a.category === 'check') return a.setupBySort.localeCompare(b.setupBySort) || byRoom(a, b);
      return byRoom(a, b);
    });
    freed.sort(byRoom);

    const counts = {};
    for (const r of rows) counts[r.category] = (counts[r.category] || 0) + 1;
    counts.freed = freed.length;

    return { today: days.today, tomorrow: days.tomorrow, rows, freed, counts };
  }

  const api = { ymd, addDays, parseLabelDate, time, dayLabel, condense, plan };
  root.MazevoPlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
