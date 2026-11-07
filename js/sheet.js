// Koe：声の命令、検索、下から出る画面、新しい版の確認
'use strict';
// ---------- 声の命令 ----------
async function runCommand(cmd, text) {
  if (cmd.cmd === 'show') { state.anchor = startOfDay(cmd.date); state.scrollTop = null; setView(cmd.view); setInText(''); return; }
  if (cmd.cmd === 'search') { setInText(''); openSearch(cmd.word); return; }
  if (cmd.cmd === 'memo') {
    setInText('');
    if (!state.diary.has(ymd(cmd.date)) && !state.demo && state.token) { // 表示範囲の外の日は、先に読む
      try {
        const list = await eventsBetween(cmd.date, addDays(cmd.date, 1));
        const m = list.find((e) => e.diary); if (m) state.diary.set(ymd(cmd.date), m);
      } catch (err) { console.warn(err); }
    }
    openMemo(startOfDay(cmd.date), cmd.text);
    return;
  }
  const w = (cmd.word || '').toLowerCase();
  const isDone = cmd.cmd === 'done';
  let evs = [];
  if (!isDone) {
    try { evs = await searchEvents(cmd.word); } catch (err) {
      if (err && err.auth) { connectionLost(); return; }
      evs = state.events.filter((e) => e.title.toLowerCase().includes(w));
    }
    const today = startOfDay(new Date());
    evs = evs.filter((e) => (cmd.date ? sameDay(e.start, cmd.date) : e.end >= today)).sort((a, b) => a.start - b.start).slice(0, 20);
  }
  const tks = state.tasks.filter((t) => t.title.toLowerCase().includes(w));
  openSheet(`
    <h2>${isDone ? 'どれを完了にしますか？' : 'どれを削除しますか？'}</h2>
    <p class="heard">「${esc(text)}」</p>
    <ul class="search-res">
      ${tks.map((t, i) => `<li data-t="${i}"><span class="dp-time">タスク</span><span class="dp-title dp-task">☐ ${esc(t.title)}<small>${t.due ? md(t.due) : '期限なし'}</small></span></li>`).join('')}
      ${evs.map((ev, i) => `<li data-e="${i}"><span class="dp-time">${ev.start.getMonth() + 1}/${ev.start.getDate()}</span><span class="dp-title" style="--c:${ev.color}">${esc(ev.title)}<small>${ev.allDay ? '終日' : hm(ev.start)}${ev.location ? ` ・ ${esc(ev.location)}` : ''}</small></span></li>`).join('')}
      ${!evs.length && !tks.length ? '<li class="dp-empty">見つかりませんでした</li>' : ''}
    </ul>
    <button class="act" id="c-asnew">「${esc(text)}」を新しく登録する</button>
    <button class="act" id="c-none">やめる</button>`);
  $('#sheet').querySelectorAll('li[data-e]').forEach((li) => li.onclick = () => openEvent(evs[Number(li.dataset.e)])); // 削除の確認は詳細画面で
  $('#sheet').querySelectorAll('li[data-t]').forEach((li) => li.onclick = () => {
    const t = tks[Number(li.dataset.t)];
    if (isDone) { closeSheet(); doComplete(t); } else openTask(t);
  });
  $('#c-asnew').onclick = () => openConfirm(text, null, true);
  $('#c-none').onclick = closeSheet;
  setInText('');
}

// ---------- 検索 ----------
function openSearch(initial) {
  openSheet(`<h2>検索</h2>
    <input class="search-input" id="s-q" type="search" placeholder="予定名や場所、タスクで探す" autocomplete="off" enterkeyhint="search">
    <ul class="search-res" id="s-res"></ul>`);
  const q = $('#s-q'); q.focus();
  let timer, seq = 0;
  const run = async () => {
    const word = q.value.trim(), id = ++seq, box = $('#s-res');
    if (!word) { box.innerHTML = ''; return; }
    box.innerHTML = '<li class="dp-empty">探しています…</li>';
    let evs = [], offline = false;
    try { evs = await searchEvents(word); } catch (err) {
      if (err && err.auth) { connectionLost(); }
      offline = true;
      const w = word.toLowerCase();
      evs = state.events.filter((e) => (e.title + e.location).toLowerCase().includes(w));
    }
    if (id !== seq) return;
    const w = word.toLowerCase();
    const tks = state.tasks.filter((t) => t.title.toLowerCase().includes(w));
    const now = Date.now();
    evs.sort((a, b) => { // これからの予定を近い順に、その後ろに過去の予定を新しい順に
      const fa = a.end >= now, fb = b.end >= now;
      return fa !== fb ? (fa ? -1 : 1) : fa ? a.start - b.start : b.start - a.start;
    });
    box.innerHTML = `${offline ? '<li class="dp-empty">通信できないので、表示中の予定から探しました</li>' : ''}
      ${tks.map((t, i) => `<li data-t="${i}"><span class="dp-time">タスク</span><span class="dp-title dp-task">☐ ${esc(t.title)}<small>${t.due ? md(t.due) : '期限なし'}</small></span></li>`).join('')}
      ${evs.slice(0, 50).map((ev, i) => `<li data-e="${i}"><span class="dp-time">${ev.start.getFullYear() % 100}/${ev.start.getMonth() + 1}/${ev.start.getDate()}</span>
        <span class="dp-title" style="--c:${ev.color}">${esc(ev.title)}<small>${ev.allDay ? '終日' : hm(ev.start)}${ev.location ? ` ・ ${esc(ev.location)}` : ''}</small></span></li>`).join('')}
      ${!evs.length && !tks.length ? '<li class="dp-empty">見つかりませんでした</li>' : ''}`;
    box.querySelectorAll('li[data-e]').forEach((li) => li.onclick = () => {
      const ev = evs[Number(li.dataset.e)];
      state.anchor = startOfDay(ev.start); state.scrollTop = null;
      if (ev.diary) { state.diary.set(ymd(ev.start), ev); openMemo(startOfDay(ev.start)); return; }
      load(); openEvent(ev);
    });
    box.querySelectorAll('li[data-t]').forEach((li) => li.onclick = () => openTask(tks[Number(li.dataset.t)]));
  };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
  if (typeof initial === 'string' && initial) { q.value = initial; run(); }
}
async function searchEvents(word) {
  if (state.demo) {
    const w = word.toLowerCase();
    return demoEvents().filter((e) => (e.title + e.location).toLowerCase().includes(w));
  }
  if (state.local) return searchLocal(word);
  if (state.apple) return searchApple(word);
  if (!state.token) throw new Error('offline');
  const now = new Date();
  const cals = state.calendars.filter((c) => !isHolidayCal(c) && !state.hidden.has(c.id));
  const lists = await Promise.all(cals.map(async (c) => {
    const p = new URLSearchParams({ q: word, singleEvents: 'true', orderBy: 'startTime', maxResults: '100',
      timeMin: addDays(now, -730).toISOString(), timeMax: addDays(now, 730).toISOString() });
    const data = await api(`/calendars/${encodeURIComponent(c.id)}/events?${p}`);
    return (data.items || []).map((it) => mapEvent(it, c)).filter(Boolean);
  }));
  return lists.flat();
}

// ---------- シート ----------
function openSheet(html) {
  $('#sheet').innerHTML = `<div class="grab"></div>${html}`;
  $('#sheet').hidden = false; $('#sheet-bg').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-bg').hidden = true; }

function openEvent(ev) {
  const cal = state.calendars.find((c) => c.id === ev.calId);
  let when;
  if (ev.allDay) {
    const last = addDays(ev.end, -1);
    when = sameDay(ev.start, last) ? `${md(ev.start)} 終日` : `${md(ev.start)} 〜 ${md(last)} 終日`;
  } else {
    when = sameDay(ev.start, ev.end) ? `${md(ev.start)} ${hm(ev.start)}〜${hm(ev.end)}` : `${md(ev.start)} ${hm(ev.start)} 〜 ${md(ev.end)} ${hm(ev.end)}`;
  }
  const canEdit = !!(cal && cal.writable && !ev.locked);
  openSheet(`
    <h2>${esc(ev.title)}</h2>
    <div class="row"><span>日時</span><span>${when}</span></div>
    ${ev.location ? `<div class="row"><span>場所</span><span>${esc(ev.location)}</span></div>` : ''}
    <div class="row"><span>カレンダー</span><span>${esc(cal ? cal.name : '')}</span></div>
    ${ev.description ? `<div class="row"><span>メモ</span><span class="memo">${esc(htmlToText(ev.description))}</span></div>` : ''}
    ${canEdit ? `
      <form class="chg-bar" id="e-form">
        <input id="e-text" type="text" placeholder="変更を話すか打つ（例：15時からに変更）" autocomplete="off" enterkeyhint="send">
        <button type="button" class="mic-s" id="e-mic" aria-label="声で変更"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
      </form>
      ${ev.recurring ? '<p class="note">繰り返しの予定です。変更・削除のときに範囲を選べます。</p>' : ''}
      <div class="e-acts" id="e-acts">
        <button class="act" id="e-edit">手で直す</button>
        <button class="act" id="e-dup">複製</button>
        <button class="act danger" id="e-del">削除</button>
      </div>`
      : `<p class="note">${ev.locked ? '出席者のいる予定は、Koeでは変更や削除ができません。' : 'このカレンダーは見るだけで、変更や削除はできません。'}</p>`}`);
  if (!canEdit) return;

  $('#e-form').onsubmit = (e) => {
    e.preventDefault();
    const t = $('#e-text').value.trim();
    if (t) { $('#e-text').blur(); withScope(ev, 'どの範囲を変更しますか？', (sc) => { if (!openEdit(ev, t, sc)) openEvent(ev); }); }
  };
  $('#e-mic').onclick = () => startVoice((t) => withScope(ev, 'どの範囲を変更しますか？', (sc) => { if (!openEdit(ev, t, sc)) openEvent(ev); }), '変更したい内容を話してください（例：15時からに変更）');
  $('#e-edit').onclick = () => withScope(ev, 'どの範囲を変更しますか？', (sc) => openEdit(ev, '', sc));
  $('#e-dup').onclick = () => openDuplicate(ev);
  // 削除は2段階で確認（繰り返しは先に範囲を選ぶ）
  $('#e-del').onclick = () => withScope(ev, 'どの範囲を削除しますか？', (sc) => confirmDelete(ev, sc, when));
}

// 繰り返しの予定だけ、範囲を聞いてから進む
const SCOPE_LABEL = { this: 'この日だけ', following: 'この日以降すべて', all: 'すべての日' };
function withScope(ev, question, next) {
  if (!ev.recurring || state.demo) { next('this'); return; }
  openSheet(`
    <h2>${question}</h2>
    <p class="heard">繰り返しの予定「${esc(ev.title)}」（${md(ev.start)}）</p>
    ${Object.entries(SCOPE_LABEL).map(([k, l]) => `<button class="act scope" data-s="${k}">${l}</button>`).join('')}
    <button class="act" id="s-cancel">やめる</button>`);
  $('#sheet').querySelectorAll('.scope').forEach((b) => b.onclick = () => next(b.dataset.s));
  $('#s-cancel').onclick = () => openEvent(ev);
}

function confirmDelete(ev, scope, when) {
  const range = (ev.recurring ? `<br><b>${SCOPE_LABEL[scope]}</b>を削除します` : '') + (state.apple && ev.recurring ? '<br>あとから元に戻せません' : '');
  openSheet(`
    <h2>${esc(ev.title)}</h2>
    <div class="e-acts"><p class="confirm-q">本当に削除しますか？<br><small>「${esc(ev.title)}」${when}${range}</small></p>
      <button class="act danger-solid" id="e-del2">削除する</button>
      <button class="act" id="e-keep">やめる</button></div>`);
  $('#e-keep').onclick = () => openEvent(ev);
  $('#e-del2').onclick = async () => {
    const b = $('#e-del2'); b.disabled = true; b.textContent = '削除中…';
    try {
      const undo = await deleteEvent(ev, scope);
      closeSheet();
      load();
      if (undo) showUndo(`削除しました：${ev.title}`, async () => { await undo(); load(); });
      else toast(`削除しました：${ev.title}`);
    } catch (err) { b.disabled = false; b.textContent = '削除する'; handleError(err); }
  };
}

// 同じ内容で別の予定を作る
function openDuplicate(ev) {
  const v = eventToForm(ev);
  openForm(v, {
    heading: '複製して登録しますか？', busyLabel: '登録中…', fixedKind: true, keepRemind: true, allowRecur: true,
    onOk: async (out) => {
      const undo = await insertEvent(out);
      noteCorpus(out);
      showUndo(`複製しました：${out.title}`, async () => { await undo(); load(); });
    },
  });
}

// ---------- 新しい版の確認 ----------
// ページ自体がキャッシュされて古い版が動き続けるのを防ぐ。新しい版があれば1回だけ開き直す
async function checkNewVersion() {
  if (NATIVE) return; // アプリは中に入れた版で動く
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { version } = await r.json();
    if (!version || String(version) === APP_VERSION) return;
    const key = `reloaded-${version}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    const q = new URLSearchParams(location.search); q.set('v', version);
    location.replace(`${location.pathname}?${q}`);
  } catch (err) { console.warn('版の確認に失敗', err); }
}
