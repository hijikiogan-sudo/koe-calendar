// Koe：Googleとのやり取り、保存、元に戻す
'use strict';
// ---------- データ ----------
async function load() {
  const id = ++state.reqId;
  const [s, e] = range();
  if (state.demo) {
    demoEvents().forEach((ev) => { const c = state.calendars.find((x) => x.id === ev.calId); if (c) ev.color = c.color; });
    state.events = demoEvents().filter((ev) => !state.hidden.has(ev.calId) && ev.start < e && ev.end > s);
    state.tasks = demoTaskList().filter((t) => !state.hiddenLists.has(t.listId));
    state.taskLists = DEMO_LISTS;
    state.diary = state.demoDiary || new Map();
    state.holidays = new Map([[`${new Date().getFullYear()}-11-03`, '文化の日']]);
    render(); return;
  }
  if (state.local) { loadLocal(s, e); return; }
  if (state.apple) { await loadApple(id, s, e); return; }
  if (!state.token) { loadCached(); return; } // 接続が切れている間は保存済みを表示
  $('#view').classList.add('loading');
  try {
    const holidayCals = state.calendars.filter(isHolidayCal);
    // メモのカレンダーは、表示を切っていても読む
    const targets = state.calendars.filter((c) => !state.hidden.has(c.id) || isHolidayCal(c) || c.id === memoCalId());
    const tasksP = state.tasksOk ? fetchTasks().catch((err) => { if (err.scope) state.tasksOk = false; else if (err.auth) throw err; else console.error(err); return state.tasks; }) : Promise.resolve([]);
    const [lists, tasks] = await Promise.all([Promise.all(targets.map((c) => fetchEvents(c, s, e))), tasksP]);
    if (id !== state.reqId) return;
    const hol = new Map();
    lists.flat().forEach((ev) => { if (holidayCals.some((c) => c.id === ev.calId)) hol.set(ymd(ev.start), ev.title); });
    state.holidays = hol;
    const shown = lists.flat();
    state.diary = new Map(shown.filter((ev) => ev.diary).map((ev) => [ymd(ev.start), ev]));
    state.events = shown.filter((ev) => !ev.diary && !state.hidden.has(ev.calId));
    state.tasks = tasks;
    state.stale = null; state.authLost = false;
    const kept = shown.filter((ev) => !state.hidden.has(ev.calId) || ev.diary);
    saveCache(rangeKey(), kept, tasks, hol);
    const same = state.firstKey && state.firstKey === cacheKey(kept, tasks, [...hol]);
    state.firstKey = null;
    if (same) renderConn(); else render(); // 先に出した控えと同じなら描き直さない
  } catch (err) {
    if (id !== state.reqId) return;
    if (err && err.auth) { handleError(err); return; }
    console.warn(err);
    if (!loadCached()) toast('読み込めませんでした。通信を確認してください');
  } finally {
    if (id === state.reqId) $('#view').classList.remove('loading');
  }
}

// ---------- 保存（電波がない・接続が切れたときの表示用。この端末だけ）----------
const isHolidayCal = (c) => c.holiday || /#holiday@/.test(c.id);
const rangeKey = () => `${state.view}|${ymd(range()[0])}`;
function saveCache(key, events, tasks, hol) {
  const c = store.get('evCache', {});
  c[key] = { at: Date.now(), ev: events, hol: [...hol] };
  const keys = Object.keys(c).sort((x, y) => c[y].at - c[x].at);
  keys.slice(12).forEach((k) => delete c[k]); // 新しい12画面分だけ残す
  store.set('evCache', c);
  store.set('taskCache', { tasks, lists: state.taskLists });
}
function loadCached() {
  const hit = store.get('evCache', {})[rangeKey()];
  const tc = store.get('taskCache', null);
  if (tc) {
    state.tasks = (tc.tasks || []).filter((t) => !state.hiddenLists.has(t.listId)).map((t) => ({ ...t, due: t.due ? new Date(t.due) : null }));
    state.taskLists = tc.lists || [];
  }
  const cached = hit ? hit.ev.map((ev) => ({ ...ev, start: new Date(ev.start), end: new Date(ev.end), color: (state.calendars.find((c) => c.id === ev.calId) || ev).color })) : [];
  state.diary = new Map(cached.filter((ev) => ev.diary).map((ev) => [ymd(ev.start), ev]));
  state.events = cached.filter((ev) => !ev.diary && !state.hidden.has(ev.calId));
  state.holidays = new Map(hit ? hit.hol : []);
  state.stale = hit ? hit.at : -1;
  render();
  return !!hit;
}
// 開いた直後：前回の予定を「時点」の帯なしで先に出す（このあとすぐ最新を取りに行く）
const cacheKey = (ev, tasks, hol) => `${rangeKey()}|${JSON.stringify([ev, tasks, hol])}`;
const calKey = () => JSON.stringify([state.calendars.map((c) => [c.id, c.color]), [...state.hidden]]);
function showCachedFirst() {
  const hit = loadCached();
  state.stale = null;
  renderConn();
  const cached = store.get('evCache', {})[rangeKey()], tc = store.get('taskCache', null);
  state.firstKey = hit && tc ? cacheKey(cached.ev, tc.tasks, cached.hol) : null;
}
function renderConn() {
  const bar = $('#conn-bar');
  if (!bar) return;
  if (state.demo || (!state.authLost && !state.stale)) { bar.hidden = true; return; }
  const when = state.stale > 0 ? `（${new Date(state.stale).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}時点）` : state.stale === -1 ? '（この期間は保存がありません）' : '';
  bar.hidden = false;
  bar.innerHTML = state.authLost
    ? `<span>接続が切れました${when}</span><button id="conn-retry">再接続</button>`
    : `<span>電波がないため、保存済みの予定を表示中${when}</span><button id="conn-retry">更新</button>`;
  $('#conn-retry').onclick = () => {
    if (!state.authLost) { load(); return; }
    if (tokenClient) tokenClient.requestAccessToken({ prompt: '' });
    else toast('通信を確認してから、もう一度押してください');
  };
}

// ---------- 元に戻す ----------
function showUndo(msg, fn) {
  document.querySelectorAll('.undo-bar').forEach((x) => x.remove());
  const box = el('div', 'undo-bar');
  box.innerHTML = `<span>${esc(msg)}</span><button>元に戻す</button>`;
  $('#app').appendChild(box);
  const timer = setTimeout(() => box.remove(), 10000);
  box.querySelector('button').onclick = async () => {
    clearTimeout(timer); box.remove();
    try { await fn(); toast('元に戻しました'); } catch (err) { handleError(err); }
  };
}

function htmlToText(html) {
  const t = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  return (new DOMParser().parseFromString(t, 'text/html').body.textContent || '').trim();
}

async function api(path, method = 'GET', body, retried) {
  if (state.offGoogle) throw new Error('この表示ではGoogleと通信しません');
  await ensureFreshToken();
  const opt = { method, headers: { Authorization: `Bearer ${state.token}` } };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path.startsWith('http') ? path : API + path, opt);
  if (r.status === 401 && NATIVE && !retried) { store.del('token'); return api(path, method, body, true); } // 期限前に切れたときは一度つなぎ直す
  if (r.status === 401) throw Object.assign(new Error('auth'), { auth: true });
  if (r.status === 403 && path.includes('tasks.googleapis')) throw Object.assign(new Error('ToDoリストの許可がありません'), { scope: true });
  if (!r.ok) throw new Error(`Google APIエラー（${r.status}）`);
  return r.status === 204 ? null : r.json();
}

async function fetchCalendars() {
  const data = await api('/users/me/calendarList?minAccessRole=reader');
  state.calendars = (data.items || []).map((c) => ({
    id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor || '#2f5d8a', text: c.foregroundColor || '#fff', primary: !!c.primary,
    writable: c.accessRole === 'owner' || c.accessRole === 'writer',
  })).sort((a, b) => b.primary - a.primary);
  applyCalColors(state.calendars);
  if (!state.hiddenSaved) {
    (data.items || []).forEach((c) => { if (c.selected === false) state.hidden.add(c.id); });
  }
  store.set('calCache', state.calendars);
}

function mapEvent(it, cal) {
  if (it.status === 'cancelled' || !it.start) return null;
  const allDay = !!it.start.date;
  return {
    diary: !!(it.extendedProperties && it.extendedProperties.private && it.extendedProperties.private.koeMemo),
    id: it.id, calId: cal.id, title: it.summary || '（タイトルなし）', location: it.location || '', description: it.description || '',
    allDay,
    start: allDay ? parseYMD(it.start.date) : new Date(it.start.dateTime),
    end: allDay ? parseYMD(it.end.date) : new Date(it.end.dateTime),
    color: cal.color, text: cal.text,
    reminders: it.reminders, recurring: !!it.recurringEventId, masterId: it.recurringEventId || null,
    transparent: it.transparency === 'transparent', // 「空き時間」扱いの予定
  };
}

async function fetchEvents(cal, s, e) {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      timeMin: s.toISOString(), timeMax: e.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await api(`/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
    (data.items || []).forEach((it) => { const ev = mapEvent(it, cal); if (ev) out.push(ev); });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

// お試し表示の予定（登録・変更・削除はこの配列を書き換える。再読み込みで元に戻る）
let demoStore = null;
function demoEvents() {
  if (demoStore) return demoStore;
  const t = (dayOff, h, m = 0) => { const d = addDays(startOfDay(new Date()), dayOff); d.setHours(h, m); return d; };
  const mk = (calId, title, location, start, end, allDay = false) => {
    const c = state.calendars.find((x) => x.id === calId);
    return { id: title + start.getTime(), calId, title, location, start, end, allDay, color: c.color };
  };
  const D = (o) => addDays(startOfDay(new Date()), o);
  demoStore = [
    mk('work', '朝会', '', t(-1, 9), t(-1, 9, 30)),
    Object.assign(mk('work', '打ち合わせ', '会議室A', t(0, 14), t(0, 15)), { description: '資料を持参<br>議題は前回の続き' }),
    mk('me', '勉強会', '', D(1), D(2), true),
    mk('work', '面談', '会議室B', t(2, 10), t(2, 11, 30)),
    mk('me', '歯医者', '〇〇歯科', t(2, 10, 30), t(2, 11, 15)),
    mk('family', '家族で買い物', '駅前', t(4, 17), t(4, 19)),
    mk('me', 'ジム', '', t(5, 7), t(5, 8)),
    mk('family', '旅行', '箱根', D(8), D(11), true),
    mk('work', '締め切り', '', D(12), D(13), true),
    mk('work', '定例会', '会議室A', t(7, 13), t(7, 14)),
  ];
  return demoStore;
}
const DEMO_CALS = [
  { id: 'work', name: '仕事', color: '#2f5d8a', writable: true },
  { id: 'me', name: '自分用', color: '#2e7d4f', writable: true },
  { id: 'family', name: 'ファミリー', color: '#c0628a', writable: true },
];
