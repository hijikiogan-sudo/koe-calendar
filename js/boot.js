// Koe：ログイン、操作、起動（最後に読み込む）
'use strict';
// ---------- ログイン ----------
let tokenClient = null;
const cfgClientId = () => (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_CLIENT_ID || '').trim();

window.onGsiLoaded = () => {
  if (!cfgClientId() || !window.google) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: cfgClientId(),
    scope: SCOPES,
    callback: async (resp) => {
      if (resp.error) { toast('ログインできませんでした'); return; }
      state.token = resp.access_token;
      state.tasksOk = /auth\/tasks/.test(resp.scope || '');
      state.authLost = false; state.stale = null;
      store.set('token', { v: resp.access_token, exp: Date.now() + (resp.expires_in - 60) * 1000, scope: resp.scope || '' });
      $('#login').hidden = true;
      await startGoogle();
    },
  });
  $('#btn-login').disabled = false;
};

function showLogin() { $('#login').hidden = false; }

async function startGoogle() {
  try {
    await fetchCalendars();
    await load();
    refreshCorpus(); // 候補用。裏で読み込む
    syncDict();
  } catch (err) {
    if (err && err.auth) { handleError(err); return; }
    // 電波がないときは、保存済みのカレンダーと予定で表示する
    state.calendars = store.get('calCache', []);
    if (!loadCached()) toast('読み込めませんでした。通信を確認してください');
  }
}

function startDemo() {
  state.demo = true;
  state.calendars = applyCalColors(DEMO_CALS);
  $('#login').hidden = true;
  load();
}

function logout() {
  if (state.token && window.google) google.accounts.oauth2.revoke(state.token, () => {});
  ['token', 'corpus', 'evCache', 'taskCache', 'calCache'].forEach((k) => store.del(k)); corpus = null;
  state.token = null; state.events = []; state.tasks = []; state.calendars = []; state.authLost = false; state.stale = null;
  closeSheet(); render(); showLogin();
}

// 接続が切れても画面は閉じない。保存済みの予定を出して「再接続」を案内する
function connectionLost() {
  store.del('token'); state.token = null; state.authLost = true;
  if (!state.calendars.length) state.calendars = store.get('calCache', []);
  if (!state.calendars.length) { showLogin(); return; }
  if ($('#sheet').hidden) loadCached(); else renderConn(); // 入力中の画面は残す
  toast('接続が切れました。「再接続」を押してください');
}

function handleError(err) {
  if (err && err.auth) { connectionLost(); return; }
  console.error(err);
  toast(err && err.message ? err.message : '読み込みに失敗しました');
}

// ---------- 操作 ----------
function setView(v) { state.view = v; store.set('view', v); state.scrollTop = null; load(); }
function shift(dir) {
  if (state.view === 'today') { state.anchor = addDays(startOfDay(new Date()), dir); setView('day'); return; }
  const a = state.anchor;
  if (state.view === 'day') state.anchor = addDays(a, dir);
  else if (state.view === 'week') state.anchor = addDays(a, 7 * dir);
  else state.anchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  load();
}
function goToday() { state.anchor = startOfDay(new Date()); state.scrollTop = null; load(); }

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function el(tag, cls) { const x = document.createElement(tag); if (cls) x.className = cls; return x; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function bind() {
  document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $('#btn-prev').onclick = () => shift(-1);
  $('#btn-next').onclick = () => shift(1);
  $('#btn-today').onclick = goToday;
  $('#title').onclick = goToday;
  $('#btn-menu').onclick = openMenu;
  $('#btn-search').onclick = () => openSearch();
  $('#sheet-bg').onclick = () => { closeVoice(); closeSheet(); };
  $('#btn-login').onclick = () => tokenClient && tokenClient.requestAccessToken({ prompt: '' });
  $('#btn-demo').onclick = startDemo;
  $('#btn-mic').onclick = () => startVoice();
  $('#v-mic').onclick = () => { if (voice.rec) voice.rec.stop(); else listen(); };
  $('#v-kb').onclick = () => {
    const slot = voice.slot; closeVoice();
    if (slot) useTextForSlot(slot); else $('#intext').focus();
  };
  $('#inbar').onsubmit = (e) => {
    e.preventDefault();
    const text = $('#intext').value.trim();
    if (!text) { $('#intext').focus(); return; }
    $('#intext').blur();
    const slot = pendingSlot; clearSlot();
    openConfirm(text, slot);
  };
  $('#intext').addEventListener('blur', () => { if (pendingSlot && !$('#intext').value.trim()) setTimeout(clearSlot, 200); });

  // 左右スワイプで前後へ
  let sx = 0, sy = 0, st = 0;
  const v = $('#view');
  v.addEventListener('touchstart', (e) => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; st = Date.now(); }, { passive: true });
  v.addEventListener('touchend', (e) => {
    const p = e.changedTouches[0]; const dx = p.clientX - sx, dy = p.clientY - sy;
    if (Date.now() - st < 600 && Math.abs(dx) > 60 && Math.abs(dy) < 50) shift(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---------- 開きっぱなしから戻ってきたとき ----------
let lastActive = Date.now(), lastDay = ymd(new Date());
function onResume() {
  const busy = !$('#sheet').hidden || !$('#voice').hidden || document.activeElement === $('#intext');
  if (ymd(new Date()) !== lastDay) { // 日付が変わっていたら「今日」も動かす
    if (state.anchor && ymd(state.anchor) === lastDay && !busy) { state.anchor = startOfDay(new Date()); state.scrollTop = null; }
    lastDay = ymd(new Date());
  } else if (Date.now() - lastActive < 60000) return;
  lastActive = Date.now();
  if (busy) return; // 入力中は邪魔しない
  checkNewVersion();
  const saved = store.get('token', null);
  if (state.token && saved && saved.exp <= Date.now()) { connectionLost(); return; }
  load();
  refreshCorpus();
  syncDict();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onResume(); else lastActive = Date.now(); });
window.addEventListener('online', () => { if (state.token) load(); });
window.addEventListener('offline', () => renderConn());

// ---------- 起動 ----------
if ('serviceWorker' in navigator && !location.pathname.includes('_t')) navigator.serviceWorker.register('sw.js').catch((err) => console.warn(err));
checkNewVersion();
applyTheme();
bind();
render();
const forceDemo = new URLSearchParams(location.search).has('demo');
if (forceDemo || !cfgClientId()) {
  startDemo();
} else {
  const saved = store.get('token', null);
  const calCache = store.get('calCache', []);
  if (saved && saved.exp > Date.now()) { state.token = saved.v; state.tasksOk = /auth\/tasks/.test(saved.scope || ''); startGoogle(); }
  else if (calCache.length) { state.calendars = applyCalColors(calCache); state.authLost = true; loadCached(); } // 切れていても前回の予定は見せる
  else showLogin();
}
