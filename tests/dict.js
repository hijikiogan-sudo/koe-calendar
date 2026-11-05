// 辞書の確認：node tests/dict.js
const assert = require('assert');
const { applyDict, applyDictField, dictDiff, suggest } = require('../parse.js');
const d = [{ from: '満', to: '孝' }, { from: 'たかし', to: '孝' }, { from: 'サーフ会議', to: 'スタッフ会議' }];
assert.equal(applyDict('たかし代休', d), '孝代休');
assert.equal(applyDict('週次サーフ会議', d), '週次スタッフ会議');
assert.equal(applyDict('満代休', d), '満代休'); // 1文字は文全体では置き換えない
assert.equal(applyDictField('満代休', d), '孝代休');
assert.equal(applyDictField('満', d), '孝');
assert.equal(applyDictField('花子と満 面談', d), '花子と孝 面談');
assert.equal(applyDictField('満足度調査', d), '満足度調査');
assert.equal(applyDictField('未満の確認', d), '未満の確認');
assert.deepEqual(dictDiff('満代休', '孝代休'), { from: '満', to: '孝' });
assert.deepEqual(dictDiff('週次サーフ会議', '週次スタッフ会議'), { from: 'サーフ', to: 'スタッフ' });
assert.deepEqual(dictDiff('ウィークリーサーフ会議', 'ウィークリースタッフ会議'), { from: 'ウィークリーサーフ', to: 'ウィークリースタッフ' });
assert.equal(dictDiff('会議', '会議'), null);
assert.equal(dictDiff('会議', ''), null);
// もしかして
const c = { '週次スタッフ会議': 5, '孝代休': 8, '孝早出番': 3, '花子代休': 9, '面接': 2, '新館3階大会議室': 4, '新館3階講堂': 1 };
assert.deepEqual(suggest('週次サーフ会議', c), ['週次スタッフ会議']);
assert.deepEqual(suggest('満代休', c), ['孝代休']);
assert.deepEqual(suggest('満早出番', c), ['孝早出番']);
assert.deepEqual(suggest('孝代休', c), []); // すでにある言葉
assert.deepEqual(suggest('面談', c), []); // 短い語は出さない
assert.deepEqual(suggest('まったく別の予定です', c), []);
assert.deepEqual(suggest('新刊3階大会議室', c), ['新館3階大会議室']);
assert.deepEqual(suggest('', c), []);
console.log('辞書・もしかして OK');
