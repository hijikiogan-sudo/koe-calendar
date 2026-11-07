const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const c = vm.createContext({ Date, Intl,
  sameDay: (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(),
  esc: (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
  hm: (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`,
});
vm.runInContext(fs.readFileSync(require.resolve('../js/view.js'), 'utf8'), c);
const at = (h, m = 0, s = 0) => new Date(2026, 10, 7, h, m, s);
const ev = (title, start, end, extra = {}) => ({ title, start, end, ...extra });
test('次の予定まで秒単位で数え、開始時刻で進行中へ切り替える', () => {
  const events = [ev('会議', at(14), at(15))];
  assert.match(c.todayCountdownHTML(events, at(12, 59, 59)), /あと1時間0分1秒/);
  assert.match(c.todayCountdownHTML(events, at(13, 59, 59)), /あと1秒/);
  const started = c.todayCountdownHTML(events, at(14));
  assert.match(started, /進行中/); assert.doesNotMatch(started, /次の予定/);
  assert.doesNotMatch(c.todayCountdownHTML(events, at(15)), /進行中/);
});
test('終日・空き時間・翌日の予定は数えず、入力順に左右されない', () => {
  const tomorrow = new Date(2026, 10, 8, 9);
  const html = c.todayCountdownHTML([ev('遅い', at(18), at(19)), ev('終日', at(0), at(23), { allDay: true }),
    ev('空き', at(12, 30), at(13), { transparent: true }), ev('早い', at(14), at(15)), ev('明日', tomorrow, new Date(2026, 10, 8, 10))], at(12));
  assert.match(html, /早い/); assert.doesNotMatch(html, /遅い|終日|空き|明日/);
});
test('予定名をHTMLとして実行しない', () => {
  assert.match(c.todayCountdownHTML([ev('<script>', at(14), at(15))], at(12)), /&lt;script>/);
});
