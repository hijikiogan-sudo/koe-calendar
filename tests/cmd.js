// 命令・繰り返し分割・時刻つき数日・週の始まりの確認：node tests/cmd.js
const assert = require('assert');
const { parse, parseCommand, splitRule, untilBefore } = require('../parse.js');
const now = new Date(2026, 10, 5, 9); // 木曜
const c = (t, o = {}) => { const r = parseCommand(t, { now, ...o }); if (r && r.date) r.date = `${r.date.getMonth() + 1}/${r.date.getDate()}`; return r; };
assert.deepEqual(c('明日の予定は？'), { cmd: 'show', view: 'day', date: '11/6' });
assert.deepEqual(c('今日の予定を教えて'), { cmd: 'show', view: 'day', date: '11/5' });
assert.deepEqual(c('12月3日の予定'), { cmd: 'show', view: 'day', date: '12/3' });
assert.deepEqual(c('来週の予定は'), { cmd: 'show', view: 'week', date: '11/12' });
assert.deepEqual(c('来月の予定を見せて'), { cmd: 'show', view: 'month', date: '12/1' });
assert.equal(c('打ち合わせの予定'), null);
assert.deepEqual(c('会議を検索'), { cmd: 'search', word: '会議' });
assert.deepEqual(c('歯医者を探して'), { cmd: 'search', word: '歯医者' });
assert.deepEqual(c('歯医者を削除'), { cmd: 'delete', word: '歯医者', date: null });
assert.deepEqual(c('明日の歯医者を消して'), { cmd: 'delete', word: '歯医者', date: '11/6' });
assert.deepEqual(c('書類を出すを完了'), { cmd: 'done', word: '書類を出す', date: null });
assert.deepEqual(c('牛乳を買うを完了にして'), { cmd: 'done', word: '牛乳を買う', date: null });
// 登録のままにする文
['明日14時 打ち合わせ', '金曜までに書類を出す', '牛乳を買う', '毎週月曜10時 朝礼', '予約をキャンセルする', '明日の朝9時 打ち合わせ'].forEach((t) => assert.equal(c(t), null, t));

// 時刻つきの数日
const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
let r = parse('12月1日10時から3日15時まで 研修', { now, calendars: [] });
assert.equal(`${r.kind} ${r.date.getMonth() + 1}/${r.date.getDate()} ${hm(r.start)} ${hm(r.end)} +${r.endDays} ${r.title}`, 'event 12/1 10:00 15:00 +2 研修');
r = parse('11月30日13時から12月2日9時 出張', { now, calendars: [] });
assert.equal(`${r.date.getMonth() + 1}/${r.date.getDate()} ${hm(r.start)} ${hm(r.end)} +${r.endDays} ${r.title}`, '11/30 13:00 9:00 +2 出張');
r = parse('11月5日13時30分から14時30分 面談', { now, calendars: [] });
assert.equal(`${hm(r.start)} ${hm(r.end)} +${r.endDays}`, '13:30 14:30 +0');

// 月曜始まり（今日が日曜）
const sun = new Date(2026, 10, 8, 9);
const d = (t, ws) => { const x = parse(t, { now: sun, calendars: [], weekStart: ws }).date; return `${x.getMonth() + 1}/${x.getDate()}`; };
assert.equal(d('来週の月曜 面談', 0), '11/16');
assert.equal(d('来週の月曜 面談', 1), '11/9');
assert.equal(d('今週の土曜 面談', 1), '11/7');
assert.equal(d('来週 面談', 1), '11/9');
assert.equal(d('今週末 旅行', 1), '11/7');

// 繰り返しの分割
const until = untilBefore(new Date(Date.UTC(2026, 10, 9, 1, 0, 0)), false);
assert.equal(until, '20261109T005959Z');
assert.equal(untilBefore(new Date(2026, 10, 9), true), '20261108');
let s = splitRule(['RRULE:FREQ=WEEKLY;BYDAY=MO'], until);
assert.deepEqual(s, { old: [`RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=${until}`], next: ['RRULE:FREQ=WEEKLY;BYDAY=MO'] });
s = splitRule(['RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=MO', 'EXDATE:20261116'], until, 7);
assert.deepEqual(s.old, [`RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=${until}`, 'EXDATE:20261116']);
assert.deepEqual(s.next[0], 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=7');
s = splitRule(['RRULE:FREQ=DAILY;UNTIL=20270101T000000Z'], until);
assert.deepEqual(s.old, [`RRULE:FREQ=DAILY;UNTIL=${until}`]);
assert.deepEqual(s.next, ['RRULE:FREQ=DAILY;UNTIL=20270101T000000Z']);
// 細かい繰り返し（今日は 2026/11/5 木曜）
const { recurRule } = require('../parse.js');
const rr = (text) => { const x = parse(text, { now, calendars: [] }); return `${x.kind} ${x.date.getMonth() + 1}/${x.date.getDate()} ${recurRule(x.recur, x.date, x.allDay)} |${x.title}`; };
assert.equal(rr('毎月第2火曜10時 定例'), 'event 11/10 RRULE:FREQ=MONTHLY;BYDAY=2TU |定例');
assert.equal(rr('毎月第二火曜 定例'), 'event 11/10 RRULE:FREQ=MONTHLY;BYDAY=2TU |定例');
assert.equal(rr('毎月最終金曜 飲み会'), 'event 11/27 RRULE:FREQ=MONTHLY;BYDAY=-1FR |飲み会');
assert.equal(rr('毎週月水金7時 ジム'), 'event 11/6 RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR |ジム');
assert.equal(rr('毎週月曜と木曜に 体操'), 'event 11/5 RRULE:FREQ=WEEKLY;BYDAY=MO,TH |体操');
assert.equal(rr('毎週月曜 火災訓練'), 'event 11/9 RRULE:FREQ=WEEKLY;BYDAY=MO |火災訓練');
assert.equal(rr('2週間ごとの金曜 面談'), 'event 11/6 RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR |面談');
assert.equal(rr('隔週金曜 面談'), 'event 11/6 RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR |面談');
assert.equal(rr('3日ごと 水やり'), 'event 11/5 RRULE:FREQ=DAILY;INTERVAL=3 |水やり');
assert.equal(rr('2か月ごと 検診'), 'event 11/5 RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=5 |検診');
assert.equal(rr('毎週月曜10時 朝礼 10回まで'), 'event 11/9 RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10 |朝礼');
assert.equal(rr('毎月1日 家賃を払う'), 'event 12/1 RRULE:FREQ=MONTHLY;BYMONTHDAY=1 |家賃を払う');
assert.equal(rr('毎月末 締め'), 'event 11/30 RRULE:FREQ=MONTHLY;BYMONTHDAY=-1 |締め');
assert.match(rr('毎週水曜 教室 12月末まで'), /^event 11\/11 RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231 \|教室$/);
assert.match(rr('毎日9時 体操 12月20日まで'), /FREQ=DAILY;UNTIL=20261220T145959Z \|体操$/);
assert.equal(rr('毎週平日9時 朝会'), 'event 11/5 RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR |朝会');
assert.equal(parse('第3回 説明会 明日10時', { now, calendars: [] }).recur, null);
console.log('命令・分割・数日・週の始まり・繰り返し OK');
