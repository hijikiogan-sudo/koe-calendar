// Koe：見た目、辞書と設定の同期、メニュー
'use strict';
// ---------- テーマ（見た目） ----------
const THEMES = [
  { id: 'note-grid', group: 'ノート', name: '方眼' },
  { id: 'note-dot', group: 'ノート', name: 'ドット' },
  { id: 'note-ruled', group: 'ノート', name: '横罫' },
  { id: 'note-kraft', group: 'ノート', name: 'クラフト' },
  { id: 'note-sakura', group: 'ノート', name: '桜' },
  { id: 'note-sky', group: 'ノート', name: '青空' },
  { id: 'note-meadow', group: 'ノート', name: '草原' },
  { id: 'note-parchment', group: 'ノート', name: '古地図' },
  { id: 'note-night', group: 'ノート', name: '星空' },
  { id: 'note-chalk', group: 'ノート', name: '黒板' },
  { id: 'note-seigaiha', group: 'ノート', name: '青海波' },
  { id: 'note-asanoha', group: 'ノート', name: '麻の葉' },
  { id: 'note-ichimatsu', group: 'ノート', name: '市松' },
  { id: 'note-cat', group: 'ノート', name: '猫' },
  { id: 'note-sea', group: 'ノート', name: '海' },
  { id: 'note-wood', group: 'ノート', name: '木目' },
  { id: 'techo-camel', name: '手帳・キャメル', sw: ['#8a5a33', '#fbf6ea', '#e9cf8f'] },
  { id: 'techo-navy', name: '手帳・ネイビー', sw: ['#26344f', '#fbf6ea', '#e9cf8f'] },
  { id: 'techo-bordeaux', name: '手帳・ボルドー', sw: ['#6d2230', '#fbf6ea', '#e9cf8f'] },
  { id: 'techo-green', name: '手帳・グリーン', sw: ['#2f4a3c', '#fbf6ea', '#e9cf8f'] },
  { id: 'std', name: 'スタンダード', sw: ['#ffffff', '#1d3557', '#d9534f'] },
  { id: 'washi', name: '和紙', sw: ['#f5efe3', '#5b4636', '#a8432f'] },
  { id: 'pastel', name: 'パステル', sw: ['#fff8fb', '#f0789f', '#8a7cf0'] },
  { id: 'mono', name: 'モノトーン', sw: ['#ffffff', '#111111', '#9a9a9a'] },
  { id: 'gold', name: 'ネイビー×ゴールド', sw: ['#1b2a4a', '#c9a85c', '#f8f6f0'] },
];
const DEFAULT_THEME = 'techo-camel';
const KEY_HELP = [['N', '入力欄へ'], ['T', '今日に戻る'], ['1 〜 4', '今日・日・週・月'], ['← →', '前へ・次へ'], ['/', '検索'], ['F', '表示するものを選ぶ'], ['Enter', '入力した内容を確認へ'], ['Shift+Enter', '入力欄で改行'], ['Esc', '閉じる・やめる'], ['?', 'この一覧']]
  .map(([k, t]) => `<div class="row"><span><kbd>${k}</kbd></span><span>${t}</span></div>`).join('');
const MODES = [{ id: 'auto', name: '自動' }, { id: 'light', name: 'ライト' }, { id: 'dark', name: 'ダーク' }];
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = store.get('theme', DEFAULT_THEME);
  const m = store.get('mode', 'auto');
  const dark = /^note-/.test(t) ? /note-(night|chalk)/.test(t) : m === 'dark' || (m === 'auto' && darkMQ.matches);
  if (/^(techo|note)-/.test(t)) document.documentElement.dataset.book = '1'; else delete document.documentElement.dataset.book;
  document.documentElement.dataset.theme = THEMES.some((x) => x.id === t) ? t : DEFAULT_THEME;
  document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
  document.documentElement.dataset.size = cfg('textSize', 'normal');
  HOUR = Number(cfg('hourH', 60));
  document.documentElement.style.setProperty('--hour', `${HOUR}px`);
  const css = getComputedStyle(document.documentElement);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = (css.getPropertyValue('--head-bg') || css.getPropertyValue('--bg')).trim();
}
darkMQ.addEventListener('change', applyTheme);

// ---------- 辞書（聞き取った言葉 → 表記） ----------
// 例：「隆」→「孝」、「サーフ会議」→「スタッフ会議」。この端末に保存する
const getDict = () => store.get('dict', []);
// 辞書はGoogle ToDoの「Koe設定」リストに置いて、iPhoneとパソコンで共有する
let dictPushTimer;
function setDict(d) { store.set('dict', d); touchSync(); }
// 辞書か設定が変わったら、少し待ってGoogle ToDoに保存する
function touchSync() {
  store.set('dictAt', Date.now());
  if (state.offGoogle) return; // AppleやKoeだけの表示ではGoogleと通信しない
  clearTimeout(dictPushTimer);
  dictPushTimer = setTimeout(() => pushDict().catch((err) => console.warn('設定の保存に失敗', err)), 800);
}
function syncedSettings() {
  const c = {};
  try { Object.keys(localStorage).filter((k) => k.startsWith('cfg.')).forEach((k) => { c[k.slice(4)] = store.get(k, null); }); } catch {}
  return { cfg: c, theme: store.get('theme', null), mode: store.get('mode', null), hidden: store.get('hiddenCals', null), hiddenLists: store.get('hiddenLists', null) };
}
function applySynced(r) {
  if (!r || !r.settings) return;
  const x = r.settings;
  Object.entries(x.cfg || {}).forEach(([k, v]) => store.set(`cfg.${k}`, v)); // ここでは保存し直さない
  if (x.theme) store.set('theme', x.theme);
  if (x.mode) store.set('mode', x.mode);
  if (x.hidden) { store.set('hiddenCals', x.hidden); state.hidden = new Set(x.hidden); state.hiddenSaved = true; }
  if (x.hiddenLists) { store.set('hiddenLists', x.hiddenLists); state.hiddenLists = new Set(x.hiddenLists); }
  applyTheme();
  applyCalColors(state.calendars);
  if ($('#sheet').hidden && $('#voice').hidden) load();
}
async function settingsList(create) {
  const ls = await api(`${TASKS_API}/users/@me/lists?maxResults=100`);
  const hit = (ls.items || []).find((l) => l.title === SETTINGS_LIST);
  if (hit || !create) return hit || null;
  return api(`${TASKS_API}/users/@me/lists`, 'POST', { title: SETTINGS_LIST });
}
async function pushDict() {
  if (state.demo || !state.token || !state.tasksOk) return;
  const list = await settingsList(true);
  const path = `${TASKS_API}/lists/${encodeURIComponent(list.id)}/tasks`;
  const old = (await api(`${path}?maxResults=100&showHidden=true`)).items || [];
  const json = JSON.stringify({ at: store.get('dictAt', Date.now()), items: getDict(), settings: syncedSettings() });
  const chunks = json.match(/[\s\S]{1,7000}/g) || [];
  await Promise.all(old.filter((t) => /^dict-/.test(t.title || '')).map((t) => api(`${path}/${encodeURIComponent(t.id)}`, 'DELETE')));
  for (let i = 0; i < chunks.length; i++) await api(path, 'POST', { title: `dict-${String(i).padStart(3, '0')}`, notes: chunks[i] });
}
async function syncDict() {
  if (state.demo || !state.token || !state.tasksOk) return;
  try {
    const list = await settingsList(false);
    const local = getDict(), localAt = store.get('dictAt', 0);
    if (!list) { if (local.length || localAt) await pushDict(); return; }
    const items = ((await api(`${TASKS_API}/lists/${encodeURIComponent(list.id)}/tasks?maxResults=100`)).items || [])
      .filter((t) => /^dict-/.test(t.title || '')).sort((a, b) => (a.title < b.title ? -1 : 1));
    if (!items.length) { if (local.length || localAt) await pushDict(); return; }
    const remote = JSON.parse(items.map((t) => t.notes || '').join(''));
    if (!localAt) { // この端末で初めて：両方の登録を合わせる
      const merged = [...remote.items, ...local.filter((x) => !remote.items.some((r) => r.from === x.from))];
      store.set('dict', merged); store.set('dictAt', Date.now());
      applySynced(remote);
      if (merged.length !== remote.items.length) await pushDict();
    } else if (remote.at > localAt) { store.set('dict', remote.items); store.set('dictAt', remote.at); applySynced(remote); }
    else if (remote.at < localAt) await pushDict();
  } catch (err) { console.warn('辞書の共有に失敗', err); }
}

const applyDict = (text) => window.KoeParse.applyDict(text, getDict());
const applyDictField = (v) => window.KoeParse.applyDictField(v, getDict());
function addDict(fromText, to) {
  const froms = Array.isArray(fromText) ? fromText : fromText.split(/[、,，\s]+/).filter(Boolean);
  const d = getDict().filter((x) => !froms.includes(x.from));
  froms.forEach((from) => d.push({ from, to }));
  setDict(d);
  return froms;
}

// 確認画面で直した内容を「次からも同じように」登録できる案内
function offerDict(pairs) {
  const known = getDict();
  const list = pairs.filter((x) => x && !known.some((d) => d.from === x.from && d.to === x.to));
  if (!list.length) return;
  const p = list[0];
  document.querySelectorAll('.dict-offer').forEach((x) => x.remove());
  const box = el('div', 'dict-offer');
  $('#toast').hidden = true; // 「登録しました」と重ならないように、案内にまとめる
  box.innerHTML = `<span>次から「${esc(p.from)}」を「${esc(p.to)}」にしますか？</span><button class="yes">辞書に登録</button><button class="no">いいえ</button>`;
  $('#app').appendChild(box);
  const timer = setTimeout(() => box.remove(), 15000);
  box.querySelector('.no').onclick = () => { clearTimeout(timer); box.remove(); };
  box.querySelector('.yes').onclick = () => { clearTimeout(timer); addDict(p.from, p.to); box.remove(); toast(`辞書に登録：${p.from} → ${p.to}`); };
}

// ---------- 表示するカレンダーとToDoリストを選ぶ ----------
const showRow = (attr, id, name, on, color) => `<button class="cal ${on ? 'on' : ''}" ${attr}="${esc(id)}" role="checkbox" aria-checked="${on}" style="--c:${color}"><i></i>${esc(name)}</button>`;
function openShow() {
  const cals = state.calendars.map((c) => showRow('data-id', c.id, c.name, !state.hidden.has(c.id), c.color)).join('');
  const lists = state.taskLists.map((l) => showRow('data-list', l.id, l.title, !state.hiddenLists.has(l.id), 'var(--accent)')).join('');
  openSheet(`<h2>表示するもの</h2>
    <div class="sec">カレンダー</div>${cals || '<p class="note">カレンダーを読み込んでいます</p>'}
    ${lists ? `<div class="sec">ToDoリスト</div>${lists}` : ''}
    <p class="note">チェックを外すと、Koeの画面に出なくなるだけです。${state.offGoogle ? '予定やタスク' : 'Googleの予定やタスク'}は消えません。</p>
    <button class="act" id="show-close">閉じる</button>`);
  const sh = $('#sheet');
  bindShowChecks(sh);
  $('#show-close').onclick = closeSheet;
}
function bindShowChecks(sh) {
  sh.querySelectorAll('.cal').forEach((b) => b.onclick = () => {
    const isList = 'list' in b.dataset;
    const set = isList ? state.hiddenLists : state.hidden, id = isList ? b.dataset.list : b.dataset.id;
    set.has(id) ? set.delete(id) : set.add(id);
    const on = !set.has(id);
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    if (state.local && !isList) store.set('localHidden', [...set]);
    if (state.apple) store.set(isList ? 'appleHiddenLists' : 'appleHidden', [...set]);
    if (!state.offGoogle) { store.set(isList ? 'hiddenLists' : 'hiddenCals', [...set]); touchSync(); } // Googleの表示の設定は書き換えない
    // 消すほうはすぐ画面に反映し、そのあと最新を読む
    state.events = state.events.filter((ev) => !state.hidden.has(ev.calId));
    state.tasks = state.tasks.filter((t) => !state.hiddenLists.has(t.listId));
    render();
    load();
  });
}
// 表示を切っている先に登録したときは、画面に出ない理由を伝える
function hiddenNote(v) {
  if (v.kind === 'task') {
    const id = v.listId || (state.taskLists[0] && state.taskLists[0].id);
    return state.hiddenLists.has(id) ? '（表示を切っているリストです）' : '';
  }
  return state.hidden.has(v.calId) ? '（表示を切っているカレンダーです）' : '';
}

const menuOpen = new Set();
function openMenu() {
  const theme = store.get('theme', DEFAULT_THEME), mode = store.get('mode', 'auto');
  const dict = getDict();
  const colors = cfg('calColors', {});
  const cals = state.calendars.map((c) => `<div class="cal-set">
    <button class="cal ${state.hidden.has(c.id) ? '' : 'on'}" data-id="${esc(c.id)}" style="--c:${c.color}"><i></i>${esc(c.name)}</button>
    <div class="swatches" data-id="${esc(c.id)}">${CAL_COLORS.map((col) => `<button style="background:${col}" data-c="${col}" class="${colors[c.id] === col ? 'on' : ''}" aria-label="色を変える"></button>`).join('')}
      <button class="reset ${colors[c.id] ? '' : 'on'}" data-c="" aria-label="Googleの色に戻す">元</button></div>
  </div>`).join('');
  const sel = (key, def, opts) => `<select class="cfg" data-k="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cfg(key, def)) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const row = (label, ctrl) => `<label class="f"><span class="fl wide">${label}</span>${ctrl}</label>`;
  const group = (id, title, body) => `<details class="mgroup" data-g="${id}" ${menuOpen.has(id) ? 'open' : ''}><summary>${title}</summary><div class="mbody">${body}</div></details>`;
  const wcals = writableCals().map((c) => [c.id, c.name]);
  const lists = state.taskLists.map((l) => [l.id, l.title]);
  openSheet(`
    <h2>メニュー</h2>
    ${group('look', '見た目', `
      ${[['手帳', (t) => /^techo/.test(t.id)], ['ノート', (t) => t.group === 'ノート'], ['シンプル', (t) => !/^(techo|note)/.test(t.id)]].map(([label, f]) => `
        <div class="sec" style="margin-top:6px">${label}</div>
        <div class="themes">${THEMES.filter(f).map((t) => `<button class="th${t.id === theme ? ' on' : ''}" data-t="${t.id}">
          ${t.sw ? `<span class="sw3">${t.sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span>` : `<span class="th-thumb" data-theme="${t.id}"></span>`}${t.name}</button>`).join('')}</div>`).join('')}
      <div class="modes" style="margin-top:8px">${MODES.map((m) => `<button data-m="${m.id}" class="${m.id === mode ? 'on' : ''}">${m.name}</button>`).join('')}</div>
      <p class="note" style="margin-top:6px">「自動」は iPhone の設定（ライト／ダーク）に合わせます。ノートは紙の色が決まっているので切り替わりません。</p>
      ${row('予定の文字', sel('textSize', 'normal', [['small', '小'], ['normal', '標準'], ['large', '大']]))}`)}
    ${group('view', '表示', `
      ${row('起動時の画面', sel('startView', 'last', [['last', '前回の画面'], ['today', '今日'], ['day', '日'], ['week', '週'], ['month', '月']]))}
      ${row('週の表示', sel('weekStyle', 'grid', [['grid', '時間軸'], ['list', '一覧']]))}
      ${row('1時間の高さ', sel('hourH', 60, [[48, '低い'], [60, '標準'], [76, '高い'], [96, 'とても高い']]))}
      ${row('週の始まり', sel('weekStart', 0, [[0, '日曜'], [1, '月曜']]))}
      ${row('最初に見せる時刻', sel('startHour', 'now', [['now', '今の時刻の近く'], [6, '6時'], [7, '7時'], [8, '8時'], [9, '9時']]))}
      ${row('今日の予定のカウントダウン', sel('todayCountdown', false, [['false', 'オフ'], ['true', 'オン']]))}
      ${row('六曜を表示', sel('rokuyo', false, [['false', '表示しない'], ['true', '表示する']]))}
      ${row('月の1マスの件数', sel('monthMax', 3, [[2, '2件'], [3, '3件'], [4, '4件'], [5, '5件']]))}`)}
    ${group('cal', 'カレンダーと色', cals)}
    ${group('input', '入力の標準', `
      ${wcals.length ? row('標準のカレンダー', sel('defCal', '', [['', '自動（自分用）'], ...wcals])) : ''}
      ${lists.length > 1 ? row('標準のToDoリスト', sel('defList', '', [['', '自動（先頭のリスト）'], ...lists])) : ''}
      ${row('標準の通知', sel('defRemind', '', REMINDS.map((r) => [r.v, r.label])))}
      ${wcals.length ? row('メモのカレンダー', sel('memoCal', '', [['', '自動（自分用）'], ...wcals])) : ''}
      ${row('時刻のない文', sel('noTimeKind', 'task', [['task', 'タスクにする'], ['event', '終日の予定にする']]))}
      <p class="note" style="margin-top:6px">「までに」「買う」などがある文は、ここの設定に関係なくタスクになります。</p>`)}
    ${group('dict', `辞書（${dict.length}件）`, `
      <ul class="dict">${dict.map((d, i) => `<li><span class="from">${esc(d.from)}</span><span class="arrow">→</span><span class="to">${esc(d.to)}</span>
        <button class="del" data-i="${i}" aria-label="削除">×</button></li>`).join('') || '<li class="dict-empty">まだありません。例：「サーフ会議」→「スタッフ会議」</li>'}</ul>
      <form class="dict-add" id="dict-form">
        <input id="dict-from" placeholder="実際に出る字（隆、高）" autocomplete="off">
        <span>→</span>
        <input id="dict-to" placeholder="書きたい表記" autocomplete="off">
        <button>追加</button>
      </form>
      <p class="note" style="margin-top:6px">iPhoneは「たかし」を「隆」などの漢字で書き起こします。確認画面に出た字を登録してください。「、」で区切ると複数まとめて登録できます。Google ToDoの「Koe設定」リストを使って、iPhoneとパソコンで共有します。</p>`)}
    ${group('notifications', '通知の確認', `
      <p class="note">${state.local ? '通知を設定した予定を、このiPhoneに予約します。' : state.apple ? '予定の通知はAppleカレンダーが届けます。iPhoneの設定で「カレンダー」の通知とサウンドを確認してください。' : '予定の通知はGoogleカレンダーが届けます。iPhoneのGoogleカレンダーアプリで同じアカウントを使い、通知を許可してください。Koeからのプッシュ通知は行っていません。'}</p>
      <p class="note">「通知なし」の予定は鳴りません。通知時刻を過ぎてから設定した通知は、さかのぼって鳴りません。</p>
      ${NATIVE ? '<p class="note" id="m-notify-status">通知の状態を確認中…</p><button class="act" id="m-notify-test">Koeのテスト通知（5秒後）</button><p class="note">テストはKoe自体の通知を確認します。Google・Appleカレンダーからの通知は、それぞれのアプリの通知設定で確認してください。届かない場合は、設定アプリの「通知」、集中モード、サイレントモードを確認してください。</p>' : '<p class="note">このWeb版は、閉じた状態や画面をロックした状態でKoeから通知できません。Googleカレンダーアプリの通知を利用してください。</p>'}`)}
    ${MOUSE.matches ? group('keys', 'キーボード操作', KEY_HELP) : ''}
    ${group('sync', '同期とアカウント', `
      <p class="note" style="margin-top:0">${state.local ? 'Koeの中だけに保存しています。通知はこの端末で鳴ります。アプリを消すと中身も消えるので、ときどき書き出して、別の場所に置いてください。' : state.apple ? 'Appleカレンダーを使っています。ここでの登録・変更・削除はAppleカレンダーとリマインダーに入ります。' : state.demo ? 'お試し表示中です。' : state.token ? 'Googleに接続中です。開いたときと、アプリに戻ったときに自動で更新します。' : 'Googleとの接続が切れています。'}</p>
      <p class="note" style="margin-top:4px">もしかしての候補：<span id="m-corpus"></span></p>
      <button class="act" id="m-corpus-reload" style="margin-top:6px">今すぐ更新</button>
      ${state.local ? `
        <button class="act" id="m-export">書き出す（バックアップ）</button>
        <label class="act" style="display:block;text-align:center;cursor:pointer">読み込む<input type="file" id="m-import" accept=".json,application/json" hidden></label>` : ''}
      ${NATIVE ? '<button class="act" id="m-mode">使い方を変える</button>' : ''}
      ${state.offGoogle ? '' : state.demo
        ? (cfgClientId() ? '<button class="act" id="m-login">Googleでログインする</button>' : '<p class="note">Googleとつなぐには config.js にクライアントIDを設定します（SETUP.md 参照）。</p>')
        : '<button class="act" id="m-logout">ログアウト</button>'}`)}
    <p class="note">Koe ・ 版 ${APP_VERSION}<br>辞書と設定は、Google ToDoの「Koe設定」リストでiPhoneとパソコンに共有します。<br><a class="link" href="https://hijikiogan-sudo.github.io/koe-calendar/about.html" target="_blank" rel="noopener">Koeについて</a> ・ <a class="link" href="https://hijikiogan-sudo.github.io/koe-calendar/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a></p>`);
  const sh = $('#sheet');
  sh.querySelectorAll('.mgroup').forEach((d) => d.addEventListener('toggle', () => { if (d.open) menuOpen.add(d.dataset.g); else menuOpen.delete(d.dataset.g); }));
  sh.querySelectorAll('select.cfg').forEach((x) => x.onchange = () => {
    const k = x.dataset.k;
    if (state.offGoogle && APPLE_KEEP.includes(k)) { toast('この表示では、この設定は保存しません'); return; }
    const v = ['weekStart', 'monthMax', 'hourH'].includes(k) ? Number(x.value) : ['rokuyo', 'todayCountdown'].includes(k) ? x.value === 'true' : x.value;
    setCfg(k, v);
    if (k === 'textSize' || k === 'hourH') applyTheme();
    if (['weekStart', 'monthMax', 'startHour', 'hourH', 'weekStyle', 'rokuyo', 'todayCountdown'].includes(k)) { state.scrollTop = null; load(); }
  });
  sh.querySelectorAll('.swatches button').forEach((b) => b.onclick = () => {
    const id = b.parentElement.dataset.id, cur = cfg('calColors', {});
    if (b.dataset.c) cur[id] = b.dataset.c; else delete cur[id];
    setCfg('calColors', cur);
    applyCalColors(state.calendars);
    if (!state.offGoogle) store.set('calCache', state.calendars);
    const top = sh.scrollTop; openMenu(); $('#sheet').scrollTop = top;
    load();
  });
  sh.querySelectorAll('.th').forEach((b) => b.onclick = () => {
    store.set('theme', b.dataset.t); touchSync(); applyTheme();
    sh.querySelectorAll('.th').forEach((x) => x.classList.toggle('on', x === b));
  });
  sh.querySelectorAll('.modes button').forEach((b) => b.onclick = () => {
    store.set('mode', b.dataset.m); touchSync(); applyTheme();
    sh.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b));
  });
  sh.querySelectorAll('.dict .del').forEach((b) => b.onclick = () => {
    const d = getDict(); d.splice(Number(b.dataset.i), 1); setDict(d);
    const top = sh.scrollTop; openMenu(); $('#sheet').scrollTop = top;
  });
  $('#dict-form').onsubmit = (e) => {
    e.preventDefault();
    const from = $('#dict-from').value.trim(), to = $('#dict-to').value.trim();
    if (!from) { $('#dict-from').focus(); return; }
    addDict(from, to);
    toast(`辞書に追加：${from} → ${to || '（消す）'}`);
    const top = sh.scrollTop; openMenu(); $('#sheet').scrollTop = top;
  };
  bindShowChecks(sh);
  const showCorpus = () => {
    const n = (k) => Object.keys(getCorpus(k)).length;
    const when = corpus && corpus.at ? `（${new Date(corpus.at).toLocaleString('ja-JP')} 読み込み）` : '（過去の予定はまだ読み込んでいません）';
    const box = $('#m-corpus');
    if (box) box.textContent = `予定名 ${n('titles')}件・場所 ${n('locs')}件 ${corpusStatus || when}`;
  };
  showCorpus();
  $('#m-corpus-reload').onclick = async () => {
    if (state.demo) { toast('お試し表示では読み直せません'); return; }
    const run = refreshCorpus(true); showCorpus();
    load(); syncDict();
    await run; showCorpus();
    toast(corpusStatus || '更新しました');
  };
  const testNotify = $('#m-notify-test');
  if (testNotify) {
    const statusBox = $('#m-notify-status');
    const showNotifyStatus = async () => {
      const result = await KoeLocal.notifyStatus();
      if (!statusBox.isConnected) return result;
      statusBox.textContent = `Koeの通知：${({ allowed: '許可済み', denied: '許可されていません。設定アプリの「通知」→「Koe」で許可してください', undecided: 'まだ許可していません' })[result.status] || '確認できません'}${result.status === 'allowed' ? ` ／ バナー：${result.alert ? 'オン' : 'オフ'} ／ サウンド：${result.sound ? 'オン' : 'オフ'} ／ 予定の予約：${result.pending}件` : ''}`;
      return result;
    };
    showNotifyStatus().catch(() => { if (statusBox.isConnected) statusBox.textContent = '通知の状態を取得できませんでした。最新版のアプリが必要です'; });
    testNotify.onclick = async () => {
      testNotify.disabled = true;
      try {
        let { status } = await KoeLocal.notifyStatus();
        if (status === 'undecided') ({ status } = await KoeLocal.notifyRequest());
        if (status !== 'allowed') { await showNotifyStatus(); toast('設定アプリの「通知」→「Koe」で通知を許可してください'); return; }
        await KoeLocal.notifyTest();
        if (state.local) await localNotifySync(false);
        await showNotifyStatus();
        toast('5秒後にテスト通知を出します');
      } catch (err) { toast(err.message || 'テスト通知を予約できませんでした'); }
      finally { testNotify.disabled = false; }
    };
  }
  const mm = $('#m-mode'); if (mm) mm.onclick = openModeSheet;
  const ex = $('#m-export'); if (ex) ex.onclick = exportLocal;
  const im = $('#m-import'); if (im) im.onchange = () => { if (im.files[0]) importLocal(im.files[0]); };
  const lo = $('#m-logout'); if (lo) lo.onclick = logout;
  const li = $('#m-login'); if (li) li.onclick = () => { closeSheet(); state.demo = false; showLogin(); };
}

// アプリ版：Google、Apple、Koeだけの切り替え。切り替えても、それぞれの予定は元の場所に残る
function openModeSheet() {
  const cur = state.demo ? '' : state.local ? 'local' : state.apple ? 'apple' : 'google';
  const opt = (id, key, label) => `<button class="act" id="${id}"${cur === key ? ' disabled' : ''}>${label}${cur === key ? '（使用中）' : ''}</button>`;
  openSheet(`<h2>使い方を変える</h2>
    <p class="note">切り替えても、予定は移りません。それぞれの場所に残っていて、戻せばまた見られます。</p>
    ${opt('mode-google', 'google', 'Googleカレンダーを使う')}
    ${opt('mode-apple', 'apple', 'Appleカレンダーを使う')}
    ${opt('mode-local', 'local', 'Koeだけで使う')}
    <button class="act" id="mode-back">戻る</button>`);
  $('#mode-google').onclick = useGoogleMode;
  $('#mode-apple').onclick = enterAppleView;
  $('#mode-local').onclick = enterLocalView;
  $('#mode-back').onclick = openMenu;
}
