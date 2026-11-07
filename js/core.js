// Koe：アプリ全体で使う入れ物、設定、日付の道具
'use strict';
const APP_VERSION = '202611071907'; // index.html の ?v= と合わせる（iPhoneに古い版が残らないように）
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/tasks';
const API = 'https://www.googleapis.com/calendar/v3';
const WD = ['日', '月', '火', '水', '木', '金', '土'];
let HOUR = 60; // 1時間の高さ。設定で変えられる（applyThemeで反映）

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// 設定（この端末に保存）
const cfg = (k, d) => store.get(`cfg.${k}`, d);
const setCfg = (k, v) => { store.set(`cfg.${k}`, v); touchSync(); };
const pOpts = (o) => ({ weekStart: cfg('weekStart', 0), ...o });
const CAL_COLORS = ['#d9534f', '#e8833a', '#d4a72c', '#4b9e5f', '#2a9d8f', '#3b7ddd', '#6a5acd', '#c0628a', '#7a6a58'];
function applyCalColors(cals) {
  const colors = cfg('calColors', {});
  cals.forEach((c) => { c.baseColor = c.baseColor || c.color; c.color = colors[c.id] || c.baseColor; });
  return cals;
}

// 広い画面（パソコンなど）かどうか
const WIDE = matchMedia('(min-width:900px)');
// マウスで操作しているか
const MOUSE = matchMedia('(hover:hover) and (pointer:fine)');
// 右のタスク欄を出しているか（広い画面だけ。オン・オフは端末ごとに覚える）
const sideTasks = () => WIDE.matches && store.get('tasksSide', true);

const state = {
  view: cfg('startView', 'last') === 'last' ? store.get('view', 'week') : cfg('startView', 'last'),
  anchor: startOfDay(new Date()),
  demo: false,
  token: null,
  calendars: [],
  hidden: new Set(store.get('hiddenCals', null) || []),
  hiddenSaved: store.get('hiddenCals', null) !== null,
  hiddenLists: new Set(store.get('hiddenLists', null) || []), // 表示しないToDoリスト
  events: [],
  tasks: [],
  tasksOk: false, // ToDoリストの許可をもらっているか
  taskLists: [],  // 表示するToDoリスト
  holidays: new Map(), // 日付 → 祝日名
  diary: new Map(), // 日付 → メモ
  authLost: false, // 接続が切れた（保存済みの予定を表示中）
  stale: null,     // 電波がなく、いつの予定を表示しているか
  scrollTop: null,
  reqId: 0,
};

// ---------- 日付の道具 ----------
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function hm(d) { return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }
function md(d) { return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`; }
function parseYMD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

function range(view = state.view, a = state.anchor) {
  if (view === 'today') { const t = startOfDay(new Date()); return [t, addDays(t, 2)]; } // 今日と明日
  if (view === 'day') return [a, addDays(a, 1)];
  const ws = cfg('weekStart', 0); // 0=日曜 1=月曜
  if (view === 'week') { const s = addDays(a, -((a.getDay() - ws + 7) % 7)); return [s, addDays(s, 7)]; }
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const s = addDays(first, -((first.getDay() - ws + 7) % 7));
  return [s, addDays(s, 42)];
}
