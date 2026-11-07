const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { test } = require('node:test');
const c = vm.createContext({ Date, store: { get: (_, d) => d }, parseYMD: (s) => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); } });
vm.runInContext(fs.readFileSync(require.resolve('../js/form.js'), 'utf8'), c);
test('同日20:00〜21:30と翌日21:30までを区別する', () => {
  const same = c.formScheduleRange('2026-11-07','2026-11-07','20:00','21:30',false);
  assert(same.valid); assert.equal(same.days,0); assert.match(same.summary,/同日・1時間30分/);
  const next = c.formScheduleRange('2026-11-07','2026-11-08','20:00','21:30',false);
  assert(next.valid); assert.equal(next.days,1); assert.match(next.summary,/翌日・25時間30分/);
});
test('終了時刻が前でも勝手に翌日にはしない', () => {
  assert.equal(c.formScheduleRange('2026-11-07','2026-11-07','23:00','01:00',false).valid,false);
  const overnight = c.formScheduleRange('2026-11-07','2026-11-08','23:00','01:00',false);
  assert(overnight.valid); assert.match(overnight.summary,/翌日・2時間/);
});
test('空欄・逆順・同時刻を拒否し、終日は日数で示す', () => {
  for (const [date,endDate,start,end] of [['','2026-11-07','20:00','21:00'],['2026-11-07','','20:00','21:00'],['2026-11-07','2026-11-06','20:00','21:00'],['2026-11-07','2026-11-07','','21:00'],['2026-11-07','2026-11-07','20:00','20:00']]) assert.equal(c.formScheduleRange(date,endDate,start,end,false).valid,false);
  assert.match(c.formScheduleRange('2026-11-07','2026-11-07','','',true).summary,/1日間・終日/);
});
