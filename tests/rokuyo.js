// 六曜の確認：node tests/rokuyo.js
const assert = require('assert');
const { rokuyo, kyureki } = require('../rokuyo.js');
const D = (y, m, d) => new Date(y, m - 1, d);
// 旧暦の元日（よく知られた日付）。旧暦1月1日は必ず先勝
[[2023, 1, 22], [2024, 2, 10], [2025, 1, 29], [2026, 2, 17], [2027, 2, 7], [2028, 1, 27], [2029, 2, 13], [2030, 2, 3]].forEach(([y, m, d]) => {
  const k = kyureki(D(y, m, d));
  assert.deepEqual([k.month, k.day], [1, 1], `${y}/${m}/${d} ${JSON.stringify(k)}`);
  assert.equal(rokuyo(D(y, m, d)), '先勝', `${y}/${m}/${d}`);
  const prev = new Date(y, m - 1, d - 1);
  assert.equal(kyureki(prev).month, 12, `前日 ${y}/${m}/${d}`);
});
// 閏月
let k = kyureki(D(2025, 7, 25));
assert.deepEqual([k.month, k.day, k.leap], [6, 1, true], `2025閏6月 ${JSON.stringify(k)}`);
k = kyureki(D(2023, 3, 22));
assert.deepEqual([k.month, k.day, k.leap], [2, 1, true], `2023閏2月 ${JSON.stringify(k)}`);
assert.equal(rokuyo(D(2025, 7, 25)), '赤口');
// 各月1日の決まり（1月先勝、2月友引、3月先負、4月仏滅、5月大安、6月赤口）を1年分見る
const first = { 1: '先勝', 2: '友引', 3: '先負', 4: '仏滅', 5: '大安', 6: '赤口', 7: '先勝', 8: '友引', 9: '先負', 10: '仏滅', 11: '大安', 12: '赤口' };
for (let i = 0; i < 366 * 4; i++) {
  const d = new Date(2026, 0, 1 + i), q = kyureki(d);
  assert.ok(q && q.day >= 1 && q.day <= 30, d.toDateString());
  if (q.day === 1) assert.equal(rokuyo(d), first[q.month], d.toDateString());
}
// 公開されている暦（2026年11月）との照合
[5, 9, 15, 21, 27].forEach((d) => assert.equal(rokuyo(D(2026, 11, d)), '仏滅', `11/${d}`));
[6, 10, 16, 22].forEach((d) => assert.equal(rokuyo(D(2026, 11, d)), '大安', `11/${d}`));
console.log('六曜 OK', '2026/11/5:', rokuyo(D(2026, 11, 5)), JSON.stringify(kyureki(D(2026, 11, 5))));
