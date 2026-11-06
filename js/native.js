// Koe：iOSアプリで動くときだけ使う部分。Web版では何もしない
'use strict';
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const KoeAuth = NATIVE ? window.Capacitor.registerPlugin('KoeAuth') : null;
const KoeSpeech = NATIVE ? window.Capacitor.registerPlugin('KoeSpeech') : null;
const KoeCalendar = NATIVE ? window.Capacitor.registerPlugin('KoeCalendar') : null;

// 声の聞き取り：iOSの音声認識を、Web版と同じ使い方で呼べるようにする
if (NATIVE) {
  window.SpeechRecognition = class {
    start() {
      this.ended = false;
      this.subs = [
        KoeSpeech.addListener('result', ({ text, isFinal }) => {
          if (this.onresult) this.onresult({ results: [Object.assign([{ transcript: text }], { isFinal })] });
        }),
        KoeSpeech.addListener('end', ({ error } = {}) => {
          if (error && this.onerror) this.onerror({ error });
          this.finish();
        }),
      ];
      KoeSpeech.start({ lang: this.lang, hints: speechHints() }).catch((err) => {
        if (this.onerror) this.onerror({ error: err.code || 'network' });
        this.finish();
      });
    }
    stop() { KoeSpeech.stop().catch(() => this.finish()); }
    abort() { this.onend = null; KoeSpeech.abort().catch(() => {}); this.finish(); }
    finish() {
      if (this.ended) return;
      this.ended = true;
      (this.subs || []).forEach((p) => Promise.resolve(p).then((s) => s.remove()));
      if (this.onend) this.onend();
    }
  };
}

// 辞書の言葉とよく使う予定名を、聞き取りのヒントとして渡す
function speechHints() {
  try {
    const dict = getDict().map((d) => d.to || d.value || '').filter(Boolean);
    const often = ['titles', 'locs'].flatMap((k) => Object.entries(getCorpus(k, true)).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t));
    return [...new Set([...dict, ...often])].filter((t) => [...t].length <= 20).slice(0, 100);
  } catch (err) { console.warn(err); return []; }
}

// 接続情報：期限が近ければ、裏で新しくもらう（同時に何度も頼まない）
let tokenRefresh = null;
function nativeRefresh() {
  if (!tokenRefresh) {
    tokenRefresh = KoeAuth.getToken({ clientId: cfgClientId() })
      .then((resp) => { saveToken(resp); return resp; })
      .finally(() => { tokenRefresh = null; });
  }
  return tokenRefresh;
}
async function ensureFreshToken() {
  if (!NATIVE) return;
  const saved = store.get('token', null);
  if (state.token && saved && saved.exp > Date.now()) return;
  try {
    await nativeRefresh();
  } catch (err) {
    if (err.code === 'revoked' || err.code === 'none') throw Object.assign(new Error('auth'), { auth: true });
    throw new Error('通信できませんでした');
  }
}

// 試作：Appleカレンダーの予定を、Koeの画面で見て、登録・変更・削除する
// この表示の間はGoogleと通信しない。アプリを閉じると、いつものGoogleの表示に戻る
const APPLE_KEY = 'koeAppleView';
const APPLE_KEEP = ['defCal', 'defList', 'memoCal']; // Googleのカレンダーを指す設定は、Appleの表示中に書き換えない
const isAppleView = () => { try { return NATIVE && sessionStorage.getItem(APPLE_KEY) === '1'; } catch { return false; } };

// 読み込みの途中の処理が残らないよう、切り替えは開き直して行う
async function enterAppleView() {
  try {
    const { status } = await KoeCalendar.request();
    if (status !== 'allowed') {
      openSheet(`<h2>Appleカレンダー</h2>
        <p class="note">カレンダーの利用が許可されていません。設定アプリのプライバシーから、Koeのカレンダーをオンにしてください。</p>
        <button class="act" id="ac-close">閉じる</button>`);
      $('#ac-close').onclick = closeSheet;
      return;
    }
    sessionStorage.setItem(APPLE_KEY, '1');
    location.reload();
  } catch (err) { console.warn(err); toast('Appleカレンダーを読めませんでした'); }
}
function leaveAppleView() {
  try { sessionStorage.removeItem(APPLE_KEY); } catch {}
  location.reload();
}

// 背景の色に合わせて、文字を白か黒にする
function textOn(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#1d1d1d' : '#fff';
}

async function startApple() {
  state.apple = true; state.offGoogle = true;
  state.hidden = new Set(); state.hiddenLists = new Set(); // Googleの表示の設定は使わず、書き換えもしない
  try {
    const { calendars } = await KoeCalendar.calendars();
    state.calendars = applyCalColors(calendars.map((c) => ({
      id: c.id, name: c.name, color: c.color, text: textOn(c.color), primary: !!c.isDefault, writable: !!c.writable,
      holiday: !c.writable && /祝日|holiday/i.test(c.name),
    })));
    await load();
  } catch (err) { console.warn(err); toast('Appleカレンダーを読めませんでした'); }
  // リマインダーの許可は、予定を出してから尋ねる（断っても予定は使える）
  try {
    const { status } = await KoeCalendar.requestReminders();
    state.appleTasks = status === 'allowed';
    if (state.appleTasks) await load();
  } catch (err) { console.warn(err); }
}

// Appleの予定を、Koeの予定の形にする（終日の終わりは、Googleと同じ「次の日の0時」にそろえる）
function mapAppleEvent(it, cal) {
  if (!cal) return null;
  const start = new Date(it.start);
  return {
    diary: false, id: `${it.id}|${it.start}`, calId: cal.id, title: it.title || '（タイトルなし）', location: it.location || '', description: it.notes || '',
    allDay: !!it.allDay,
    start: it.allDay ? startOfDay(start) : start,
    end: it.allDay ? addDays(startOfDay(new Date(Math.max(it.end - 1, it.start))), 1) : new Date(it.end),
    color: cal.color, text: cal.text, recurring: !!it.recurring, masterId: null, transparent: false,
    appleId: it.id, appleStart: it.start, alarms: it.alarms || [],
    locked: !!it.locked, // 出席者のいる予定は、相手に影響するのでKoeでは変えない
  };
}
async function fetchAppleEvents(s, e) {
  const { events } = await KoeCalendar.events({ from: s.getTime(), to: e.getTime() });
  return events.map((it) => mapAppleEvent(it, state.calendars.find((c) => c.id === it.calId))).filter(Boolean);
}

async function loadApple(id, s, e) {
  $('#view').classList.add('loading');
  try {
    const [list, rem] = await Promise.all([fetchAppleEvents(s, e), fetchAppleTasks()]);
    if (id !== state.reqId) return;
    const hol = new Map();
    list.forEach((ev) => { if (state.calendars.some((c) => c.id === ev.calId && c.holiday)) hol.set(ymd(ev.start), ev.title); });
    state.holidays = hol;
    const seen = new Set(); // 祝日のカレンダーが2つあっても、同じ祝日は1つだけ出す
    state.events = list.filter((ev) => {
      if (state.hidden.has(ev.calId)) return false;
      if (!state.calendars.some((c) => c.id === ev.calId && c.holiday)) return true;
      const key = `${ymd(ev.start)}|${ev.title}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    state.diary = new Map(); state.tasks = rem.tasks; state.taskLists = rem.lists;
    render();
  } catch (err) {
    if (id !== state.reqId) return;
    console.warn(err);
    toast('Appleカレンダーを読めませんでした');
  } finally {
    if (id === state.reqId) $('#view').classList.remove('loading');
  }
}

async function searchApple(word) {
  const now = new Date(), w = word.toLowerCase();
  const list = await fetchAppleEvents(addDays(now, -700), addDays(now, 700));
  const cal = (ev) => state.calendars.find((c) => c.id === ev.calId);
  return list.filter((ev) => !state.hidden.has(ev.calId) && !cal(ev).holiday && (ev.title + ev.location).toLowerCase().includes(w));
}

// 繰り返しの内容を、Appleに渡す形にする
function appleRecur(r, date) {
  if (!r) return undefined;
  const out = { freq: r.freq, interval: Number(r.interval) || 1 };
  if (r.days) out.days = [...r.days];
  if (r.count) out.count = Number(r.count);
  else if (r.until) { const u = new Date(r.until); u.setHours(23, 59, 59, 0); out.until = u.getTime(); }
  if (r.freq === 'MONTHLY') {
    if (r.monthMode === 'end') out.monthEnd = true;
    if (r.monthMode === 'nth' || r.monthMode === 'last') { out.nth = r.monthMode === 'last' ? -1 : Math.ceil(date.getDate() / 7); out.weekday = date.getDay(); }
  }
  return out;
}
function appleAlarms(body) {
  const r = body.reminders;
  return r ? r.overrides.map((o) => o.minutes) : undefined; // 変えないときは送らない
}
function appleFail(err) { throw new Error(err && err.message ? err.message : '保存できませんでした'); }

async function insertApple(v, body, startDate, endDate) {
  const { id } = await KoeCalendar.save({
    calId: v.calId, title: v.title, location: v.location || '', notes: v.description || '', allDay: !!v.allDay,
    start: startDate.getTime(), end: endDate.getTime(), alarms: appleAlarms(body) || [], recur: appleRecur(v.recur, v.date),
  }).catch(appleFail);
  return () => KoeCalendar.remove({ id, occurrence: startDate.getTime(), scope: 'all' });
}
async function updateApple(ev, v, body, startDate, endDate, scope) {
  await KoeCalendar.save({
    id: ev.appleId, occurrence: ev.appleStart, scope, calId: v.calId, title: v.title, location: v.location || '', allDay: !!v.allDay,
    start: startDate.getTime(), end: endDate.getTime(), alarms: appleAlarms(body),
  }).catch(appleFail);
}
// 繰り返しでない予定だけ、元に戻せる（同じ内容で作り直す）
async function deleteApple(ev, scope) {
  await KoeCalendar.remove({ id: ev.appleId, occurrence: ev.appleStart, scope }).catch(appleFail);
  if (ev.recurring) return null;
  return () => KoeCalendar.save({
    calId: ev.calId, title: ev.title, location: ev.location, notes: ev.description, allDay: ev.allDay,
    start: ev.start.getTime(), end: ev.end.getTime(), alarms: ev.alarms,
  });
}

// リマインダーを、Koeのタスクの形にする
async function fetchAppleTasks() {
  if (!state.appleTasks) return { tasks: [], lists: [] };
  const { lists, reminders } = await KoeCalendar.reminders();
  const ls = lists.filter((l) => l.writable).sort((a, b) => b.isDefault - a.isDefault).map((l) => ({ id: l.id, title: l.title }));
  const tasks = reminders.filter((r) => r.title && !state.hiddenLists.has(r.listId) && ls.some((l) => l.id === r.listId)).map((r) => ({
    id: r.id, listId: r.listId, listTitle: ls.find((l) => l.id === r.listId).title, title: r.title, notes: r.notes,
    due: r.due ? parseYMD(r.due) : null,
  }));
  return { tasks, lists: ls };
}
async function insertAppleTask(v) {
  const listId = v.listId || (state.taskLists[0] && state.taskLists[0].id);
  if (!listId) throw new Error('リマインダーのリストがありません');
  const { id } = await KoeCalendar.saveReminder({ listId, title: v.title, ...(v.noDue ? {} : { due: ymd(v.date) }) }).catch(appleFail);
  return () => KoeCalendar.removeReminder({ id });
}
async function updateAppleTask(t, v) {
  await KoeCalendar.saveReminder({ id: t.id, title: v.title, ...(v.noDue ? { noDue: true } : { due: ymd(v.date) }) }).catch(appleFail);
}
async function setAppleTaskDone(t, done) {
  await KoeCalendar.saveReminder({ id: t.id, done }).catch(appleFail);
}
async function deleteAppleTask(t) {
  await KoeCalendar.removeReminder({ id: t.id }).catch(appleFail);


}
// 作り直すと識別子が変わるので、もう一度消すときは読み直した一覧を使う
async function undeleteAppleTask(t) {
  const { id } = await KoeCalendar.saveReminder({ listId: t.listId, title: t.title, notes: t.notes || '', ...(t.due ? { due: ymd(t.due) } : {}) }).catch(appleFail);
  return id;
}
