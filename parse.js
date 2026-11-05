// Koe：1行の文（文字入力・音声どちらも）を予定の各項目に振り分ける
// 設計書「聞き取りルール」に対応。結果は必ず確認画面で直せる前提なので、迷ったら素直に寄せる。
(function (root) {
  'use strict';

  const WD = '日月火水木金土';
  const DELIM = '[、,，。\\s]';

  // 漢数字 → 数字（「十三」→13、「二〇二六」→2026）
  const KD = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  function kanjiToNum(k) {
    if (!/[十百]/.test(k)) return Number([...k].map((c) => KD[c]).join(''));
    let n = 0, cur = 0;
    for (const c of k) {
      if (c === '百') { n += (cur || 1) * 100; cur = 0; }
      else if (c === '十') { n += (cur || 1) * 10; cur = 0; }
      else cur = KD[c];
    }
    return n + cur;
  }

  function normalize(s) {
    return String(s)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      // 単位の前の漢数字だけを数字にする（「一郎」「三河」などの名前は変えない）
      .replace(/[〇零一二三四五六七八九十百]+(?=\s*(?:年|月|日|時|分|階|号|番|週|件|回|名|人|F))/g, kanjiToNum)
      .replace(/(\d)\s*時\s*半/g, '$1時30分')
      // 時間帯の言葉を日付＋時間帯に分ける
      .replace(/今夜|今晩/g, '今日の夜 ').replace(/今朝/g, '今日の朝 ').replace(/明晩/g, '明日の夜 ').replace(/明朝/g, '明日の朝 ')
      .replace(/正午/g, '12時')
      // 音声の聞き違い：「3階」→「3回」。後ろに部屋や建物の言葉が続くとき、または「〇館」の直後なら「階」に直す
      .replace(/(\d+)\s*回(?=\s*(?:大|小|中|第)?(?:講堂|会議室|ホール|ロビー|ラウンジ|フロア|病棟|診察室|教室|研修室|応接室|事務室|[^\s、,。]{0,6}室))/g, '$1階')
      .replace(/((?:[新本別旧東西南北中]|\d+号)(?:館|刊|間|感|管|缶|巻))\s*(\d+)\s*回/g, '$1$2階')
      // 音声の聞き違い：「新館」→「新刊」など。後ろに「〇階」「〇F」が続くときだけ「館」に直す
      .replace(/([新本別旧東西南北中])(?:刊|間|感|管|缶|巻)(?=\s*\d+\s*(?:階|F))/g, '$1館')
      .replace(/[：]/g, ':').replace(/[／]/g, '/').replace(/[　]/g, ' ')
      .replace(/[〜～]/g, '〜').replace(/[－−ー‐]/g, (c, i, str) => (/\d/.test(str[i - 1] || '') && /\d/.test(str[i + 1] || '') ? '-' : c))
      .trim();
  }

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  // 文字列から最初に一致した部分を取り除き、一致結果を返す
  function take(state, re) {
    const m = state.s.match(re);
    if (!m) return null;
    state.s = (state.s.slice(0, m.index) + ' ' + state.s.slice(m.index + m[0].length)).trim();
    return m;
  }

  // ---- 通知 ----
  // 通知の言い方：「30分前に通知」「30分前のリマインダーお願いします」「1時間前にアラーム」「前の日に知らせて」など
  const REMIND_WORD = '(?:通知|お知らせ|知らせ|リマインダー|リマインド|アラーム|アラート|呼び出し)';
  const REMIND_TAIL = '(?:を|が)?\\s*(?:て(?:ください|ほしい)?|して(?:ください|ほしい)?|する|付けて(?:ください)?|つけて(?:ください)?|入れて(?:ください)?|設定(?:して)?(?:ください)?|あり|お願い(?:します|いたします)?|ください|ほしい)?';
  function parseRemind(st) {
    let m = take(st, new RegExp(`(\\d+)\\s*(分|時間|日)\\s*前(?:に|の|で)?\\s*${REMIND_WORD}${REMIND_TAIL}`));
    if (m) {
      const n = Number(m[1]);
      return { minutes: n * { 分: 1, 時間: 60, 日: 1440 }[m[2]], label: `${m[1]}${m[2]}前` };
    }
    // 「通知は30分前」「リマインダー30分前でお願いします」のように順番が逆
    m = take(st, new RegExp(`${REMIND_WORD}(?:は|を)?\\s*(\\d+)\\s*(分|時間|日)\\s*前${REMIND_TAIL}`));
    if (m) {
      const n = Number(m[1]);
      return { minutes: n * { 分: 1, 時間: 60, 日: 1440 }[m[2]], label: `${m[1]}${m[2]}前` };
    }
    m = take(st, new RegExp(`(?:前の日|前日)(?:に|の)?\\s*${REMIND_WORD}${REMIND_TAIL}`));
    if (m) return { minutes: 'prevday', label: '前の日' };
    return null;
  }

  // ---- カレンダー ----
  function calendarAliases(cals) {
    const list = [];
    cals.forEach((c) => {
      const names = new Set([c.name]);
      if (/ファミリー|家族/.test(c.name)) { names.add('ファミリー'); names.add('家族'); }
      if (/自分/.test(c.name)) { names.add('自分用'); names.add('自分'); }
      if (/仕事/.test(c.name)) names.add('仕事');
      names.forEach((n) => n && list.push({ alias: n, cal: c }));
    });
    return list.sort((a, b) => b.alias.length - a.alias.length);
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function parseCalendar(st, cals) {
    for (const { alias, cal } of calendarAliases(cals)) {
      const a = esc(alias);
      // 文頭：「仕事、」「家族の〜」「ファミリーカレンダーに」
      if (take(st, new RegExp(`^${a}(?:の予定|のカレンダー|カレンダー)?(?:に|の|で)?${DELIM}*`))) return cal;
      // 途中に単独で：「… 仕事 …」「… 仕事のカレンダーに …」
      if (take(st, new RegExp(`(?<=^|${DELIM})${a}(?:の予定|のカレンダー|カレンダー)(?:に|で)?(?=${DELIM}|$)|(?<=${DELIM})${a}(?=${DELIM}|$)`))) return cal;
    }
    return null;
  }

  function defaultCalendar(cals) {
    return cals.find((c) => /自分用/.test(c.name)) || cals.find((c) => c.primary) || cals[0] || null;
  }

  // 週の最初の日（ws：0=日曜始まり、1=月曜始まり）
  const weekBase = (today, ws) => addDays(today, -((today.getDay() - (ws || 0) + 7) % 7));

  // ---- 日付 ----
  function parseDate(st, now) {
    const today = startOfDay(now);
    let m;
    // 「来月10日」など：その月にない日（2月31日）は月末にする
    if ((m = take(st, /(今月|来月|再来月)の?\s*(\d{1,2})日(?!間)/))) {
      const first = new Date(today.getFullYear(), today.getMonth() + { 今月: 0, 来月: 1, 再来月: 2 }[m[1]], 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      return new Date(first.getFullYear(), first.getMonth(), Math.min(Number(m[2]), last));
    }
    if ((m = take(st, /(?:(\d{4})年)?(\d{1,2})\s*[月/]\s*(\d{1,2})日?/))) {
      let y = m[1] ? Number(m[1]) : today.getFullYear();
      let d = new Date(y, Number(m[2]) - 1, Number(m[3]));
      if (!m[1] && d < today) d = new Date(y + 1, Number(m[2]) - 1, Number(m[3]));
      return d;
    }
    if ((m = take(st, /(今日|きょう|本日|明日|あした|あす|明後日|あさって|しあさって)/))) {
      const off = { 今日: 0, きょう: 0, 本日: 0, 明日: 1, あした: 1, あす: 1, 明後日: 2, あさって: 2, しあさって: 3 }[m[1]];
      return addDays(today, off);
    }
    if ((m = take(st, new RegExp(`(今週|来週|再来週)の?\\s*([${WD}])曜日?`)))) {
      const week = { 今週: 0, 来週: 7, 再来週: 14 }[m[1]];
      return addDays(weekBase(today, st.ws), week + ((WD.indexOf(m[2]) - (st.ws || 0) + 7) % 7));
    }
    // 「今週末」「来週」「月末」など。「年末調整」のような言葉は日付にしない
    const B = '(?=$|[\\s、,，。]|に|の|まで|は|で|から)';
    if ((m = take(st, new RegExp(`(今週|来週|再来週)(末|中)${B}`)))) {
      return addDays(weekBase(today, st.ws), { 今週: 0, 来週: 7, 再来週: 14 }[m[1]] + ((6 - (st.ws || 0) + 7) % 7));
    }
    if ((m = take(st, new RegExp(`週末${B}`)))) return addDays(today, 6 - today.getDay());
    if ((m = take(st, new RegExp(`(来週|再来週)${B}`)))) {
      return addDays(weekBase(today, st.ws), (m[1] === '来週' ? 7 : 14) + ((1 - (st.ws || 0) + 7) % 7)); // その週の月曜
    }
    if ((m = take(st, new RegExp(`(今月|来月|再来月)(末|頭|初め|始め)${B}`)))) {
      const off = { 今月: 0, 来月: 1, 再来月: 2 }[m[1]];
      return m[2] === '末' ? new Date(today.getFullYear(), today.getMonth() + off + 1, 0) : new Date(today.getFullYear(), today.getMonth() + off, 1);
    }
    if ((m = take(st, new RegExp(`月末${B}`)))) return new Date(today.getFullYear(), today.getMonth() + 1, 0);
    if ((m = take(st, new RegExp(`(来月|再来月)${B}`)))) return new Date(today.getFullYear(), today.getMonth() + (m[1] === '来月' ? 1 : 2), 1);
    if ((m = take(st, new RegExp(`年末${B}`)))) return new Date(today.getFullYear(), 11, 31);
    if ((m = take(st, new RegExp(`(?:次の|今度の)?([${WD}])曜日?`)))) {
      const diff = (WD.indexOf(m[1]) - today.getDay() + 7) % 7;
      return addDays(today, diff);
    }
    if ((m = take(st, /(\d{1,2})日(?!間)/))) {
      const n = Number(m[1]);
      // 今日以降で、その日がある一番近い月にする（11月に「31日」→ 12月31日）
      for (let i = 0; i < 13; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, n);
        if (d.getDate() === n && d >= today) return d;
      }
      return addDays(today, 0);
    }
    return null;
  }

  // その日がある一番近い日（今日以降）
  function nearestDay(n, today) {
    for (let i = 0; i < 13; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, n);
      if (d.getDate() === n && d >= today) return d;
    }
    return today;
  }
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);

  // ---- 数日にまたがる予定（「12月1日から3日まで」「月曜から水曜まで」）----
  function parseSpan(st, now) {
    const today = startOfDay(now);
    let m;
    // 「12月1日10時から3日15時まで」「1日10時から12月3日15時」
    const fromTo = `\\s*${T}\\s*(?:から|〜)\\s*(?:(\\d{1,2})\\s*[月/]\\s*)?(\\d{1,2})日\\s*${T}\\s*(?:まで)?`;
    if ((m = take(st, new RegExp(`(?:(\\d{1,2})\\s*[月/]\\s*)?(\\d{1,2})日${fromTo}`)))) {
      let a;
      if (m[1]) { a = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2])); if (a < today) a = new Date(a.getFullYear() + 1, a.getMonth(), a.getDate()); }
      else a = nearestDay(Number(m[2]), today);
      let b = new Date(a.getFullYear(), m[6] ? Number(m[6]) - 1 : a.getMonth(), Number(m[7]));
      if (b < a) b = new Date(b.getFullYear(), b.getMonth() + (m[6] ? 12 : 1), b.getDate());
      return { date: a, spanDays: 1, timed: { start: toMin(m[3], m[4], m[5], true), end: toMin(m[8], m[9], m[10]), endDays: daysBetween(a, b), endSaid: true } };
    }
    if ((m = take(st, /(\d{1,2})\s*[月/]\s*(\d{1,2})日?\s*(?:から|〜)\s*(?:(\d{1,2})\s*[月/]\s*)?(\d{1,2})日?(?:まで)?(?![\d:時分])/))) {
      let a = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]));
      if (a < today) a = new Date(a.getFullYear() + 1, a.getMonth(), a.getDate());
      let b = new Date(a.getFullYear(), m[3] ? Number(m[3]) - 1 : a.getMonth(), Number(m[4]));
      if (b < a) b = m[3] ? new Date(b.getFullYear() + 1, b.getMonth(), b.getDate()) : new Date(b.getFullYear(), b.getMonth() + 1, b.getDate());
      return { date: a, spanDays: daysBetween(a, b) + 1 };
    }
    if ((m = take(st, /(\d{1,2})日\s*(?:から|〜|-)\s*(?:(\d{1,2})月\s*)?(\d{1,2})日(?:まで)?/))) {
      const a = nearestDay(Number(m[1]), today);
      let b = new Date(a.getFullYear(), m[2] ? Number(m[2]) - 1 : a.getMonth(), Number(m[3]));
      if (b < a) b = new Date(b.getFullYear(), b.getMonth() + (m[2] ? 12 : 1), b.getDate());
      return { date: a, spanDays: daysBetween(a, b) + 1 };
    }
    if ((m = take(st, new RegExp(`(?:(今週|来週|再来週)の?\\s*)?([${WD}])曜日?\\s*(?:から|〜)\\s*(?:(?:今週|来週|再来週)の?\\s*)?([${WD}])曜日?(?:まで)?`)))) {
      const i = WD.indexOf(m[2]), j = WD.indexOf(m[3]);
      const a = m[1] ? addDays(weekBase(today, st.ws), { 今週: 0, 来週: 7, 再来週: 14 }[m[1]] + ((i - (st.ws || 0) + 7) % 7)) : addDays(today, (i - today.getDay() + 7) % 7);
      return { date: a, spanDays: ((j - i + 7) % 7) + 1 };
    }
    return null;
  }

  // ---- 繰り返し（「毎週月曜」「毎月1日」「毎日」など）----
  function parseRecur(st, now) {
    const today = startOfDay(now);
    const nextDow = (i) => addDays(today, (i - today.getDay() + 7) % 7);
    let m;
    if (take(st, /毎週平日|平日毎日|毎平日/)) {
      let d = today; while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
      return { freq: 'WEEKDAYS', date: d };
    }
    if ((m = take(st, new RegExp(`(隔週|毎週|毎)\\s*([${WD}])曜日?`)))) return { freq: m[1] === '隔週' ? 'BIWEEKLY' : 'WEEKLY', date: nextDow(WD.indexOf(m[2])) };
    if ((m = take(st, /毎月\s*(\d{1,2})日/))) return { freq: 'MONTHLY', date: nearestDay(Number(m[1]), today) };
    if (take(st, /毎月末/)) return { freq: 'MONTHLY', monthEnd: true, date: new Date(today.getFullYear(), today.getMonth() + 1, 0) };
    if ((m = take(st, /毎年\s*(\d{1,2})月\s*(\d{1,2})日/))) {
      let d = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]));
      if (d < today) d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
      return { freq: 'YEARLY', date: d };
    }
    if (take(st, /毎日/)) return { freq: 'DAILY', date: null };
    if (take(st, /隔週/)) return { freq: 'BIWEEKLY', date: null };
    if (take(st, /毎週/)) return { freq: 'WEEKLY', date: null };
    if (take(st, /毎月/)) return { freq: 'MONTHLY', date: null };
    if (take(st, /毎年/)) return { freq: 'YEARLY', date: null };
    return null;
  }
  // Google カレンダーに渡す繰り返しの指定
  function recurRule(freq, date, monthEnd) {
    const day = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getDay()];
    return {
      DAILY: 'RRULE:FREQ=DAILY',
      WEEKDAYS: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      WEEKLY: `RRULE:FREQ=WEEKLY;BYDAY=${day}`,
      BIWEEKLY: `RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=${day}`,
      MONTHLY: `RRULE:FREQ=MONTHLY;BYMONTHDAY=${monthEnd ? -1 : date.getDate()}`,
      YEARLY: 'RRULE:FREQ=YEARLY',
    }[freq] || null;
  }

  // ---- 時間 ----
  const T = '(午前|午後|朝|昼|夕方|夜)?\\s*(\\d{1,2})\\s*(?:時|:)\\s*(半|\\d{1,2}\\s*分?)?';
  // guess：午前／午後を言わない 1〜6時は午後とみなす（「2時 歯医者」→ 14時）
  function toMin(ap, h, mm, guess) {
    h = Number(h);
    if (guess && !ap && h >= 1 && h <= 6) h += 12;
    let m = !mm ? 0 : mm.startsWith('半') ? 30 : parseInt(mm, 10);
    if (ap && /午後|夕方|夜/.test(ap) && h < 12) h += 12;
    if (ap === '昼' && h < 6) h += 12;
    if (ap === '午前' && h === 12) h = 0;
    return h * 60 + m;
  }
  function fixEnd(start, end) {
    if (end === start) return start + 60;
    if (end < start && end < 12 * 60 && end + 720 > start) return end + 720;
    if (end < start) return end + 1440; // 日をまたぐ（23時から1時）
    return end;
  }

  function parseTime(st) {
    let m;
    // 「19時から2時間」を先に見る（「19時から2時」と読まないように）
    if ((m = take(st, new RegExp(`${T}\\s*(?:から|より)\\s*(\\d+(?:\\.\\d+)?)\\s*(時間|分)(半)?(?:間)?`)))) {
      const s = toMin(m[1], m[2], m[3], true);
      const dur = m[5] === '時間' ? Number(m[4]) * 60 + (m[6] ? 30 : 0) : Number(m[4]);
      return { start: s, end: s + Math.round(dur), endSaid: true };
    }
    if ((m = take(st, new RegExp(`${T}\\s*(?:から|より|〜|-)\\s*${T}\\s*(?:まで)?`)))) {
      const s = toMin(m[1], m[2], m[3], true);
      // 終わりに午前/午後がなければ、始まりの午前/午後を引き継ぐ
      const e = toMin(m[4] || (m[1] && /午後|夕方|夜/.test(m[1]) ? m[1] : ''), m[5], m[6]);
      return { start: s, end: fixEnd(s, e), endSaid: true };
    }
    if ((m = take(st, /(?<![\d/])(\d{1,2})\s*-\s*(\d{1,2})(?![\d/日時])/))) {
      const s = toMin('', m[1], '', true), e = Number(m[2]) * 60;
      if (s < 24 * 60 && e <= 24 * 60) return { start: s, end: fixEnd(s, e), endSaid: true };
    }
    if ((m = take(st, new RegExp(`${T}\\s*(?:から|より)?`)))) {
      const s = toMin(m[1], m[2], m[3], true);
      return { start: s, end: s + 60, endSaid: false };
    }
    // 「明後日の午後」のように時刻がない時間帯。「朝会」「夜勤」などの言葉は時間帯にしない
    if ((m = take(st, /(?<=^|[\s、,，。の])(午前中|午前|午後|夕方|朝|昼|夜)(?=$|[\s、,，。]|に|から)/))) {
      const [a, b] = { 午前中: [540, 720], 午前: [540, 600], 午後: [780, 840], 夕方: [1020, 1080], 朝: [540, 600], 昼: [720, 780], 夜: [1140, 1200] }[m[1]];
      return { start: a, end: b, endSaid: false };
    }
    return null;
  }

  // ---- 場所と内容 ----
  const PARTICLE = /^(の|に|で|を|は|が|と|から|まで|より|予定|へ)+$/;
  function cleanWord(w) {
    return w.replace(/(?:を|で)?(?:お願い(?:します|いたします)?|ください|です)$/, '').replace(/までに$/, '').replace(/^(?:の|に|を|は|が|から|まで)+/, '').replace(/(?:の予定|予定|を|の|に|は|が|へ)+$/, '');
  }

  const TASK_WORD = /までに|やる|出す|提出|払う|振り込む|返す|返信|送る|買う|申し込む|予約する|連絡する|電話する|片付ける|タスク|ToDo|TODO/;
  const DAY_OFF = /代休|半休|年休|有休|有給|公休|夏休|冬休|休暇|休診|休校|休館|休日|休み|非番/;
  const PLACE = /(?:室|講堂|ロビー|ラウンジ|フロア|[A-ZＡ-Ｚ]?会議室[A-Z0-9]*|館|駅|駅前|店|病院|医院|歯科|クリニック|センター|ホール|公園|学校|会場|ビル|カフェ|会社|事務所|自宅|実家|役所|役場|教室|体育館|[A-Z0-9]号室)[A-Z0-9]*$/;
  const LOC_START = /(?:新館|本館|別館|旧館|[東西南北中]館|[A-Z]棟|\d+号館|\d+号棟|\d+階|\d+F|大会議室|小会議室|中会議室|第\d+会議室|会議室|応接室|講堂|研修室|病棟|診察室|教室|ロビー|ラウンジ)/;
  function parseRest(st) {
    let segs = st.s.split(new RegExp(`${DELIM}+`)).filter((x) => x && !PARTICLE.test(x));
    let location = '';
    for (let i = 0; i < segs.length; i++) {
      const m = segs[i].match(/^(.+?)(?<!ま)で(?!す|した|しょ|も)(.*)$/);
      if (!m) continue;
      const loc = cleanWord(m[1]);
      if (!loc || PARTICLE.test(loc)) continue;
      location = loc;
      segs[i] = m[2];
      break;
    }
    // 「で」がなくても、場所らしい言葉で終わる区切りは場所にする（例：「打ち合わせ、会議室A」）
    if (!location && segs.filter(Boolean).length > 1) {
      const i = segs.findIndex((x, k) => k > 0 && PLACE.test(cleanWord(x)));
      if (i > 0) { location = cleanWord(segs[i]); segs.splice(i, 1); }
    }
    // 区切りなしで続けて話した場合（例：「週次スタッフ会議本館3階大会議室」）
    // 建物・階・部屋を表す言葉から後ろを場所にする
    if (!location) {
      for (let k = 0; k < segs.length; k++) {
        const m = segs[k].match(LOC_START);
        if (!m || m.index === 0) continue;
        const loc = segs[k].slice(m.index);
        if (!PLACE.test(loc) && !/(?:館|階|F|棟)/.test(loc)) continue;
        location = loc; segs[k] = segs[k].slice(0, m.index);
        break;
      }
    }
    const title = segs.map(cleanWord).filter((x) => x && !PARTICLE.test(x)).join(' ').trim();
    return { location, title };
  }

  function parse(text, opts = {}) {
    const now = opts.now || new Date();
    const cals = opts.calendars || [];
    const st = { s: normalize(text), ws: opts.weekStart || 0 };
    const remind = parseRemind(st);
    const cal = parseCalendar(st, cals);
    const recur = parseRecur(st, now);
    const span = recur ? null : parseSpan(st, now);
    let date = span ? span.date : parseDate(st, now);
    if (recur && recur.date && !date) date = recur.date;
    // 「明日から3日間」
    let spanDays = span ? span.spanDays : 1;
    const nDays = !recur && !span && date && take(st, /(?:から\s*)?(\d+)\s*日間/);
    if (nDays) spanDays = Number(nDays[1]);
    const time = span && span.timed ? span.timed : parseTime(st);
    // 「場所は〇〇」とはっきり言ったら、そこを場所にする
    const said = take(st, new RegExp(`場所(?:は|が|:)\\s*([^、,，。]+?)(?:です)?(?=$|[、,，。])`));
    const rest = parseRest(st);
    if (said) rest.location = said[1].trim();
    // 予定かタスクか（設計書：「までに」「やる」「出す」がある、または時刻がない → タスク）
    // ただし時刻がなくても、場所やカレンダーを言っていれば終日の予定として扱う
    const taskWord = TASK_WORD.test(normalize(text));
    // 通知を言ったら予定（ToDoリストには通知が付けられないため）
    // 休みの言葉（代休・有給など）は時刻がなくても終日の予定
    const dayOff = DAY_OFF.test(rest.title);
    // 繰り返し（ToDoリストでは使えない）と数日にまたがる予定も予定にする
    const kind = !remind && !dayOff && !recur && !(spanDays > 1 && !taskWord) && !(span && span.timed) && (taskWord || (!time && !rest.location && !cal)) ? 'task' : 'event';
    return {
      kind,
      taskWord,
      calId: (cal || defaultCalendar(cals) || {}).id || null,
      calSaid: !!cal,
      date: date || startOfDay(now),
      dateSaid: !!date,
      allDay: !time,
      start: time ? time.start : null, // 0時からの分
      end: time ? time.end : null,
      location: rest.location,
      title: rest.title,
      remind, // null | {minutes: number|'prevday', label}
      spanDays,
      endDays: time && time.endDays ? time.endDays : 0,
      recur: recur ? { freq: recur.freq, monthEnd: !!recur.monthEnd } : null,
    };
  }

  // ---- 変更の指示（「15時からに変更」「場所を会議室Bに」「明日に移動」など） ----
  // 言った項目だけを返す。言っていない項目は元の予定のまま。
  const CHANGE_VERB = /(?:に|へ)?(?:変更|変えて|変える|ずらして|ずらす|移動|移して|直して)(?:する|して|します|してください|お願い(?:します)?)?/g;
  function parseChange(text, opts = {}) {
    const now = opts.now || new Date();
    const cals = opts.calendars || [];
    const st = { s: normalize(text), ws: opts.weekStart || 0 };
    const out = {};
    if (take(st, /通知(?:を|は)?\s*(?:なし|無し|消して|消す|いらない|不要|オフ|外して)/)) out.remind = { minutes: '', label: '通知なし' };
    else { const r = parseRemind(st); if (r) out.remind = r; }
    if (take(st, /場所(?:を|は)?\s*(?:なし|無し|消して|消す)/)) out.location = '';
    let m = take(st, new RegExp(`場所(?:を|は)?\\s*(.+?)\\s*(?:に|へ)?(?:変更|変えて|して)?(?=$|${DELIM})`));
    if (m) out.location = m[1];
    m = take(st, new RegExp(`(?:タイトル|内容|名前|件名)(?:を|は)?\\s*(.+?)\\s*(?:に|へ)?(?:変更|変えて|して)?(?=$|${DELIM})`));
    if (m) out.title = m[1];
    if (take(st, /終日(?:に|で)?/)) out.allDay = true;
    st.s = st.s.replace(CHANGE_VERB, ' ').trim();
    const cal = parseCalendar(st, cals);
    if (cal) out.calId = cal.id;
    const date = parseDate(st, now);
    if (date) out.date = date;
    const time = parseTime(st);
    if (time) { out.allDay = false; out.start = time.start; if (time.endSaid) out.end = time.end; }
    const rest = parseRest(st);
    if (rest.location && out.location === undefined) out.location = rest.location;
    if (rest.title && out.title === undefined && !Object.keys(out).length) out.title = rest.title;
    return out;
  }

  // ---- 辞書 ----
  // 音声認識は「たかし」を最初から「隆」のように漢字で書き起こすので、実際に出た字で登録する。
  // 2文字以上：文全体で置き換える。1文字：「満足」などを壊さないよう、内容・場所の語の頭だけ置き換える。
  function applyDict(text, dict) {
    return (dict || []).filter((d) => d.from && d.from.length >= 2).sort((a, b) => b.from.length - a.from.length)
      .reduce((t, d) => t.split(d.from).join(d.to), text);
  }
  const KEEP_WORDS = /^(?:満足|満員|満開|満点|満席|満月|満期|満了|満車|満腹|満タン|満室|満額|光熱|光景|光線)/;
  function applyDictField(value, dict) {
    return (dict || []).filter((d) => d.from && d.from.length === 1).reduce((v, d) => {
      let out = '';
      for (let i = 0; i < v.length; i++) {
        const head = i === 0 || /[\s、,，・と]/.test(v[i - 1]);
        out += v[i] === d.from && head && !KEEP_WORDS.test(v.slice(i)) ? d.to : v[i];
      }
      return out;
    }, value || '');
  }
  // 確認画面で直した内容から、辞書に入れる組み合わせを取り出す
  function dictDiff(before, after) {
    if (!before || !after || before === after) return null;
    let a = 0, b = 0;
    while (a < before.length && a < after.length && before[a] === after[a]) a++;
    while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
    // カタカナ語の途中で切れたら、語のまとまりまで広げる（サーフ→スタッフ）
    const kata = (c) => /[ァ-ヶー]/.test(c || '');
    const touchesKata = kata(before[a]) || kata(after[a]) || kata(before[before.length - 1 - b]) || kata(after[after.length - 1 - b]);
    if (touchesKata) {
      while (a > 0 && kata(before[a - 1])) a--;
      while (b > 0 && kata(before[before.length - b])) b--;
    }
    const from = before.slice(a, before.length - b), to = after.slice(a, after.length - b);
    if (!from || !to || from.length > 12 || to.length > 12) return null;
    return { from, to };
  }

  // ---- もしかして：過去の予定名・場所から似た言葉を探す ----
  const matchKey = (t) => String(t || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  function editDistance(a, b) {
    const x = [...a], y = [...b];
    let prev = y.map((_, j) => j + 1); prev.unshift(0);
    for (let i = 1; i <= x.length; i++) {
      const cur = [i];
      for (let j = 1; j <= y.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[y.length];
  }
  // corpus: { 言葉: 使った回数 }。短すぎる語、すでに同じ言葉があるときは候補を出さない
  function suggest(value, corpus, limit = 3) {
    const key = matchKey(value), n = [...key].length;
    if (n < 3 || !corpus) return [];
    const entries = Object.entries(corpus);
    if (entries.some(([t]) => matchKey(t) === key)) return [];
    const best = new Map();
    entries.forEach(([text, count]) => {
      const k = matchKey(text), m = [...k].length;
      if (m < 2 || m > 40 || Math.min(n, m) / Math.max(n, m) < 0.5) return;
      const sim = 1 - editDistance(key, k) / Math.max(n, m);
      if (sim < 0.6) return;
      const score = sim + Math.min(count || 1, 20) * 0.005;
      if (!best.has(k) || best.get(k).score < score) best.set(k, { text, score });
    });
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.text);
  }

  // ---- 声の命令（登録以外）----
  // 「明日の予定は？」「歯医者を削除」「書類を出すを完了」「会議を検索」。当てはまらなければ null（＝登録）
  function parseCommand(text, opts = {}) {
    const now = opts.now || new Date();
    const n = normalize(text).replace(/[。\s]+$/, '');
    let m;
    if ((m = n.match(/^(.+?)の予定(?:は|を)?\s*(?:教えて|見せて|確認(?:して)?|何|なに|ある|ありますか|どう)*\s*(?:ですか|ください)?[?？]?$/))) {
      const w = m[1].trim();
      if (/^(今週|来週|再来週)$/.test(w)) return { cmd: 'show', view: 'week', date: addDays(startOfDay(now), { 今週: 0, 来週: 7, 再来週: 14 }[w]) };
      if (/^(今月|来月|再来月)$/.test(w)) return { cmd: 'show', view: 'month', date: new Date(now.getFullYear(), now.getMonth() + { 今月: 0, 来月: 1, 再来月: 2 }[w], 1) };
      const st = { s: w, ws: opts.weekStart || 0 };
      const date = parseDate(st, now);
      if (date && !st.s.replace(/の/g, '').trim()) return { cmd: 'show', view: 'day', date };
      return null;
    }
    if ((m = n.match(/^(.+?)(?:の予定)?を?\s*(?:検索(?:して)?|探して|さがして|調べて)(?:ください)?$/))) return { cmd: 'search', word: m[1].trim() };
    const target = (w) => {
      const st = { s: w, ws: opts.weekStart || 0 };
      const date = parseDate(st, now);
      return { date, word: st.s.replace(/^の/, '').replace(/の予定$/, '').trim() };
    };
    if ((m = n.match(/^(.+?)を\s*(?:削除(?:して)?|消して|キャンセルして|取り消して)(?:ください)?$/))) return { cmd: 'delete', ...target(m[1]) };
    if ((m = n.match(/^(.+?)を?\s*(?:完了(?:にして|して|した)?|終わった|済んだ)(?:ください)?$/))) return { cmd: 'done', ...target(m[1]) };
    return null;
  }

  // ---- 繰り返しの分割（「この日以降」を変えるとき）----
  const pad2 = (x) => String(x).padStart(2, '0');
  function untilBefore(start, allDay) {
    if (allDay) { const d = addDays(start, -1); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }
    return new Date(start.getTime() - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }
  // lines：Googleの recurrence。old は今の予定を手前で終わらせる指定、next は新しい続きの指定
  function splitRule(lines, until, remaining) {
    const conv = (l, f) => (/^RRULE:/.test(l) ? f(l) : l);
    const strip = (l) => l.replace(/;(?:UNTIL|COUNT)=[^;]*/g, '').replace(/:(?:UNTIL|COUNT)=[^;]*;/, ':');
    return {
      old: lines.map((l) => conv(l, (r) => `${strip(r)};UNTIL=${until}`)),
      next: lines.map((l) => conv(l, (r) => (/;COUNT=/.test(r) || /:COUNT=/.test(r) ? `${strip(r)};COUNT=${Math.max(remaining || 1, 1)}` : r))),
    };
  }

  const api = { parse, parseChange, parseCommand, normalize, applyDict, applyDictField, dictDiff, suggest, recurRule, untilBefore, splitRule };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KoeParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
