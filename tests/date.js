// 日付の読み取りの確認：node tests/date.js
const assert = require('assert');
const { parse } = require('../parse.js');
const f = (t, now) => { const r = parse(t, { now, calendars: [] }); return `${r.date.getFullYear()}/${r.date.getMonth() + 1}/${r.date.getDate()} ${r.title}`; };
const nov5 = new Date(2026, 10, 5, 9);
assert.equal(f('来月10日 歯医者', nov5), '2026/12/10 歯医者');
assert.equal(f('来月の10日14時 歯医者', nov5), '2026/12/10 歯医者');
assert.equal(f('今月25日 面談', nov5), '2026/11/25 面談');
assert.equal(f('再来月3日 面談', nov5), '2027/1/3 面談');
assert.equal(f('31日 検診', nov5), '2026/12/31 検診');
assert.equal(f('4日 検診', nov5), '2026/12/4 検診');
assert.equal(f('5日 検診', nov5), '2026/11/5 検診');
assert.equal(f('来月31日 検診', new Date(2027, 0, 15)), '2027/2/28 検診');
assert.equal(f('31日 検診', new Date(2027, 1, 10)), '2027/3/31 検診');
assert.equal(f('30日 検診', new Date(2027, 0, 31)), '2027/3/30 検診');
assert.equal(f('来月10日 歯医者', new Date(2026, 11, 20)), '2027/1/10 歯医者');
console.log('日付 OK');
