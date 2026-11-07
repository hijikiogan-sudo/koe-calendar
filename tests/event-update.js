// Google PATCHの入れ子をマージして、日付・時刻の切り替えを確認する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
for (const allDay of [true, false]) for (const scope of ['this', 'all']) {
  test(`${allDay ? '時間指定→終日' : '終日→時間指定'} (${scope})`, async () => {
    const date = new Date(2026, 10, 7);
    const old = allDay ? { dateTime: '2026-11-07T14:00:00+09:00', timeZone: 'Asia/Tokyo' } : { date: '2026-11-07' };
    const calls = [];
    const context = vm.createContext({ Date, Intl, URLSearchParams, pad, ymd, addDays, startOfDay,
      parseYMD: (s) => new Date(s + 'T00:00:00'), state: {},
      api: async (path, method, body) => {
        if (!method) return { start: old, recurrence: ['RRULE:FREQ=DAILY'] };
        calls.push({ path, method, body });
        for (const key of ['start', 'end']) {
          const merged = { ...old };
          for (const [k, v] of Object.entries(body[key])) { if (v === null) delete merged[k]; else merged[k] = v; }
          assert.equal(Boolean(merged.date), allDay);
          assert.equal(Boolean(merged.dateTime), !allDay);
          if (allDay) assert.equal(merged.timeZone, undefined);
        }
      },
    });
  vm.runInContext(fs.readFileSync(require.resolve('../js/core.js'), 'utf8').slice(fs.readFileSync(require.resolve('../js/core.js'), 'utf8').indexOf('function validateNotifications')), context);
    vm.runInContext(fs.readFileSync(require.resolve('../js/edit.js'), 'utf8'), context);
    const ev = { id: 'event', calId: 'cal', allDay: !allDay, start: date, end: addDays(date, 1), ...(scope === 'all' ? { masterId: 'series' } : {}) };
    context.isFirstOf = () => true;
    await context.updateEvent(ev, { date, allDay, title: '会議', start: 840, end: 900, spanDays: 2, calId: 'cal', remind: 'default' }, scope);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].body.reminders, undefined);
    if (allDay) { assert.equal(calls[0].body.start.date, '2026-11-07'); assert.equal(calls[0].body.end.date, '2026-11-09'); }
    else assert.match(calls[0].body.start.dateTime, /T14:00:00$/);
  });
}
