const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
function setup(plugin = {}) {
  const notices = [], requests = [];
  const context = vm.createContext({ Date, Intl, console: { warn() {} },
    window: { Capacitor: { isNativePlatform: () => true, registerPlugin: () => plugin } },
    store: { get: (_, fallback) => fallback }, state: {}, toast: (s) => notices.push(s),
    pad: (n) => String(n).padStart(2, '0'), ymd: (d) => d.toISOString().slice(0, 10),
    addDays: (d, n) => new Date(d.getTime() + n * 86400000),
  });
  for (const file of ['native', 'local', 'edit']) vm.runInContext(fs.readFileSync(require.resolve(`../js/${file}.js`), 'utf8'), context);
  context.localBetween = () => [{ recId: 'e', occ: '2026-11-07', title: '会議', start: new Date(Date.now() + 60000), reminders: { overrides: [{ minutes: 0 }] } }];
  return { context, notices, requests };
}
test('GoogleとAppleに開始時刻・10分前・通知なしを渡す', () => {
  const { context: c } = setup();
  for (const remind of ['0', '10', '']) {
    const body = c.eventBody({ date: new Date(2026, 10, 7), title: '会議', start: 840, end: 900, remind }).body;
    const expected = remind === '' ? [] : [Number(remind)];
    assert.deepEqual(Array.from(body.reminders.overrides, (r) => r.minutes), expected);
    assert.deepEqual(Array.from(c.appleAlarms(body)), expected);
  }
});
test('Koeだけの通知は許可を得て開始時刻に予約する', async () => {
  let asked = 0, scheduled;
  const { context: c, notices } = setup({ notifyStatus: async () => ({ status: 'undecided' }),
    notifyRequest: async () => { asked++; return { status: 'allowed' }; },
    notifySchedule: async ({ items }) => { scheduled = items; return { count: items.length }; } });
  await c.localNotifySync(true);
  assert.equal(asked, 1); assert.equal(scheduled.length, 1); assert.equal(notices.length, 0);
  assert(scheduled[0].at > Date.now());
});
test('許可が拒否された場合は予約せず案内を出す', async () => {
  const { context: c, notices } = setup({ notifyStatus: async () => ({ status: 'denied' }), notifySchedule: async () => { throw Error('予約禁止'); } });
  await c.localNotifySync(true);
  assert.match(notices[0], /許可/);
});
for (const partial of [false, true]) test(partial ? '予約件数が不足したら案内を出す' : '予約エラーを保存成功の裏に隠さない', async () => {
  const { context: c, notices } = setup({ notifyStatus: async () => ({ status: 'allowed' }),
    notifySchedule: async () => { if (partial) return { count: 0 }; throw Error('通知を予約できませんでした'); } });
  await c.localNotifySync(true);
  assert.match(notices[0], /通知を予約できませんでした/);
});
