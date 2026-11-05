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
console.log('命令・分割・数日・週の始まり OK');
