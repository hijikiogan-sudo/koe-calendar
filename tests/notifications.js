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
  vm.runInContext(fs.readFileSync(require.resolve('../js/core.js'), 'utf8').slice(fs.readFileSync(require.resolve('../js/core.js'), 'utf8').indexOf('function validateNotifications')), context);
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
test('複数通知をGoogle・Appleへ渡し、Koe内のバックアップでも保持する', () => {
  const { context: c } = setup();
  const items = [{ method: 'popup', minutes: 0 }, { method: 'popup', minutes: 45 }, { method: 'email', minutes: 1440 }];
  const v = { title: '会議', calId: 'me', date: new Date(2026, 10, 7), start: 840, end: 900, remind: 'custom', notificationOverrides: items };
  const body = c.eventBody(v).body;
  assert.deepEqual(Array.from(body.reminders.overrides, r => r.minutes), [0,45,1440]);
  assert.deepEqual(Array.from(c.appleAlarms(body)), [0,45,1440]);
  const local = c.localRec(v, 'event');
  const restored = c.localClean(JSON.parse(JSON.stringify({ app: 'koe', events: [local], tasks: [], memos: {} })));
  assert.deepEqual(Array.from(restored.events[0].notifications, r => r.minutes), [0,45,1440]);
  assert.equal(c.eventNotifications({ reminders: { useDefault: true }, defaultReminders: items }).length,3);
});
test('複数通知は別々のIDで予約され、近い通知から60件を選ぶ', () => {
  const { context: c } = setup();
  const now = Date.now();
  c.localBetween = () => Array.from({ length: 40 }, (_, i) => ({ recId: 'e'+i, occ: '2026-11-07', title: '会議', start: new Date(now + (i+2)*3600000), reminders: { overrides: [{ minutes: 10 }, { minutes: 30 }] } }));
  const items = c.localNotifyItems(now);
  assert.equal(items.length,60);assert.equal(new Set(items.map(r=>r.id)).size,60);
  for(let i=1;i<items.length;i++) assert(items[i].at>=items[i-1].at);
});
test('通知の上限・範囲・重複をチェックし、全削除を保存できる', () => {
  const { context: c } = setup();
  for(const items of [[{ minutes: -1 }],[{ minutes: 40321 }],[{ minutes: 1.5 }],[{ minutes: 10 },{ minutes: 10 }],Array.from({length:6},(_,i)=>({minutes:i}))]) assert.throws(()=>c.validateNotifications(items));
  assert.throws(()=>c.validateNotifications([{minutes:1},{minutes:2},{minutes:3}],2));
  const v = {date:new Date(2026,10,7),start:840,end:900,notificationOverrides:[]};
  assert.equal(c.eventBody(v).body.reminders.overrides.length,0);
});
test('Googleの更新で複数通知を省略せず送信する', async () => {
  const { context: c } = setup();let sent;
  c.api = async (_, method, body) => { assert.equal(method,'PATCH');sent=body; };
  await c.updateEvent({ id:'e',calId:'me' }, { date:new Date(2026,10,7),start:840,end:900,title:'会議',calId:'me',remind:'custom',notificationOverrides:[{method:'popup',minutes:10},{method:'email',minutes:60}] });
  assert.deepEqual(Array.from(sent.reminders.overrides,r=>`${r.method}:${r.minutes}`),['popup:10','email:60']);
});
test('通知と繰り返しのアイコンをそれぞれ表示する', () => {
  const { context: c } = setup();vm.runInContext(fs.readFileSync(require.resolve('../js/view.js'),'utf8'),c);
  assert.equal(c.eventFlags({}), '');
  assert.match(c.eventFlags({recurring:true}),/🔁/);
  assert.doesNotMatch(c.eventFlags({recurring:true}),/🔔/);
  const html=c.eventFlags({reminders:{useDefault:false,overrides:[{minutes:10}]},recurring:true});
  assert.match(html,/🔔🔁/);assert.match(html,/通知あり・繰り返しあり/);
});
test('予定が70日先でも28日前の通知を予約し、60日より先の通知は入れない', () => {
  const { context: c }=setup();const now=Date.now(),day=86400000;let searchedUntil;
  c.localBetween=(_,until)=>{searchedUntil=until.getTime();return [{recId:'far',occ:'2027-01-01',title:'先の予定',start:new Date(now+70*day),reminders:{overrides:[{minutes:28*1440},{minutes:10}]}}].filter(e=>e.start.getTime()<searchedUntil)};
  const items=c.localNotifyItems(now);assert.equal(items.length,1);assert.equal(items[0].at,now+42*day);assert.equal(searchedUntil,now+88*day);
});
test('音声から来た単一通知も範囲外ならGoogle送信・ローカル保存前に拒否する',()=>{
  const { context:c }=setup();const v={title:'会議',calId:'me',date:new Date(2026,10,14),start:840,end:900,remind:'40321'};
  assert.throws(()=>c.eventBody(v),/4週間前/);assert.throws(()=>c.localRec(v,'e'),/4週間前/);
  v.remind='40320';assert.equal(c.eventBody(v).body.reminders.overrides[0].minutes,40320);
});
