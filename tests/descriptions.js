const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
function setup() {
  const saved = [];
  const pad = (n) => String(n).padStart(2, '0');
  const c = vm.createContext({ Date, Intl, URLSearchParams, window: { Capacitor: { isNativePlatform: () => true, registerPlugin: () => ({ save: async (v) => saved.push(v) }) } },
    state: { calendars: [{ id: 'me' }] }, store: { get: (_, d) => d }, pad,
    ymd: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    startOfDay: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    addDays: (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n),
    api: async (path, method, body) => { saved.push(body); return { id: 'new' }; },
  });
  for (const f of ['native', 'local', 'edit']) vm.runInContext(fs.readFileSync(require.resolve(`../js/${f}.js`), 'utf8'), c);
  return { c, saved };
}
const event = { id: 'e', calId: 'me', title: '会議', start: new Date(2026, 10, 8, 9), end: new Date(2026, 10, 8, 10), description: '元の詳細\nhttps://example.com' };
for (const description of ['変更した詳細\n持ち物：資料', '']) {
  test(`Google・Apple・Koe内に詳細を${description ? '保存' : '空にして削除'}`, async () => {
    const { c, saved } = setup();
    const form = c.eventToForm(event);
    assert.equal(form.description, event.description);
    const v = { ...form, description, remind: 'default' };
    await c.updateEvent(event, v);
    assert.equal(saved.pop().description, description);
    c.state.apple = true;
    await c.updateEvent({ ...event, appleId: 'apple', appleStart: event.start.getTime() }, v);
    assert.equal(saved.pop().notes, description);
    assert.equal(c.localRec(v, 'local').description, description);
  });
}
test('詳細を指定しない既存の呼び出しではGoogleの詳細を消さない', () => {
  const { c } = setup();
  const v = c.eventToForm(event); delete v.description;
  assert.equal(Object.hasOwn(c.eventBody(v).body, 'description'), false);
});
