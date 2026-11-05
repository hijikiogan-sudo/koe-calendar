// 六曜：旧暦の月＋日から求める。新月と二十四節気（中気）を天文計算して旧暦を作る
// 計算式は Meeus『Astronomical Algorithms』の略算。日本時間の日付で判定する
(function (root) {
  'use strict';
  const RAD = Math.PI / 180;
  const NAMES = ['大安', '赤口', '先勝', '友引', '先負', '仏滅'];
  const JST = 9 / 24;

  // 月日 → ユリウス日（日本時間0時）
  const toJD = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 2440587.5;
  // ユリウス日（世界時）→ 日本時間の「日番号」
  const jstDay = (jd) => Math.floor(jd + JST + 0.5);
  const dayNo = (date) => Math.floor(toJD(date.getFullYear(), date.getMonth() + 1, date.getDate()) + 0.5);

  // k番目の朔（新月）の時刻（暦表時の近似で十分）
  function newMoon(k) {
    const T = k / 1236.85;
    let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3;
    const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T) * RAD;
    const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T) * RAD;
    const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T) * RAD;
    const O = (124.7746 - 1.56375588 * k + 0.0020672 * T * T) * RAD;
    const E = 1 - 0.002516 * T - 0.0000074 * T * T;
    jde += -0.4072 * Math.sin(Mp) + 0.17241 * E * Math.sin(M) + 0.01608 * Math.sin(2 * Mp) + 0.01039 * Math.sin(2 * F)
      + 0.00739 * E * Math.sin(Mp - M) - 0.00514 * E * Math.sin(Mp + M) + 0.00208 * E * E * Math.sin(2 * M)
      - 0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M)
      - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) + 0.00038 * E * Math.sin(M - 2 * F)
      - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(O);
    return jde - 69 / 86400; // 暦表時と世界時の差（およそ69秒）
  }

  // 太陽の視黄経（度）
  function sunLong(jd) {
    const T = (jd - 2451545) / 36525;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD;
    const C = (1.914602 - 0.004817 * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    const om = (125.04 - 1934.136 * T) * RAD;
    const l = L0 + C - 0.00569 - 0.00478 * Math.sin(om);
    return ((l % 360) + 360) % 360;
  }

  // 朔の日番号の区間に中気（黄経が30度の倍数）が入るか。入るならその月番号（雨水330度=1月、春分0度=2月 … 冬至270度=11月）
  function chukiMonth(startDay, endDay) {
    // 区間の始まりと終わり（日本時間0時）の黄経を比べる
    const a = sunLong(startDay - 0.5 - JST), b = sunLong(endDay - 0.5 - JST);
    const delta = ((b - a) % 360 + 360) % 360;
    const next = Math.ceil(a / 30 + 1e-9) * 30; // aより後の最初の30度の倍数
    if (((next - a) % 360 + 360) % 360 >= delta) return null;
    const lon = next % 360;
    return ((((lon - 330) / 30) % 12) + 12) % 12 + 1;
  }

  const cache = new Map();
  // 冬至を含む月を11月として、ある年の旧暦の月の並びを作る
  function monthsAround(year) {
    if (cache.has(year)) return cache.get(year);
    const k0 = Math.floor((year - 2000 - 0.1) * 12.3685) - 2;
    const list = [];
    for (let k = k0; k < k0 + 20; k++) list.push(jstDay(newMoon(k)));
    const months = [];
    for (let i = 0; i < list.length - 1; i++) {
      months.push({ start: list[i], end: list[i + 1], m: chukiMonth(list[i], list[i + 1]) });
    }
    // 中気のない月は閏月：前の月と同じ番号にする
    for (let i = 0; i < months.length; i++) {
      if (months[i].m == null) months[i].leap = true;
      months[i].num = months[i].m != null ? months[i].m : (i > 0 ? months[i - 1].num : 1);
    }
    cache.set(year, months);
    return months;
  }

  // 旧暦の月・日
  function kyureki(date) {
    const n = dayNo(date);
    for (const y of [date.getFullYear(), date.getFullYear() - 1, date.getFullYear() + 1]) {
      const hit = monthsAround(y).find((x) => n >= x.start && n < x.end && x.num != null);
      if (hit) return { month: hit.num, day: n - hit.start + 1, leap: !!hit.leap };
    }
    return null;
  }

  function rokuyo(date) {
    const k = kyureki(date);
    return k ? NAMES[(k.month + k.day) % 6] : '';
  }

  const api = { rokuyo, kyureki };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KoeRokuyo = api;
})(typeof window !== 'undefined' ? window : globalThis);
