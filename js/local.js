// Koe：Googleを使わず、Koeの中だけに予定を保存する（試作・アプリ版のみ）
'use strict';
const KoeLocal = NATIVE ? window.Capacitor.registerPlugin('KoeLocal') : null;
const isLocalView = () => NATIVE && store.get('useMode', null) === 'local';
function enterLocalView() { store.set('useMode', 'local'); location.reload(); }

const LOCAL_CALS = [
  { id: 'me', name: '自分用', color: '#2e7d4f', text: '#fff', primary: true, writable: true },
  { id: 'work', name: '仕事', color: '#2f5d8a', text: '#fff', primary: false, writable: true },
  { id: 'family', name: '家族', color: '#c0628a', text: '#fff', primary: false, writable: true },
];
const localEmpty = () => ({ app: 'koe', version: 1, events: [], tasks: [], lists: [{ id: 'inbox', title: 'タスク' }], memos: {} });
const localId = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// 読めない形のものは使わない。余計な項目は取り込まない
function localClean(x) {
  if (!x || x.app !== 'koe' || !Array.isArray(x.events) || !Array.isArray(x.tasks)) throw new Error('Koeのデータではありません');
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const str = (s) => (typeof s === 'string' ? s : '');
  const lists = (Array.isArray(x.lists) ? x.lists : []).filter((l) => l && l.id && l.title).map((l) => ({ id: String(l.id), title: String(l.title) }));
  if (!lists.length) lists.push({ id: 'inbox', title: 'タスク' });
  const events = x.events.filter((e) => e && e.id && isDay(e.date) && typeof e.title === 'string').map((e) => ({
    id: String(e.id), calId: LOCAL_CALS.some((c) => c.id === e.calId) ? e.calId : LOCAL_CALS[0].id,
    title: e.title, location: str(e.location), description: str(e.description), date: e.date, allDay: !!e.allDay,
    start: Number(e.start) || 0, end: Number(e.end) || 0, endDays: Number(e.endDays) || 0, spanDays: Number(e.spanDays) || 1,
    recur: localRule(e.recur), ex: Array.isArray(e.ex) ? e.ex.filter(isDay) : [],
    notifications: Array.isArray(e.notifications) ? validateNotifications(e.notifications) : undefined,
    remind: typeof e.remind === 'number' && e.remind >= 0 ? e.remind : null,
  }));
  const tasks = x.tasks.filter((t) => t && t.id && typeof t.title === 'string').map((t) => ({
    id: String(t.id), listId: lists.some((l) => l.id === t.listId) ? t.listId : lists[0].id, title: t.title,
    due: isDay(t.due) ? t.due : null, done: !!t.done,
  }));
  const memos = {};
  Object.entries(x.memos || {}).forEach(([k, v]) => { if (isDay(k) && typeof v === 'string') memos[k] = v; });
  return { app: 'koe', version: 1, events, tasks, lists, memos };
}
function localRule(r) {
  if (!r || !['DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq)) return null;
  const out = { freq: r.freq, interval: Number(r.interval) || 1 };
  if (r.freq === 'WEEKLY' && Array.isArray(r.days) && r.days.length) out.days = r.days.map(Number).sort((a, b) => a - b);
  if (r.freq === 'MONTHLY') out.monthMode = r.monthMode || 'day';
  if (r.count) out.count = Number(r.count);
  else if (r.until) out.until = typeof r.until === 'string' ? r.until : ymd(new Date(r.until));
  return out;
}

// ---------- 保存 ----------
let localDb = null;
let localChain = Promise.resolve();
// 読み込めないときに上書きしないよう、最後の控えから読み直す。それも無理なら書き込みを止める
let localBroken = false;
async function localOpen() {
  const parse = (text) => localClean(JSON.parse(text));
  const { text } = await KoeLocal.read({});
  if (!text) { localDb = localEmpty(); return; }
  try { localDb = parse(text); return; } catch (err) { console.warn(err); }
  const { backups } = await KoeLocal.backups();
  for (const name of backups) {
    try {
      localDb = parse((await KoeLocal.read({ name })).text);
      toast(`保存データを読めなかったので、控え（${name.slice(7, 17)}）から戻しました`);
      return;
    } catch (err) { console.warn(err); }
  }
  localDb = localEmpty(); localBroken = true;
  toast('保存データを読めませんでした。上書きを防ぐため、登録を止めています');
}
// 書けたときだけ、画面のデータを新しくする。戻すための処理を返す
function localCommit(change) {
  const run = async () => {
    if (localBroken) throw new Error('保存データを読めないため、登録できません');
    const before = JSON.stringify(localDb);
    const next = JSON.parse(before);
    change(next);
    await KoeLocal.write({ text: JSON.stringify(next) });
    localDb = next;
    localNotifySync(true);
    return () => localCommit((d) => { Object.assign(d, JSON.parse(before)); });
  };
  const p = localChain.then(run, run);
  localChain = p.catch(() => {});
  return p;
}

// ---------- 繰り返し ----------
function* localDates(rec) {
  const base = parseYMD(rec.date);
  if (!rec.recur) { yield base; return; }
  const r = rec.recur, n = Number(r.interval) || 1;
  const until = r.until ? parseYMD(r.until) : null;
  let made = 0;
  const walk = function* () {
    if (r.freq === 'DAILY') { for (let i = 0; ; i++) yield addDays(base, i * n); }
    if (r.freq === 'WEEKDAYS') { for (let i = 0; ; i++) { const d = addDays(base, i); if (d.getDay() % 6) yield d; } }
    if (r.freq === 'WEEKLY') {
      const days = r.days && r.days.length ? r.days : [base.getDay()];
      const week0 = addDays(base, -base.getDay());
      for (let w = 0; ; w++) for (const day of days) { const d = addDays(week0, w * 7 * n + day); if (d >= base) yield d; }
    }
    if (r.freq === 'MONTHLY') {
      const mode = r.monthMode || 'day';
      const nth = Math.ceil(base.getDate() / 7), wd = base.getDay();
      for (let i = 0; ; i++) {
        const y = base.getFullYear(), m = base.getMonth() + i * n;
        let d;
        if (mode === 'end') d = new Date(y, m + 1, 0);
        else if (mode === 'last') { d = new Date(y, m + 1, 0); d = addDays(d, -((d.getDay() - wd + 7) % 7)); }
        else if (mode === 'nth') {
          const first = new Date(y, m, 1);
          d = addDays(first, (wd - first.getDay() + 7) % 7 + (nth - 1) * 7);
          if (d.getMonth() !== first.getMonth()) continue; // 第5週がない月
        } else {
          d = new Date(y, m, base.getDate());
          if (d.getDate() !== base.getDate()) continue; // 31日がない月
        }
        if (d >= base) yield d;
      }
    }
    if (r.freq === 'YEARLY') {
      for (let i = 0; ; i++) {
        const d = new Date(base.getFullYear() + i * n, base.getMonth(), base.getDate());
        if (d.getDate() === base.getDate()) yield d;
      }
    }
  };
  for (const d of walk()) {
    if (until && d > until) return;
    if (r.count && made >= r.count) return;
    made++;
    yield d;
  }
}
function localOccurrence(rec, d) {
  const { startDate, endDate } = eventBody({ ...rec, date: d, recur: null, remind: 'default' });
  const cal = state.calendars.find((c) => c.id === rec.calId) || LOCAL_CALS[0];
  return {
    diary: false, id: rec.recur ? `${rec.id}|${ymd(d)}` : rec.id, recId: rec.id, occ: ymd(d), calId: rec.calId, title: rec.title,
    location: rec.location, description: rec.description, allDay: rec.allDay, start: startDate, end: endDate,
    color: cal.color, text: cal.text, recurring: !!rec.recur, masterId: rec.recur ? rec.id : null, transparent: false,
    reminders: { useDefault: false, overrides: rec.notifications || (rec.remind != null ? [{ method: 'popup', minutes: rec.remind }] : []) },
  };
}
function localBetween(s, e) {
  const out = [];
  localDb.events.forEach((rec) => {
    for (const d of localDates(rec)) {
      if (d >= e) break;
      if ((rec.ex || []).includes(ymd(d))) continue;
      const ev = localOccurrence(rec, d);
      if (ev.start < e && ev.end > s) out.push(ev);
    }
  });
  return out;
}
const localMaster = (ev) => ({ recurrence: [window.KoeParse.recurRule(localDb.events.find((r) => r.id === ev.recId).recur, parseYMD(localDb.events.find((r) => r.id === ev.recId).date), ev.allDay)] });

// ---------- 通知（端末に予約する）----------
// 端末に予約できる数には上限があるので、近いものから入れ、開くたびに先の分を足す
const NOTIFY_DAYS = 60, NOTIFY_MAX = 60;
function localNotifyItems(now = Date.now()) {
  const label = (ev) => {
    const d = ev.start, day = `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
    const time = ev.allDay ? '' : ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${day}${time}${ev.location ? ` ${ev.location}` : ''}`;
  };
  const items = [];
  const until = now + NOTIFY_DAYS * 86400000;
  // 4週間前の通知は、予定そのものが60日より先でも予約期間内に入る。
  localBetween(new Date(now), new Date(until + 28 * 86400000)).forEach((ev) => {
    ev.reminders.overrides.forEach(({ minutes: min }, index) => {
      const at = ev.start.getTime() - min * 60000;
      if (at > now + 1000 && at <= until && ev.start.getTime() > now) items.push({ id: `${ev.recId}-${ev.occ}-${index}`, title: ev.title, body: label(ev), at });
    });
  });
  return items.sort((a, b) => a.at - b.at).slice(0, NOTIFY_MAX);
}
let notifyChain = Promise.resolve(), notifyWarned = false;
// ask：保存の直後だけ、必要なら許可を尋ねる
function localNotifySync(ask) {
  const run = async () => {
    const items = localNotifyItems();
    let { status } = await KoeLocal.notifyStatus();
    if (status === 'undecided' && ask && items.length) ({ status } = await KoeLocal.notifyRequest());
    if (status === 'allowed') {
      const { count } = await KoeLocal.notifySchedule({ items });
      if (count !== items.length) throw new Error('予定は保存しましたが、一部の通知を予約できませんでした');
      return;
    }
    if (status === 'denied' && ask && items.length && !notifyWarned) {
      notifyWarned = true;
      toast('通知が許可されていないため鳴りません。設定アプリで許可できます');
    }
  };
  notifyChain = notifyChain.then(run, run).catch((err) => {
    console.warn(err);
    if (ask) toast(err.message || '予定は保存しましたが、通知を予約できませんでした');
  });
  return notifyChain;
}

// ---------- 祝日（内閣府の決まりから計算する）----------
const holidayCache = new Map();
function jpHolidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const m = new Map();
  const put = (mo, d, name) => m.set(ymd(new Date(y, mo - 1, d)), name);
  const monday = (mo, nth) => { const f = new Date(y, mo - 1, 1); return 1 + ((8 - f.getDay()) % 7) + (nth - 1) * 7; };
  const eq = (c) => Math.floor(c + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  put(1, 1, '元日'); put(1, monday(1, 2), '成人の日'); put(2, 11, '建国記念の日'); put(2, 23, '天皇誕生日');
  put(3, eq(20.8431), '春分の日'); put(4, 29, '昭和の日'); put(5, 3, '憲法記念日'); put(5, 4, 'みどりの日'); put(5, 5, 'こどもの日');
  put(7, monday(7, 3), '海の日'); put(8, 11, '山の日'); put(9, monday(9, 3), '敬老の日'); put(9, eq(23.2488), '秋分の日');
  put(10, monday(10, 2), 'スポーツの日'); put(11, 3, '文化の日'); put(11, 23, '勤労感謝の日');
  const base = [...m.keys()];
  base.forEach((k) => { // 祝日にはさまれた平日は休日
    const next = addDays(parseYMD(k), 2), mid = addDays(parseYMD(k), 1);
    if (m.has(ymd(next)) && !m.has(ymd(mid)) && mid.getDay() !== 0) m.set(ymd(mid), '国民の休日');
  });
  base.forEach((k) => { // 日曜と重なったら、次の祝日でない日が振替
    const d = parseYMD(k);
    if (d.getDay() !== 0) return;
    let x = addDays(d, 1);
    while (m.has(ymd(x))) x = addDays(x, 1);
    m.set(ymd(x), '振替休日');
  });
  holidayCache.set(y, m);
  return m;
}

// ---------- 読み込み ----------
async function startLocal() {
  state.local = true; state.offGoogle = true;
  state.hidden = new Set(store.get('localHidden', [])); state.hiddenLists = new Set();
  state.calendars = applyCalColors(LOCAL_CALS.map((c) => ({ ...c })));
  try { await localOpen(); } catch (err) { console.warn(err); localDb = localEmpty(); localBroken = true; toast('保存データを読めませんでした'); }
  load();
  if (!localBroken) localNotifySync(false);
}
function loadLocal(s, e) {
  state.events = localBetween(s, e).filter((ev) => !state.hidden.has(ev.calId));
  state.taskLists = localDb.lists;
  state.tasks = localDb.tasks.filter((t) => !t.done && !state.hiddenLists.has(t.listId)).map((t) => ({
    id: t.id, listId: t.listId, listTitle: (localDb.lists.find((l) => l.id === t.listId) || {}).title, title: t.title, due: t.due ? parseYMD(t.due) : null,
  }));
  state.diary = new Map(Object.entries(localDb.memos).map(([k, v]) => {
    const d = parseYMD(k);
    return [k, { id: `memo${k}`, diary: true, description: v, title: `${MEMO_MARK} ${v.split('\n')[0].slice(0, 20)}`, start: d, end: addDays(d, 1), allDay: true, calId: 'me' }];
  }));
  const hol = new Map();
  for (let y = s.getFullYear(); y <= addDays(e, -1).getFullYear(); y++) jpHolidays(y).forEach((v, k) => hol.set(k, v));
  state.holidays = hol;
  render();
}
async function searchLocal(word) {
  const now = new Date(), w = word.toLowerCase();
  return localBetween(addDays(now, -730), addDays(now, 730)).filter((ev) => !state.hidden.has(ev.calId) && (ev.title + ev.location).toLowerCase().includes(w));
}

// ---------- 予定の書き込み ----------
function localRec(v, id, old) {
  const remind = localRemind(v, old);
  const notifications = v.notificationOverrides !== undefined ? validateNotifications(v.notificationOverrides) : v.remind === 'default' && old ? old.notifications : undefined;
  if (notifications === undefined && remind != null) validateNotifications([{ method: 'popup', minutes: remind }]);
  return {
    id, calId: v.calId, title: v.title, location: v.location || '', description: v.description != null ? v.description : (old && old.description) || '',
    date: ymd(v.date), allDay: !!v.allDay, start: v.start, end: v.end, endDays: v.endDays || 0, spanDays: v.spanDays || 1,
    recur: localRule(v.recur), ex: [], remind, notifications,
  };
}
// 通知は「予定の何分前か」で持つ。「前の日」は、Googleと同じ分数にする
function localRemind(v, old) {
  if (v.notificationOverrides !== undefined) return v.notificationOverrides[0]?.minutes ?? null;
  if (v.remind === 'default') return old && old.remind != null ? old.remind : null;
  if (v.remind === 'prevday') return v.allDay ? 15 * 60 : 24 * 60;
  return v.remind ? Number(v.remind) : null;
}
const insertLocal = (v) => localCommit((d) => { d.events.push(localRec(v, localId())); });
function updateLocal(ev, v, scope) {
  return localCommit((d) => {
    const i = d.events.findIndex((r) => r.id === ev.recId);
    if (i < 0) throw new Error('予定が見つかりませんでした');
    const rec = d.events[i];
    if (!rec.recur) { d.events[i] = { ...localRec({ ...v, recur: null }, rec.id, rec) }; return; }
    if (scope === 'this') {
      rec.ex.push(ev.occ);
      d.events.push(localRec({ ...v, recur: null }, localId(), rec));
      return;
    }
    const nextRule = v.recurChanged ? localRule(v.recur) : rec.recur;
    if (scope === 'following' && ev.occ !== rec.date) {
      let passed = 0;
      for (const x of localDates(rec)) { if (ymd(x) >= ev.occ) break; passed++; }
      const rule = { ...nextRule };
      if (!v.recurChanged && rec.recur.count) rule.count = rec.recur.count - passed;
      const fresh = localRec({ ...v, recur: rule }, localId(), rec);
      fresh.ex = rec.ex.filter((x) => x >= ev.occ);
      rec.ex = rec.ex.filter((x) => x < ev.occ);
      delete rec.recur.count;
      rec.recur.until = ymd(addDays(parseYMD(ev.occ), -1));
      d.events.push(fresh);
      return;
    }
    // すべての日：開始日はそのまま、時間と内容を変える
    let first = parseYMD(rec.date);
    if (v.recurChanged && nextRule.freq === 'WEEKLY' && nextRule.days) { while (!nextRule.days.includes(first.getDay())) first = addDays(first, 1); }
    if (v.recurChanged && nextRule.freq === 'WEEKDAYS') { while (first.getDay() % 6 === 0) first = addDays(first, 1); }
    const fresh = localRec({ ...v, date: first, recur: nextRule }, rec.id, rec);
    fresh.ex = rec.ex;
    d.events[i] = fresh;
  });
}
function deleteLocal(ev, scope) {
  return localCommit((d) => {
    const i = d.events.findIndex((r) => r.id === ev.recId);
    if (i < 0) throw new Error('予定が見つかりませんでした');
    const rec = d.events[i];
    if (!rec.recur || scope === 'all' || (scope === 'following' && ev.occ === rec.date)) { d.events.splice(i, 1); return; }
    if (scope === 'this') { rec.ex.push(ev.occ); return; }
    delete rec.recur.count;
    rec.recur.until = ymd(addDays(parseYMD(ev.occ), -1));
    rec.ex = rec.ex.filter((x) => x < ev.occ);
  });
}

// ---------- タスクとメモ ----------
const insertLocalTask = (v) => localCommit((d) => {
  d.tasks.push({ id: localId(), listId: v.listId || d.lists[0].id, title: v.title, due: v.noDue ? null : ymd(v.date), done: false });
});
const localTask = (d, t) => { const x = d.tasks.find((k) => k.id === t.id); if (!x) throw new Error('タスクが見つかりませんでした'); return x; };
const updateLocalTask = (t, v) => localCommit((d) => { Object.assign(localTask(d, t), { title: v.title, due: v.noDue ? null : ymd(v.date) }); });
const setLocalTaskDone = (t, done) => localCommit((d) => { localTask(d, t).done = done; });
const deleteLocalTask = (t) => localCommit((d) => { d.tasks = d.tasks.filter((x) => x.id !== t.id); });
const undeleteLocalTask = (t) => localCommit((d) => {
  d.tasks.push({ id: t.id, listId: t.listId, title: t.title, due: t.due ? ymd(t.due) : null, done: false });
});
const saveLocalMemo = (date, text) => localCommit((d) => { d.memos[ymd(date)] = text; });
const deleteLocalMemo = (date) => localCommit((d) => { delete d.memos[ymd(date)]; });

// ---------- 書き出しと読み込み ----------
async function exportLocal() {
  const name = `koe-backup-${ymd(new Date())}.json`;
  try { await KoeLocal.share({ name, text: JSON.stringify(localDb, null, 1) }); }
  catch (err) { if (err.code !== 'canceled') toast(err.message || '書き出せませんでした'); }
}
function importLocal(file) {
  const r = new FileReader();
  r.onerror = () => toast('ファイルを読めませんでした');
  r.onload = () => {
    let x;
    try { x = localClean(JSON.parse(r.result)); } catch (err) { console.warn(err); toast('Koeの書き出しファイルではないようです'); return; }
    openSheet(`
      <h2>読み込みますか？</h2>
      <p class="note" style="margin-top:0"><b>${esc(file.name)}</b><br>予定 ${x.events.length}件・タスク ${x.tasks.length}件・メモ ${Object.keys(x.memos).length}件</p>
      <div class="e-acts"><p class="confirm-q">今の内容は、これに置き換わります<br><small>今の内容：予定 ${localDb.events.length}件・タスク ${localDb.tasks.length}件・メモ ${Object.keys(localDb.memos).length}件</small></p>
        <button class="act danger-solid" id="li-ok">置き換える</button>
        <button class="act" id="li-no">やめる</button></div>`);
    $('#li-no').onclick = closeSheet;
    $('#li-ok').onclick = async () => {
      try {
        const undo = await localCommit((d) => { Object.assign(d, x); });
        closeSheet(); load();
        showUndo('読み込みました', async () => { await undo(); load(); });
      } catch (err) { handleError(err); }
    };
  };
  r.readAsText(file);
}
