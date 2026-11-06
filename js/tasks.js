// Koe：タスク（Google ToDoリスト）
'use strict';
// ---------- タスク（Google ToDoリスト） ----------
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
let demoTasks = null;
const DEMO_LISTS = [{ id: 'l1', title: 'マイタスク' }, { id: 'l2', title: 'ファミリー' }];
function demoTaskList() {
  if (demoTasks) return demoTasks;
  const D = (o) => addDays(startOfDay(new Date()), o);
  demoTasks = [
    { id: 't1', listId: 'l1', listTitle: 'マイタスク', title: '書類を出す', due: D(2) },
    { id: 't2', listId: 'l1', listTitle: 'マイタスク', title: 'チェーンに注油', due: null },
    { id: 't3', listId: 'l1', listTitle: 'マイタスク', title: '電気代を払う', due: D(-1) },
    { id: 't4', listId: 'l2', listTitle: 'ファミリー', title: '牛乳を買う', due: null },
  ];
  return demoTasks;
}

const SETTINGS_LIST = 'Koe設定'; // 辞書の共有に使う。Koeの一覧には出さない
let allLists = [];
async function fetchTasks() {
  const ls = await api(`${TASKS_API}/users/@me/lists?maxResults=100`);
  allLists = ls.items || [];
  state.taskLists = allLists.filter((l) => l.title !== SETTINGS_LIST).map((l) => ({ id: l.id, title: l.title }));
  const out = [];
  await Promise.all(state.taskLists.map(async (l) => {
    let pageToken = '';
    do {
      const q = new URLSearchParams({ showCompleted: 'false', showHidden: 'false', maxResults: '100' });
      if (pageToken) q.set('pageToken', pageToken);
      const data = await api(`${TASKS_API}/lists/${encodeURIComponent(l.id)}/tasks?${q}`);
      (data.items || []).forEach((t) => {
        if (t.status === 'completed' || t.deleted || !t.title) return;
        out.push({ id: t.id, listId: l.id, listTitle: l.title, title: t.title, due: t.due ? parseYMD(t.due.slice(0, 10)) : null, parent: t.parent });
      });
      pageToken = data.nextPageToken || '';
    } while (pageToken);
  }));
  return out;
}

const dueStr = (d) => `${ymd(d)}T00:00:00.000Z`;
const taskPath = (t) => `${TASKS_API}/lists/${encodeURIComponent(t.listId || '@default')}/tasks/${encodeURIComponent(t.id)}`;
async function insertTask(v) {
  const listId = v.listId || (state.taskLists[0] && state.taskLists[0].id) || '@default';
  if (state.demo) {
    const l = DEMO_LISTS.find((x) => x.id === listId) || DEMO_LISTS[0];
    const id = 't' + Date.now();
    demoTaskList().push({ id, listId: l.id, listTitle: l.title, title: v.title, due: v.noDue ? null : v.date });
    return async () => { demoTasks = demoTaskList().filter((x) => x.id !== id); };
  }
  const body = { title: v.title };
  if (!v.noDue) body.due = dueStr(v.date);
  const created = await api(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`, 'POST', body);
  return () => api(taskPath({ listId, id: created.id }), 'DELETE');
}
async function updateTask(t, v) {
  if (state.demo) { Object.assign(demoTaskList().find((x) => x.id === t.id), { title: v.title, due: v.noDue ? null : v.date }); return; }
  await api(taskPath(t), 'PATCH', { title: v.title, due: v.noDue ? null : dueStr(v.date) });
}
async function completeTask(t) {
  if (state.demo) { demoTasks = demoTaskList().filter((x) => x.id !== t.id); return; }
  await api(taskPath(t), 'PATCH', { status: 'completed' });
}
async function uncompleteTask(t) {
  if (state.demo) { demoTasks = demoTaskList().concat(t); return; }
  await api(taskPath(t), 'PATCH', { status: 'needsAction', completed: null });
}
async function deleteTask(t) {
  if (state.demo) { demoTasks = demoTaskList().filter((x) => x.id !== t.id); return; }
  await api(taskPath(t), 'DELETE');
}
async function undeleteTask(t) {
  if (state.demo) { demoTasks = demoTaskList().concat(t); return; }
  await api(taskPath(t), 'PATCH', { deleted: false });
}

// 表示している期間までに期限があるもの（期限切れを含む）と、期限なし
function visibleTasks() {
  const [, e] = range();
  const list = state.tasks.filter((t) => !t.due || t.due < e)
    .sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due && b.due ? a.due - b.due : 0));
  // サブタスクは親のすぐ下に並べる
  const ids = new Set(list.map((t) => t.id));
  const out = [];
  list.filter((t) => !t.parent || !ids.has(t.parent)).forEach((t) => {
    out.push(t);
    list.filter((c) => c.parent === t.id).forEach((c) => out.push(c));
  });
  return out;
}

function renderTasks() {
  const box = $('#tasks');
  const btn = $('#btn-tasks');
  const side = sideTasks();
  btn.setAttribute('aria-pressed', side);
  btn.classList.toggle('on', side);
  btn.title = side ? 'タスク欄を隠す' : 'タスク欄を表示';
  if (WIDE.matches && !side) { box.hidden = true; return; }
  if (!state.token && !state.demo && !state.tasks.length) { box.hidden = true; return; }
  box.hidden = false;
  if (state.view === 'today' && !side && (state.demo || state.tasksOk || !state.token)) { box.hidden = true; return; } // 今日の画面の中に出している
  if (state.token && !state.demo && !state.tasksOk) {
    box.innerHTML = `<div class="tk-head"><b>タスク</b><button class="link" id="tk-auth">ToDoリストを表示するには、もう一度ログイン</button></div>`;
    $('#tk-auth').onclick = () => tokenClient && tokenClient.requestAccessToken();
    return;
  }
  const list = visibleTasks();
  const open = side || store.get('tasksOpen', true); // 広い画面では右に常に出す
  const today = startOfDay(new Date());
  box.innerHTML = `
    <button class="tk-head" id="tk-toggle" aria-expanded="${open}"><b>タスク</b><span class="tk-n">${list.length}</span><span class="tk-arrow">${open ? '▾' : '▸'}</span></button>
    <ul class="tk-list" ${open ? '' : 'hidden'}>${list.map((t) => {
      const late = t.due && t.due < today;
      return `<li data-id="${esc(t.id)}" class="${t.parent && list.some((x) => x.id === t.parent) ? 'sub' : ''}"><button class="tk-box" aria-label="完了にする"></button>
        <button class="tk-title">${esc(t.title)}${state.taskLists.length > 1 && t.listTitle ? `<small>${esc(t.listTitle)}</small>` : ''}</button>
        <span class="tk-due${late ? ' late' : ''}">${t.due ? `${t.due.getMonth() + 1}/${t.due.getDate()}（${WD[t.due.getDay()]}）${late ? ' 期限切れ' : ''}` : '期限なし'}</span></li>`;
    }).join('') || '<li class="tk-empty">この期間のタスクはありません</li>'}</ul>`;
  $('#tk-toggle').onclick = () => { if (side) return; store.set('tasksOpen', !open); renderTasks(); };
  box.querySelectorAll('li[data-id]').forEach((li) => {
    const t = state.tasks.find((x) => x.id === li.dataset.id);
    li.querySelector('.tk-title').onclick = () => openTask(t);
    li.querySelector('.tk-box').onclick = () => doComplete(t, li);
  });
}

async function doComplete(t, li) {
  if (li) li.classList.add('done');
  try {
    await completeTask(t);
    showUndo(`完了：${t.title}`, async () => { await uncompleteTask(t); load(); });
    setTimeout(() => { state.tasks = state.tasks.filter((x) => x.id !== t.id); render(); }, 500);
  } catch (err) { if (li) li.classList.remove('done'); handleError(err); }
}

function openTask(t) {
  const today = startOfDay(new Date());
  const due = t.due ? `${md(t.due)}${t.due < today ? '（期限切れ）' : ''}` : '期限なし';
  openSheet(`
    <h2>${esc(t.title)}</h2>
    <div class="row"><span>種類</span><span><span class="tag t-task">タスク</span></span></div>
    <div class="row"><span>期限</span><span>${due}</span></div>
    ${t.listTitle ? `<div class="row"><span>リスト</span><span>${esc(t.listTitle)}</span></div>` : ''}
    <button class="ok" id="t-done">完了にする</button>
    <div class="e-acts" id="t-acts">
      <button class="act" id="t-edit">手で直す</button>
      <button class="act danger" id="t-del">削除</button>
    </div>`);
  $('#t-done').onclick = () => { closeSheet(); doComplete(t); };
  $('#t-edit').onclick = () => openForm({ kind: 'task', title: t.title, date: t.due || today, noDue: !t.due }, {
    heading: 'タスクを直す', fixedKind: true, okLabel: '変更する', busyLabel: '変更中…',
    onOk: async (v) => { await updateTask(t, v); toast(`変更しました：${v.title}`); },
  });
  $('#t-del').onclick = () => {
    $('#t-acts').innerHTML = `
      <p class="confirm-q">本当に削除しますか？<br><small>「${esc(t.title)}」</small></p>
      <button class="act danger-solid" id="t-del2">削除する</button>
      <button class="act" id="t-keep">やめる</button>`;
    $('#t-keep').onclick = () => openTask(t);
    $('#t-del2').onclick = async () => {
      const b = $('#t-del2'); b.disabled = true; b.textContent = '削除中…';
      try {
        await deleteTask(t); closeSheet(); load();
        showUndo(`削除しました：${t.title}`, async () => { await undeleteTask(t); load(); });
      }
      catch (err) { b.disabled = false; b.textContent = '削除する'; handleError(err); }
    };
  };
}
