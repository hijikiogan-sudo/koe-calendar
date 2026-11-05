// Koe：確認画面、もしかして候補
'use strict';
// ---------- 確認画面（登録・変更で共通） ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minToHM = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const hmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const REMINDS = [
  { v: '', label: '通知なし' }, { v: '10', label: '10分前' }, { v: '30', label: '30分前' },
  { v: '60', label: '1時間前' }, { v: '120', label: '2時間前' }, { v: 'prevday', label: '前の日' },
];
const minLabel = (m) => (m % 1440 === 0 ? `${m / 1440}日前` : m % 60 === 0 ? `${m / 60}時間前` : `${m}分前`);
const RECURS = [
  { v: '', label: '繰り返さない' }, { v: 'DAILY', label: '毎日／○日ごと' }, { v: 'WEEKDAYS', label: '平日のみ' }, { v: 'WEEKLY', label: '毎週／○週ごと' },
  { v: 'MONTHLY', label: '毎月／○か月ごと' }, { v: 'YEARLY', label: '毎年' },
];
const defaultList = (id) => id || (state.taskLists.some((l) => l.id === cfg('defList', '')) ? cfg('defList', '') : state.taskLists[0] && state.taskLists[0].id);
// 比較用に、画面から読み取る形と揃える
function normalizeRec(r) {
  return { freq: r.freq, interval: r.interval || 1, days: r.freq === 'WEEKLY' ? r.days : undefined, monthMode: r.freq === 'MONTHLY' ? (r.monthMode || 'day') : undefined, ...(r.count ? { count: r.count } : {}), ...(r.until ? { until: startOfDay(r.until) } : {}) };
}

// 繰り返しの内容を言葉にする
function recurText(r, d) {
  const n = Number(r.interval) || 1;
  let t = '';
  if (r.freq === 'DAILY') t = n > 1 ? `${n}日ごと` : '毎日';
  else if (r.freq === 'WEEKDAYS') t = '平日のみ';
  else if (r.freq === 'WEEKLY') t = `${n > 1 ? `${n}週ごと` : '毎週'} ${(r.days || []).map((x) => WD[x]).join('・')}曜`;
  else if (r.freq === 'MONTHLY') {
    const head = n > 1 ? `${n}か月ごと` : '毎月';
    t = isNaN(d) ? head : `${head} ${{ day: `${d.getDate()}日`, nth: `第${Math.ceil(d.getDate() / 7)}${WD[d.getDay()]}曜`, last: `最終${WD[d.getDay()]}曜`, end: '月末' }[r.monthMode || 'day']}`;
  } else if (r.freq === 'YEARLY') t = isNaN(d) ? '毎年' : `毎年 ${d.getMonth() + 1}月${d.getDate()}日`;
  if (r.count) t += `（${r.count}回）`;
  if (r.until) t += `（${r.until.getMonth() + 1}月${r.until.getDate()}日まで）`;
  return t;
}
const writableCals = () => state.calendars.filter((c) => c.writable);

// v: {kind,calId,title,date,noDue,allDay,start,end,location,remind,spanDays}
// opt: {heading, heard, okLabel, busyLabel, changed:Set, keepRemind, fixedKind, onOk(v)}
function openForm(v, opt) {
  const cals = writableCals();
  let reminds = REMINDS.slice();
  if (opt.keepRemind) reminds.unshift({ v: 'default', label: opt.keepLabel || 'そのまま（カレンダーの設定）' });
  if (v.remind != null && !reminds.some((r) => r.v === v.remind)) reminds.push({ v: v.remind, label: v.remindLabel || minLabel(Number(v.remind)) });
  const start = v.allDay || v.start == null ? 9 * 60 : v.start;
  const end = v.allDay || v.end == null ? 10 * 60 : v.end;
  const ch = (k) => (opt.changed && opt.changed.has(k) ? ' changed' : '');
  let kind = v.kind || 'event';
  const hasEnd = v.spanDays > 1 || v.endDays > 0;

  openSheet(`
    <h2>${opt.heading}</h2>
    ${opt.heard ? `<p class="heard">「${esc(opt.heard)}」</p>` : ''}
    <button type="button" class="fix-btn" id="c-fix">✎ ミス変換を選んで辞書に登録</button>
    <div class="fix" id="c-fix-panel" hidden></div>
    <div class="kind">
      ${opt.fixedKind
        ? `<span class="tag ${kind === 'task' ? 't-task' : 't-ev'}">${kind === 'task' ? 'タスク' : '予定'}</span>`
        : `<div class="kind-seg"><button type="button" data-k="event">予定</button><button type="button" data-k="task">タスク</button></div>`}
      <span class="kind-note" id="c-kind-note"></span>
    </div>
    <div class="f ev-only${ch('calId')}"><span class="fl">カレンダー</span><div class="cal-chips">${cals.map((c) =>
      `<button type="button" class="cc${c.id === v.calId ? ' on' : ''}" data-id="${esc(c.id)}" style="--c:${c.color};--ct:${c.text || '#fff'}">${esc(c.name)}</button>`).join('')}</div></div>
    <label class="f${ch('title')}"><span class="fl">内容</span><input id="c-title" value="${esc(v.title || '')}" placeholder="例：打ち合わせ"></label>
    <div class="sugg" id="s-title" hidden></div>
    ${opt.quick ? '<div class="sugg" id="s-quick" hidden></div>' : ''}
    <div class="f${ch('date')}"><span class="fl" id="c-date-l">日付</span><div class="trow">
      <input id="c-date" type="date" value="${ymd(v.date || startOfDay(new Date()))}" ${v.noDue ? 'disabled' : ''}>
      <label class="sw task-only"><input id="c-nodue" type="checkbox" ${v.noDue ? 'checked' : ''}>期限なし</label>
    </div></div>
    <div class="f ev-only${ch('time')}"><span class="fl">時間</span><div class="trow">
      <label class="sw"><input id="c-allday" type="checkbox" ${v.allDay ? 'checked' : ''}>終日</label>
      <input id="c-start" type="time" value="${minToHM(start)}" ${v.allDay ? 'disabled' : ''}>
      <span>〜</span>
      <input id="c-end" type="time" value="${minToHM(end)}" ${v.allDay ? 'disabled' : ''}>
    </div></div>
    <div class="conflict ev-only" id="c-conflict" hidden></div>
    <div class="f ev-only" id="c-endrow" ${hasEnd ? '' : 'hidden'}><span class="fl">終わりの日</span><input id="c-enddate" type="date" value="${ymd(addDays(v.date || startOfDay(new Date()), v.allDay ? (v.spanDays || 1) - 1 : v.endDays || 0))}"></div>
    ${opt.recurLocked ? '<p class="note ev-only" style="margin:4px 0 0">この繰り返しは複雑な指定なので、規則の変更はGoogleカレンダーで行ってください。</p>' : ''}
    ${opt.lockDate ? '<p class="note ev-only" style="margin:4px 0 0">この範囲では開始日を変えられません。時間・内容・場所・通知・繰り返しの規則は変えられます。</p>' : `<button type="button" class="link ev-only" id="c-endadd" style="margin-top:6px" ${hasEnd ? 'hidden' : ''}>＋ 別の日に終わる</button>`}
    ${opt.allowRecur ? `<label class="f ev-only"><span class="fl">繰り返し</span><select id="c-recur">${RECURS.filter((r) => !opt.recurRequired || r.v).map((r) => `<option value="${r.v}" ${r.v === ((v.recur && v.recur.freq) || '') ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>
    <div class="ev-only" id="c-rbox" hidden>
      <div class="f" id="c-rint-row"><span class="fl">間隔</span><div class="trow"><input id="c-rint" type="number" inputmode="numeric" min="1" max="99" value="${(v.recur && v.recur.interval) || 1}"><span id="c-rint-unit" class="runit"></span></div></div>
      <div class="f" id="c-rdays-row"><span class="fl">曜日</span><div class="rdays">${[0, 1, 2, 3, 4, 5, 6].map((i) => (i + cfg('weekStart', 0)) % 7).map((d) => `<button type="button" data-d="${d}">${WD[d]}</button>`).join('')}</div></div>
      <label class="f" id="c-rmon-row"><span class="fl">毎月の日</span><select id="c-rmon"></select></label>
      <div class="f"><span class="fl">終わり</span><div class="trow"><select id="c-rend"><option value="">ずっと</option><option value="count">回数で</option><option value="until">日付まで</option></select><input id="c-rcount" type="number" inputmode="numeric" min="1" max="999" placeholder="回" hidden><input id="c-runtil" type="date" hidden></div></div>
      <p class="note" id="c-rsum" style="margin:6px 0 0"></p>
    </div>` : ''}
    ${!opt.fixedKind && state.taskLists.length > 1 ? `<div class="f task-only"><span class="fl">リスト</span><div class="cal-chips">${state.taskLists.map((l) => `<button type="button" class="cc lc${l.id === defaultList(v.listId) ? ' on' : ''}" data-id="${esc(l.id)}" style="--c:var(--task);--ct:var(--on-task)">${esc(l.title)}</button>`).join('')}</div></div>` : ''}
    <label class="f ev-only${ch('location')}"><span class="fl">場所</span><input id="c-loc" value="${esc(v.location || '')}" placeholder="なし"></label>
    <div class="sugg ev-only" id="s-loc" hidden></div>
    ${opt.quick ? '<div class="sugg ev-only" id="s-lquick" hidden></div>' : ''}
    <label class="f ev-only${ch('remind')}"><span class="fl">通知</span><select id="c-remind">${reminds.map((r) =>
      `<option value="${r.v}" ${r.v === (v.remind || '') ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>
    <button class="ok" id="c-ok">${opt.okLabel || 'OK'}</button>
    <button class="act" id="c-cancel">やめる</button>`);

  const sh = $('#sheet');
  const setKind = (k) => {
    kind = k;
    sh.classList.toggle('as-task', k === 'task');
    sh.querySelectorAll('.kind-seg button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    $('#c-kind-note').textContent = k === 'task' ? 'Google ToDoリストに入ります' : 'Googleカレンダーに入ります';
    $('#c-date-l').textContent = k === 'task' ? '期限' : '日付';
    $('#c-date').disabled = k === 'task' && $('#c-nodue').checked;
  };
  sh.querySelectorAll('.kind-seg button').forEach((b) => b.onclick = () => setKind(b.dataset.k));
  $('#c-fix').onclick = () => openFixPanel(() => kind, opt);
  attachSuggest($('#c-title'), $('#s-title'), 'titles');
  attachSuggest($('#c-loc'), $('#s-loc'), 'locs');
  setKind(kind);
  let calId = v.calId;
  sh.querySelectorAll('.cc:not(.lc)').forEach((b) => b.onclick = () => {
    calId = b.dataset.id;
    sh.querySelectorAll('.cc:not(.lc)').forEach((x) => x.classList.toggle('on', x === b));
  });
  let listId = defaultList(v.listId);
  sh.querySelectorAll('.cc.lc').forEach((b) => b.onclick = () => {
    listId = b.dataset.id;
    sh.querySelectorAll('.cc.lc').forEach((x) => x.classList.toggle('on', x === b));
  });
  if (opt.lockDate) { ['c-date', 'c-enddate', 'c-allday'].forEach((id) => { $('#' + id).disabled = true; }); }
  if (opt.lockCal) sh.querySelectorAll('.cc:not(.lc)').forEach((b) => { b.disabled = true; b.style.opacity = b.classList.contains('on') ? 1 : .35; });
  if ($('#c-endadd')) $('#c-endadd').onclick = () => { $('#c-endrow').hidden = false; $('#c-endadd').hidden = true; };
  // 同じ時間の予定があれば知らせる（登録は止めない）
  const dayCache = new Map();
  let conflictSeq = 0;
  const checkConflict = async () => {
    const box = $('#c-conflict'); if (!box) return;
    const id = ++conflictSeq;
    const d = parseYMD($('#c-date').value);
    if (kind !== 'event' || $('#c-allday').checked || isNaN(d) || !$('#c-start').value || !$('#c-end').value) { box.hidden = true; return; }
    const startMin = hmToMin($('#c-start').value);
    let endMin = hmToMin($('#c-end').value);
    const endVal = parseYMD($('#c-enddate').value);
    const diff = $('#c-endrow').hidden || isNaN(endVal) ? 0 : Math.round((endVal - d) / 86400000);
    endMin += diff * 1440;
    if (endMin <= startMin) endMin += 1440;
    const from = new Date(d); from.setMinutes(startMin);
    const to = new Date(d); to.setMinutes(endMin);
    const key = `${ymd(d)}|${diff}`;
    if (!dayCache.has(key)) dayCache.set(key, eventsBetween(d, addDays(d, diff + 2)));
    const list = await dayCache.get(key);
    if (id !== conflictSeq || !$('#c-conflict')) return;
    const hit = list.filter((e) => !e.allDay && !e.transparent && e.start < to && e.end > from && !(opt.notConflict && opt.notConflict(e)));
    box.hidden = !hit.length;
    box.textContent = hit.length ? `この時間には ${hit.slice(0, 3).map((e) => `「${e.title}」${hm(e.start)}〜${hm(e.end)}`).join('、')}${hit.length > 3 ? ` ほか${hit.length - 3}件` : ''} があります` : '';
  };
  ['c-date', 'c-start', 'c-end', 'c-allday', 'c-enddate'].forEach((x) => $('#' + x).addEventListener('change', checkConflict));
  sh.querySelectorAll('.kind-seg button').forEach((b) => b.addEventListener('click', checkConflict));
  checkConflict();
  // 内容が空のときは、よく使う予定を候補に出す
  if (opt.quick) {
    const box = $('#s-quick');
    const drawQuick = () => {
      const list = $('#c-title').value.trim() ? [] : quickTitles();
      box.hidden = !list.length;
      box.innerHTML = list.length ? `<span>よく使う</span>${list.map((t, i) => `<button type="button" data-i="${i}">${esc(t)}</button>`).join('')}` : '';
      box.querySelectorAll('button').forEach((b) => b.onclick = () => { $('#c-title').value = list[Number(b.dataset.i)]; $('#c-title').dispatchEvent(new Event('input')); });
    };
    $('#c-title').addEventListener('input', drawQuick);
    drawQuick();
    const lbox = $('#s-lquick');
    const drawLoc = () => {
      const list = $('#c-loc').value.trim() ? [] : quickPlaces();
      lbox.hidden = !list.length;
      lbox.innerHTML = list.length ? `<span>よく使う</span>${list.map((t, i) => `<button type="button" data-i="${i}">${esc(t)}</button>`).join('')}` : '';
      lbox.querySelectorAll('button').forEach((b) => b.onclick = () => { $('#c-loc').value = list[Number(b.dataset.i)]; $('#c-loc').dispatchEvent(new Event('input')); });
    };
    $('#c-loc').addEventListener('input', drawLoc);
    drawLoc();
  }
  // 繰り返しの詳しい指定
  const rec = { days: new Set((v.recur && v.recur.days) || []), mode: (v.recur && v.recur.monthMode) || 'day' };
  const drawRecur = () => {
    if (!$('#c-recur')) return;
    const freq = $('#c-recur').value, d = parseYMD($('#c-date').value);
    $('#c-rbox').hidden = !freq;
    if (!freq) return;
    $('#c-rint-row').hidden = freq === 'WEEKDAYS' || freq === 'YEARLY';
    $('#c-rint-unit').textContent = { DAILY: '日ごと', WEEKLY: '週ごと', MONTHLY: 'か月ごと' }[freq] || '';
    $('#c-rdays-row').hidden = freq !== 'WEEKLY';
    $('#c-rmon-row').hidden = freq !== 'MONTHLY';
    if (freq === 'WEEKLY' && !rec.days.size && !isNaN(d)) rec.days.add(d.getDay());
    sh.querySelectorAll('.rdays button').forEach((b) => b.classList.toggle('on', rec.days.has(Number(b.dataset.d))));
    if (!isNaN(d)) {
      const lastWeek = addDays(d, 7).getMonth() !== d.getMonth();
      const opts = [['day', `毎月${d.getDate()}日`], ['nth', `第${Math.ceil(d.getDate() / 7)}${WD[d.getDay()]}曜`]];
      if (lastWeek) opts.push(['last', `最終${WD[d.getDay()]}曜`]);
      if (addDays(d, 1).getMonth() !== d.getMonth()) opts.push(['end', '月末']);
      if (!opts.some((o) => o[0] === rec.mode)) rec.mode = 'day';
      $('#c-rmon').innerHTML = opts.map(([k, l]) => `<option value="${k}" ${k === rec.mode ? 'selected' : ''}>${l}</option>`).join('');
    }
    const end = $('#c-rend').value;
    $('#c-rcount').hidden = end !== 'count';
    $('#c-runtil').hidden = end !== 'until';
    const r = readRecur();
    $('#c-rsum').textContent = r ? recurText(r, d) : '';
  };
  const readRecur = () => {
    const freq = $('#c-recur') && $('#c-recur').value;
    if (!freq) return null;
    const r = { freq, interval: Math.max(Number($('#c-rint').value) || 1, 1), days: freq === 'WEEKLY' ? [...rec.days].sort((a, b) => a - b) : undefined, monthMode: freq === 'MONTHLY' ? rec.mode : undefined };
    const end = $('#c-rend').value;
    if (end === 'count' && Number($('#c-rcount').value) > 0) r.count = Number($('#c-rcount').value);
    if (end === 'until' && $('#c-runtil').value) r.until = parseYMD($('#c-runtil').value);
    return r;
  };
  if ($('#c-recur')) {
    if (v.recur && v.recur.count) { $('#c-rend').value = 'count'; $('#c-rcount').value = v.recur.count; }
    if (v.recur && v.recur.until) { $('#c-rend').value = 'until'; $('#c-runtil').value = ymd(v.recur.until); }
    ['c-recur', 'c-rint', 'c-rend', 'c-rcount', 'c-runtil', 'c-date'].forEach((id) => { $('#' + id).addEventListener('change', drawRecur); $('#' + id).addEventListener('input', drawRecur); });
    $('#c-rmon').addEventListener('change', () => { rec.mode = $('#c-rmon').value; drawRecur(); });
    sh.querySelectorAll('.rdays button').forEach((b) => b.onclick = () => {
      const d = Number(b.dataset.d);
      if (rec.days.has(d)) { if (rec.days.size > 1) rec.days.delete(d); } else rec.days.add(d);
      drawRecur();
    });
    drawRecur();
  }
  let prevDate = $('#c-date').value;
  $('#c-date').addEventListener('change', () => { // 開始日を動かしたら終わりの日も同じだけ動かす
    const a = parseYMD($('#c-date').value), o = parseYMD(prevDate), e = parseYMD($('#c-enddate').value);
    if (!isNaN(a) && !isNaN(o) && !isNaN(e)) $('#c-enddate').value = ymd(addDays(e, Math.round((a - o) / 86400000)));
    prevDate = $('#c-date').value;
  });
  $('#c-nodue').onchange = (e) => { $('#c-date').disabled = e.target.checked; };
  $('#c-allday').onchange = (e) => { $('#c-start').disabled = $('#c-end').disabled = e.target.checked; };
  $('#c-start').onchange = () => { // 開始を動かしたら長さを保って終わりも動かす
    if (!$('#c-endrow').hidden) return; // 日をまたぐ予定は終わりの日時を動かさない
    const s = hmToMin($('#c-start').value);
    $('#c-end').value = minToHM(s + Math.max(end - start, 30));
  };
  $('#c-cancel').onclick = closeSheet;
  $('#c-ok').onclick = async () => {
    const out = {
      kind,
      calId,
      title: $('#c-title').value.trim() || (kind === 'task' ? 'タスク' : '予定'),
      location: $('#c-loc').value.trim(),
      date: parseYMD($('#c-date').value),
      noDue: kind === 'task' && $('#c-nodue').checked,
      allDay: $('#c-allday').checked,
      start: hmToMin($('#c-start').value || '09:00'),
      end: hmToMin($('#c-end').value || '10:00'),
      remind: $('#c-remind').value,
      spanDays: v.spanDays || 1,
      endDays: v.endDays || 0,
      listId,
      recur: null,
    };
    if (!out.noDue && isNaN(out.date)) { toast('日付を入れてください'); return; }
    if (kind === 'event' && !isNaN(out.date)) {
      const endVal = parseYMD($('#c-enddate').value);
      const diff = $('#c-endrow').hidden || isNaN(endVal) ? 0 : Math.round((endVal - out.date) / 86400000);
      if (diff < 0) { toast('終わりの日が開始より前になっています'); return; }
      out.spanDays = out.allDay ? diff + 1 : 1;
      out.endDays = out.allDay ? 0 : diff;
      out.recur = readRecur();
      if (out.recur) {
        if ($('#c-rend').value === 'until' && (!out.recur.until || out.recur.until < out.date)) { toast('繰り返しの終わりの日を確かめてください'); return; }
        if ($('#c-rend').value === 'count' && !out.recur.count) { toast('繰り返す回数を入れてください'); return; }
        // 選んだ曜日に当たる最初の日から始める（Googleで余分な1回が増えないように）
        if (out.recur.freq === 'WEEKLY') { while (!out.recur.days.includes(out.date.getDay())) out.date = addDays(out.date, 1); }
        if (out.recur.freq === 'WEEKDAYS') { while (out.date.getDay() === 0 || out.date.getDay() === 6) out.date = addDays(out.date, 1); }
      }
    }
    const ok = $('#c-ok');
    ok.disabled = true; ok.textContent = opt.busyLabel || '保存中…';
    try {
      await opt.onOk(out);
      closeSheet();
      if (!out.noDue) { state.anchor = out.date; state.scrollTop = null; }
      load();
    } catch (err) {
      ok.disabled = false; ok.textContent = opt.okLabel || 'OK';
      handleError(err);
    }
  };
}

// ---------- もしかして（過去の予定名・場所から候補を出す） ----------
// カレンダーから読んだ予定名と場所を、この端末にだけ保存する（ログアウトで消す）
let corpus = store.get('corpus', null);
let corpusStatus = ''; // メニューに出す読み込み状態
const CORPUS_TTL = 12 * 3600 * 1000;
function getCorpus(kind, eventsOnly) {
  if (state.demo) {
    const add = (m, t) => { if (t) m[t] = (m[t] || 0) + 1; return m; };
    const list = demoEvents();
    return kind === 'titles'
      ? ['週次スタッフ会議', '太郎代休', '太郎早出番'].reduce(add, list.reduce((m, e) => add(m, e.title), {}))
      : ['本館3階大会議室'].reduce(add, list.reduce((m, e) => add(m, e.location), {}));
  }
  // 保存分に、いま表示している予定とタスクも足す（読み込み前や失敗時でも候補が出るように）
  const m = { ...((corpus && corpus[kind]) || {}) };
  state.events.forEach((e) => { const t = kind === 'titles' ? e.title : e.location; if (t && !e.diary) m[t] = (m[t] || 0) + 1; });
  if (kind === 'titles' && !eventsOnly) state.tasks.forEach((t) => { if (t.title) m[t.title] = (m[t.title] || 0) + 1; });
  return m;
}
function noteCorpus(v) {
  if (state.demo || v.kind === 'task') return; // ここは予定の言葉だけ（タスクは一覧から候補にする）
  corpus = corpus || { at: 0, titles: {}, locs: {} };
  if (v.title) corpus.titles[v.title] = (corpus.titles[v.title] || 0) + 1;
  if (v.location) corpus.locs[v.location] = (corpus.locs[v.location] || 0) + 1;
  store.set('corpus', corpus);
}
async function refreshCorpus(force) {
  if (state.demo || !state.token) return;
  if (!force && corpus && Date.now() - corpus.at < CORPUS_TTL) return;
  const now = new Date();
  const titles = {}, locs = {};
  corpusStatus = '読み込み中…';
  try {
    for (const c of writableCals()) {
      let pageToken = '', pages = 0;
      do {
        const q = new URLSearchParams({
          timeMin: addDays(now, -365).toISOString(), timeMax: addDays(now, 90).toISOString(),
          singleEvents: 'false', maxResults: '2500', fields: 'items(summary,location,status),nextPageToken',
        });
        if (pageToken) q.set('pageToken', pageToken);
        const data = await api(`/calendars/${encodeURIComponent(c.id)}/events?${q}`);
        (data.items || []).forEach((it) => {
          if (it.status === 'cancelled') return;
          if (it.summary && !it.summary.startsWith('📝')) titles[it.summary] = (titles[it.summary] || 0) + 1;
          if (it.location) locs[it.location] = (locs[it.location] || 0) + 1;
        });
        pageToken = data.nextPageToken || '';
      } while (pageToken && ++pages < 5);
    }
    corpus = { at: Date.now(), titles, locs };
    store.set('corpus', corpus);
    corpusStatus = '';
    // 確認画面を開いたままなら候補を出し直す
    ['c-title', 'c-loc'].forEach((id) => { const x = $('#' + id); if (x) x.dispatchEvent(new Event('input')); });
  } catch (err) {
    console.warn('候補の読み込みに失敗', err); // 候補が減るだけなので作業は止めない
    corpusStatus = `読み込み失敗（${err && err.message ? err.message : '不明'}）`;
  }
}
// よく使う予定：予定の名前で多い順に6つ（2回以上使ったもの）
function quickTitles() {
  const min = state.demo ? 1 : 2;
  return Object.entries(getCorpus('titles', true))
    .filter(([t, n]) => n >= min && [...t].length <= 14)
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
}
function quickPlaces() {
  const min = state.demo ? 1 : 2;
  return Object.entries(getCorpus('locs', true))
    .filter(([t, n]) => n >= min && [...t].length <= 18)
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
}
function drawVoiceQuick() {
  const box = $('#v-quick');
  const show = voice.onText === openConfirm || voice.slot;
  const list = show ? quickTitles() : [];
  box.hidden = !list.length;
  box.innerHTML = list.map((t, i) => `<button data-i="${i}">${esc(t)}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => b.onclick = () => {
    const cb = voice.onText, t = list[Number(b.dataset.i)];
    closeVoice();
    cb(t);
  });
}
function attachSuggest(input, box, kind) {
  const draw = () => {
    const list = window.KoeParse.suggest(input.value, getCorpus(kind));
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<span>もしかして</span>${list.map((t, i) => `<button type="button" data-i="${i}">${esc(t)}</button>`).join('')}` : '';
    box.querySelectorAll('button').forEach((b) => b.onclick = () => { input.value = list[Number(b.dataset.i)]; draw(); });
  };
  input.addEventListener('input', draw);
  draw();
}

// ミス変換を選んで、その場で直して辞書に登録する
function openFixPanel(getKind, opt) {
  const panel = $('#c-fix-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  const fields = [{ label: '内容', input: $('#c-title') }];
  if (getKind() !== 'task') fields.push({ label: '場所', input: $('#c-loc') });
  let sel = null, typed = '';
  const draw = () => {
    const rows = fields.filter((f) => f.input.value.trim());
    if (!rows.length) { panel.innerHTML = '<p class="fix-hint">直す文字がまだありません。</p>'; return; }
    const from = sel ? fields[sel.f].input.value.slice(sel.a, sel.b + 1) : '';
    panel.innerHTML = `<p class="fix-hint">間違っている字を押してください（2文字以上は、最初と最後の字を順に押す）</p>
      ${fields.map((f, fi) => (f.input.value.trim() ? `<div class="fix-row"><span class="fl">${f.label}</span><div class="fix-chars">${[...f.input.value].map((c, i) =>
        `<button type="button" data-f="${fi}" data-i="${i}" class="${sel && sel.f === fi && i >= sel.a && i <= sel.b ? 'on' : ''}">${c === ' ' ? '&nbsp;' : esc(c)}</button>`).join('')}</div></div>` : '')).join('')}
      ${sel ? `<form class="fix-form" id="fix-form"><b>「${esc(from)}」→</b><input id="fix-to" value="${esc(typed)}" placeholder="正しい表記" autocomplete="off" enterkeyhint="done"><button>登録して直す</button></form>` : ''}`;
    panel.querySelectorAll('.fix-chars button').forEach((b) => b.onclick = () => {
      const f = Number(b.dataset.f), i = Number(b.dataset.i);
      if (!sel || sel.f !== f) sel = { f, a: i, b: i };
      else if (sel.a === sel.b && sel.a === i) sel = null; // 同じ字をもう一度押すと解除
      else if (sel.a === sel.b) sel = { f, a: Math.min(sel.a, i), b: Math.max(sel.a, i) };
      else sel = { f, a: i, b: i };
      const old = $('#fix-to'); if (old) typed = old.value;
      draw();
      const inp = $('#fix-to'); if (inp) inp.focus();
    });
    const form = $('#fix-form');
    if (form) form.onsubmit = (e) => {
      e.preventDefault();
      const to = $('#fix-to').value.trim();
      if (!to) { $('#fix-to').focus(); return; }
      const input = fields[sel.f].input, text = input.value;
      // 1文字で言葉の途中なら、前の字も含めて登録する（「佐藤隆」の「隆」など。頭以外の1文字は辞書が置き換えないため）
      const atHead = sel.a === 0 || /[\s、,，・と]/.test(text[sel.a - 1]);
      const useCtx = from.length === 1 && !atHead;
      const regFrom = useCtx ? text[sel.a - 1] + from : from;
      const regTo = useCtx ? text[sel.a - 1] + to : to;
      addDict([regFrom], regTo);
      input.value = text.slice(0, sel.a) + to + text.slice(sel.b + 1);
      // もう一方の欄にも同じ間違いがあれば直す
      fields.forEach((f) => { f.input.value = applyDictField(applyDict(f.input.value)); f.input.dispatchEvent(new Event('input')); });
      if (opt.onFixed) opt.onFixed($('#c-title').value, $('#c-loc').value);
      toast(`辞書に登録：${regFrom} → ${regTo}`);
      sel = null; typed = '';
      panel.hidden = true;
    };
  };
  panel.hidden = false;
  draw();
}

// 新しく登録する
// slot: 長押しした枠 {date, start(分)|null}。言わなかった日付・時間をここから入れる
function openConfirm(text, slot, raw) {
  text = applyDict(text);
  // 「明日の予定は？」「歯医者を削除」などの命令。枠を長押しして話した文は登録として扱う
  if (!slot && !raw) {
    const cmd = window.KoeParse.parseCommand(text, pOpts());
    if (cmd) { runCommand(cmd, text); return; }
  }
  const cals = writableCals();
  if (!cals.length) { toast('書き込めるカレンダーがありません'); return; }
  const p = window.KoeParse.parse(text, pOpts({ calendars: cals }));
  if (!p.calSaid && cals.some((c) => c.id === cfg('defCal', ''))) p.calId = cfg('defCal', '');
  if (p.kind === 'task' && !p.taskWord && cfg('noTimeKind', 'task') === 'event') p.kind = 'event'; // 時刻のない文の扱い
  p.title = applyDictField(p.title); p.location = applyDictField(p.location);
  // 過去に予定として使った言葉（に近いもの）は、時刻がなくても終日の予定にする
  if (p.kind === 'task' && !p.taskWord && p.title) {
    const past = getCorpus('titles', true);
    if (past[p.title] || window.KoeParse.suggest(p.title, past, 1).length) p.kind = 'event';
  }
  if (slot) {
    if (!p.dateSaid) p.date = slot.date;
    if (p.allDay && slot.start != null) { p.allDay = false; p.start = slot.start; p.end = slot.start + 60; p.kind = 'event'; }
  }
  openForm({
    kind: p.kind, calId: p.calId, title: p.title, date: p.date, noDue: p.kind === 'task' && !p.dateSaid && !slot,
    allDay: p.allDay, start: p.start, end: p.end,
    location: p.location, remind: p.remind ? String(p.remind.minutes) : cfg('defRemind', ''), remindLabel: p.remind && p.remind.label,
    spanDays: p.spanDays, endDays: p.endDays, recur: p.recur,
    listId: (p.calSaid && state.taskLists.find((l) => { const c = cals.find((x) => x.id === p.calId); return c && (c.name.includes(l.title) || l.title.includes(c.name)); }) || {}).id,
  }, {
    heading: 'この内容で登録しますか？', heard: text, busyLabel: '登録中…', allowRecur: true, quick: true,
    onFixed: (title, location) => { p.title = title; p.location = location; }, // 直した後を基準に、案内の重複を防ぐ
    onOk: async (v) => {
      const undo = v.kind === 'task' ? await insertTask(v) : await insertEvent(v);
      noteCorpus(v);
      $('#intext').value = '';
      showUndo(`${v.kind === 'task' ? 'タスクを' : ''}登録しました：${v.title}`, async () => { await undo(); load(); });
      offerDict([window.KoeParse.dictDiff(p.title, v.title), v.kind === 'task' ? null : window.KoeParse.dictDiff(p.location, v.location)]);
    },
  });
}
