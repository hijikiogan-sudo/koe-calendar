// 聞き取りルールの確認：node tests/run.js
// 例文ごとの結果を tests/expected.txt と比べる。意図して結果を変えたときは `node tests/run.js --update`
const fs = require('fs'), path = require('path');
const { parse } = require('../parse.js');
const now = new Date(2026, 10, 5, 9, 0); // 2026/11/5（木）9:00 を「今」とする
const cals = [{ id: 'm', name: '自分用', primary: true }, { id: 'f', name: 'ファミリー カレンダー' }, { id: 'w', name: '仕事' }];
const hm = (m) => (m == null ? '' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
const lines = fs.readFileSync(path.join(__dirname, 'cases.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const out = lines.map((t) => {
  const r = parse(t, { now, calendars: cals });
  return `${t}\n  → ${r.kind} ${r.calId} ${r.date.getMonth() + 1}/${r.date.getDate()} ${r.allDay ? '終日' : hm(r.start) + '-' + hm(r.end)} |内容:${r.title} |場所:${r.location} |通知:${r.remind ? r.remind.label : ''}`;
}).join('\n') + '\n';
const file = path.join(__dirname, 'expected.txt');
if (process.argv.includes('--update') || !fs.existsSync(file)) { fs.writeFileSync(file, out); console.log('expected.txt を更新しました'); process.exit(0); }
const exp = fs.readFileSync(file, 'utf8');
if (exp === out) { console.log(`OK（${lines.length}件）`); process.exit(0); }
const a = exp.split('\n'), b = out.split('\n');
b.forEach((l, i) => { if (l !== a[i]) console.log(`違い:\n  前 ${a[i]}\n  今 ${l}`); });
process.exit(1);
