// Koe（コエ）：話すだけで予定とタスクが入る手帳。Googleカレンダー／ToDoリスト連動
(() => {
  'use strict';

  const APP_VERSION = '202611051451'; // index.html の ?v= と合わせる（iPhoneに古い版が残らないように）
  const SCOPES = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks';
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

  const state = {
    view: cfg('startView', 'last') === 'last' ? store.get('view', 'week') : cfg('startView', 'last'),
    anchor: startOfDay(new Date()),
    demo: false,
    token: null,
    calendars: [],
    hidden: new Set(store.get('hiddenCals', null) || []),
    hiddenSaved: store.get('hiddenCals', null) !== null,
    events: [],
    tasks: [],
    tasksOk: false, // ToDoリストの許可をもらっているか
    taskLists: [],  // 表示するToDoリスト
    holidays: new Map(), // 日付 → 祝日名
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

  // ---------- 表示 ----------
  function render() {
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    closeDayPop();
    $('#title').innerHTML = titleHTML();
    $('#demo-banner').hidden = !state.demo;
    renderConn();
    const v = $('#view');
    const keepScroll = v.querySelector('.tg-scroll[data-init]');
    if (keepScroll) state.scrollTop = keepScroll.scrollTop;
    v.innerHTML = '';
    renderTasks();
    if (state.view === 'month') { v.appendChild(renderMonth()); return; }
    if (state.view === 'today') { v.appendChild(renderToday()); return; }
    if (state.view === 'week' && cfg('weekStyle', 'grid') === 'list') { v.appendChild(renderWeekList()); return; }
    const n = state.view === 'day' ? 1 : 7;
    v.appendChild(renderTimeGrid(n));
    // 時間軸のスクロール位置：前の位置を保つ。初回は今の時刻（今日を含まなければ8時）付近
    const scroll = v.querySelector('.tg-scroll');
    if (state.scrollTop != null) scroll.scrollTop = state.scrollTop;
    else {
      const [s] = range(); const today = startOfDay(new Date());
      const showsToday = Array.from({ length: n }, (_, i) => addDays(s, i)).some((d) => sameDay(d, today));
      const sh = cfg('startHour', 'now');
      scroll.scrollTop = (sh !== 'now' ? Number(sh) : showsToday ? Math.max(new Date().getHours() - 2, 0) : 8) * HOUR;
    }
    scroll.dataset.init = '1';
  }

  // 見出し：月を大きく、年は小さく添える
  function titleHTML() {
    const a = state.anchor;
    if (state.view === 'today') { const t = new Date(); return `今日<small>${t.getMonth() + 1}/${t.getDate()}（${WD[t.getDay()]}）</small>`; }
    if (state.view === 'day') return `${a.getMonth() + 1}月${a.getDate()}日`;
    if (state.view === 'week') {
      const [s, e] = range(); const last = addDays(e, -1);
      if (s.getMonth() === last.getMonth()) return `${s.getMonth() + 1}月<small>${s.getFullYear()}</small>`;
      return `${s.getMonth() + 1}–${last.getMonth() + 1}月<small>${last.getFullYear()}</small>`;
    }
    return `${a.getMonth() + 1}月<small>${a.getFullYear()}</small>`;
  }

  function eventsOn(day) {
    const s = day, e = addDays(day, 1);
    return state.events.filter((ev) => ev.start < e && ev.end > s);
  }

  function renderTimeGrid(n) {
    const [s] = range();
    const days = Array.from({ length: n }, (_, i) => addDays(s, i));
    const today = startOfDay(new Date());
    const root = el('div', 'tg' + (n > 1 ? ' narrow' : ''));
    root.style.setProperty('--n', n);

    // 日付の見出し
    const head = el('div', 'tg-row tg-head');
    head.appendChild(n > 1 ? weekToggle() : el('div'));
    days.forEach((d) => {
      const h = el('button', 'dh' + (sameDay(d, today) ? ' today' : '') + (d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '') + (state.holidays.has(ymd(d)) ? ' holiday' : ''));
      h.innerHTML = `${WD[d.getDay()]}<b>${d.getDate()}</b>`;
      h.onclick = () => { state.anchor = d; setView('day'); };
      head.appendChild(h);
    });
    root.appendChild(head);

    // 終日の予定
    const allday = el('div', 'tg-row tg-allday');
    allday.appendChild(Object.assign(el('div', 'lbl'), { textContent: '終日' }));
    days.forEach((d) => {
      const cell = el('div', 'ad-cell');
      eventsOn(d).filter((e) => e.allDay).forEach((ev) => {
        const c = el('button', 'chip');
        c.style.setProperty('--c', ev.color); c.textContent = ev.title;
        c.onclick = () => openEvent(ev);
        cell.appendChild(c);
      });
      allday.appendChild(cell);
    });
    root.appendChild(allday);

    // 時間軸
    const scroll = el('div', 'tg-scroll');
    const body = el('div', 'tg-row tg-body');
    const hours = el('div', 'hours');
    for (let h = 1; h < 24; h++) {
      const l = el('div', 'hl'); l.style.top = `${h * HOUR}px`; l.textContent = `${h}:00`; hours.appendChild(l);
    }
    body.appendChild(hours);
    days.forEach((d) => {
      const col = el('div', 'dcol' + (sameDay(d, today) ? ' today' : ''));
      const dEnd = addDays(d, 1);
      const timed = eventsOn(d).filter((e) => !e.allDay).map((ev) => ({
        ev, s: Math.max(ev.start, d), e: Math.min(ev.end, dEnd),
      }));
      layoutColumns(timed);
      timed.forEach((t) => {
        const top = (t.s - d) / 3600000 * HOUR;
        const h = Math.max((t.e - t.s) / 3600000 * HOUR, 20);
        const b = el('div', 'ev');
        b.setAttribute('role', 'button');
        // 週表示は重なった予定を少しずつずらして重ねる（半分に割ると細すぎて読めない）。日表示は横に並べる
        const left = n > 1 ? t.col * (t.cols > 2 ? 18 : 28) : t.col / t.cols * 100;
        const width = n > 1 ? 100 - left : 100 / t.cols;
        b.style.cssText = `top:${top}px;height:${h - 1}px;left:${left}%;width:calc(${width}% - 2px);z-index:${t.col + 1};--c:${t.ev.color}`;
        // 名前は上に出し、長い予定をスクロールしても見えたままにする
        b.innerHTML = `<div class="ev-in">${n === 1 && h >= 36 ? `<div class="t">${hm(t.ev.start)}〜${hm(t.ev.end)}</div>` : ''}<div class="ev-title">${esc(t.ev.title)}</div>${t.ev.location && h >= 56 ? `<div class="p">${esc(t.ev.location)}</div>` : ''}</div>`;
        b.onclick = () => { if (b.dataset.dragged) { delete b.dataset.dragged; return; } openEvent(t.ev); };
        attachEventDrag(b, t.ev, root);
        col.appendChild(b);
      });
      if (sameDay(d, today)) {
        const now = new Date();
        const line = el('div', 'now');
        line.style.top = `${(now - d) / 3600000 * HOUR}px`;
        col.appendChild(line);
      }
      // 空いている時間を長押し → その日時で声入力（30分単位）
      attachLongPress(col, (pt) => {
        const y = pt.y - col.getBoundingClientRect().top;
        const start = Math.min(Math.max(Math.floor(y / HOUR * 2) / 2, 0), 23.5) * 60;
        startSlot({ date: d, start }, col, start / 60 * HOUR);
      });
      body.appendChild(col);
    });
    scroll.appendChild(body);
    root.appendChild(scroll);
    return root;
  }

  // 週の「時間軸／一覧」を切り替えるボタン
  function weekToggle() {
    const list = cfg('weekStyle', 'grid') === 'list';
    const b = el('button', 'week-toggle');
    b.setAttribute('aria-label', list ? '時間軸で見る' : '一覧で見る');
    b.innerHTML = list ? '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/></svg><span>時間</span>' : '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h14"/></svg><span>一覧</span>';
    b.onclick = () => { setCfg('weekStyle', list ? 'grid' : 'list'); state.scrollTop = null; render(); };
    return b;
  }

  // 週の一覧表示：1日1行で予定名を全部読める
  // 今日の画面：今の予定と次の予定、今日のタスク、明日の予定
  function renderToday() {
    const now = new Date(), today = startOfDay(now), tomorrow = addDays(today, 1);
    const root = el('div', 'td');
    const byTime = (a, b) => (b.allDay - a.allDay) || (a.start - b.start);
    const list = (d) => eventsOn(d).sort(byTime);
    const evRow = (ev, d) => {
      const it = el('button', 'wl-ev' + (!ev.allDay && ev.end <= now && sameDay(d, today) ? ' past' : '') + (!ev.allDay && ev.start <= now && ev.end > now && sameDay(d, today) ? ' now' : ''));
      it.style.setProperty('--c', ev.color);
      it.innerHTML = `<span class="wl-time">${ev.allDay ? '終日' : sameDay(ev.start, d) ? hm(ev.start) : '続き'}</span><span class="wl-title">${esc(ev.title)}${ev.location ? `<small>${esc(ev.location)}</small>` : ''}</span>`;
      it.onclick = () => openEvent(ev);
      return it;
    };
    const taskRow = (t) => {
      const late = t.due && t.due < today;
      const li = el('div', 'td-task' + (t.parent ? ' sub' : ''));
      li.innerHTML = `<button class="tk-box" aria-label="完了にする"></button><button class="tk-title">${esc(t.title)}</button><span class="tk-due${late ? ' late' : ''}">${t.due ? (late ? `${t.due.getMonth() + 1}/${t.due.getDate()} 期限切れ` : '今日まで') : ''}</span>`;
      li.querySelector('.tk-title').onclick = () => openTask(t);
      li.querySelector('.tk-box').onclick = () => { li.classList.add('done'); doComplete(t); };
      return li;
    };
    const section = (title, nodes, empty) => {
      const sec = el('section', 'td-sec');
      sec.appendChild(Object.assign(el('h3'), { textContent: title }));
      if (nodes.length) nodes.forEach((n) => sec.appendChild(n));
      else sec.appendChild(Object.assign(el('p', 'td-empty'), { textContent: empty }));
      root.appendChild(sec);
    };
    // 次の予定
    const todays = list(today);
    const cur = todays.find((e) => !e.allDay && e.start <= now && e.end > now);
    const next = todays.find((e) => !e.allDay && e.start > now);
    if (cur || next) {
      const box = el('div', 'td-next');
      const mins = next ? Math.round((next.start - now) / 60000) : 0;
      const left = mins >= 60 ? `${Math.floor(mins / 60)}時間${mins % 60 ? `${mins % 60}分` : ''}` : `${mins}分`;
      box.innerHTML = `${cur ? `<div><b>今</b> ${esc(cur.title)}（${hm(cur.end)}まで）</div>` : ''}${next ? `<div><b>次</b> ${hm(next.start)} ${esc(next.title)}（あと${left}）</div>` : ''}`;
      root.appendChild(box);
    }
    const hol = state.holidays.get(ymd(today));
    section(hol && !todays.some((e) => e.title === hol) ? `今日の予定（${hol}）` : '今日の予定', todays.map((e) => evRow(e, today)), '予定はありません');
    const tks = visibleTasks().filter((t) => !t.due || t.due < tomorrow);
    section('タスク', tks.map(taskRow), 'タスクはありません');
    const tomorrowTasks = state.tasks.filter((t) => t.due && sameDay(t.due, tomorrow));
    const tmr = [...list(tomorrow).map((e) => evRow(e, tomorrow)), ...tomorrowTasks.map((t) => {
      const it = el('button', 'wl-ev wl-task');
      it.innerHTML = `<span class="wl-time">タスク</span><span class="wl-title">☐ ${esc(t.title)}</span>`;
      it.onclick = () => openTask(t);
      return it;
    })];
    section(`明日（${md(tomorrow)}）`, tmr, '予定はありません');
    return root;
  }

  function renderWeekList() {
    const [s] = range();
    const today = startOfDay(new Date());
    const root = el('div', 'wl');
    const bar = el('div', 'wl-bar');
    bar.appendChild(weekToggle());
    root.appendChild(bar);
    const body = el('div', 'wl-body');
    let todayRow = null;
    for (let i = 0; i < 7; i++) {
      const d = addDays(s, i);
      const hol = state.holidays.get(ymd(d));
      const row = el('div', 'wl-row' + (sameDay(d, today) ? ' today' : '') + (d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '') + (hol ? ' holiday' : ''));
      if (sameDay(d, today)) todayRow = row;
      const dayBtn = el('button', 'wl-day');
      dayBtn.innerHTML = `<b>${d.getDate()}</b><span>${WD[d.getDay()]}</span>`;
      dayBtn.onclick = () => { state.anchor = d; setView('day'); };
      row.appendChild(dayBtn);
      const items = el('div', 'wl-items');
      const evs = eventsOn(d).sort((a, b2) => (b2.allDay - a.allDay) || (a.start - b2.start));
      if (hol && !evs.some((ev) => ev.title === hol)) items.appendChild(Object.assign(el('div', 'wl-hol'), { textContent: hol })); // 祝日を非表示にしていても名前は出す
      evs.forEach((ev) => {
        const it = el('button', 'wl-ev');
        it.style.setProperty('--c', ev.color);
        const time = ev.allDay ? '終日' : sameDay(ev.start, d) ? hm(ev.start) : '続き';
        it.innerHTML = `<span class="wl-time">${time}</span><span class="wl-title">${esc(ev.title)}${ev.location ? `<small>${esc(ev.location)}</small>` : ''}</span>`;
        it.onclick = () => openEvent(ev);
        items.appendChild(it);
      });
      state.tasks.filter((t) => t.due && sameDay(t.due, d)).forEach((t) => {
        const it = el('button', 'wl-ev wl-task');
        it.innerHTML = `<span class="wl-time">タスク</span><span class="wl-title">☐ ${esc(t.title)}</span>`;
        it.onclick = () => openTask(t);
        items.appendChild(it);
      });
      if (!evs.length && !hol) items.appendChild(el('div', 'wl-empty'));
      row.appendChild(items);
      attachLongPress(row, () => startSlot({ date: d, start: null }, null));
      body.appendChild(row);
    }
    root.appendChild(body);
    if (todayRow) requestAnimationFrame(() => { body.scrollTop = todayRow.offsetTop; });
    return root;
  }

  // 予定を長押しして、別の時間や別の日へ動かす（離すと確認画面が出る。勝手には変えない）
  function attachEventDrag(b, ev, root) {
    const cal = state.calendars.find((c) => c.id === ev.calId);
    const oneDay = sameDay(ev.start, new Date(ev.end.getTime() - 1));
    if (!cal || !cal.writable || !oneDay) return;
    const dur = Math.round((ev.end - ev.start) / 60000);
    let timer = null, drag = null, sx = 0, sy = 0, grab = 0, autoT = null, lastPt = null;
    const scroller = () => root.querySelector('.tg-scroll');
    const cols = () => [...root.querySelectorAll('.dcol')];
    const place = (pt) => {
      lastPt = pt;
      const cs = cols();
      const col = cs.find((c) => { const r = c.getBoundingClientRect(); return pt.x >= r.left && pt.x < r.right; }) || (pt.x < cs[0].getBoundingClientRect().left ? cs[0] : cs[cs.length - 1]);
      const y = pt.y - col.getBoundingClientRect().top - grab;
      const start = Math.min(Math.max(Math.round(y / HOUR * 4) * 15, 0), 1440 - Math.min(dur, 1440));
      drag.col = col; drag.start = start;
      if (drag.ghost.parentElement !== col) col.appendChild(drag.ghost);
      drag.ghost.style.top = `${start / 60 * HOUR}px`;
      drag.label.textContent = `${minToHM(start)}〜${minToHM(start + dur)}`;
    };
    const autoScroll = () => { // 上下の端に近づいたらスクロールする
      if (!drag) return;
      const sc = scroller(), r = sc.getBoundingClientRect();
      if (lastPt.y < r.top + 36) sc.scrollTop -= 8; else if (lastPt.y > r.bottom - 36) sc.scrollTop += 8;
      place(lastPt);
      autoT = requestAnimationFrame(autoScroll);
    };
    const begin = (pt) => {
      timer = null;
      if (navigator.vibrate) navigator.vibrate(15);
      const r = b.getBoundingClientRect();
      grab = Math.min(Math.max(sy - r.top, 0), r.height);
      const ghost = el('div', 'ev ev-ghost');
      ghost.style.cssText = `height:${b.offsetHeight}px;left:0;width:calc(100% - 2px);--c:${ev.color}`;
      const label = el('div', 't'); ghost.appendChild(label);
      ghost.appendChild(Object.assign(el('div', 'ev-title'), { textContent: ev.title }));
      drag = { ghost, label, col: null, start: 0 };
      b.classList.add('dragging');
      document.body.classList.add('is-dragging');
      place(pt);
      autoT = requestAnimationFrame(autoScroll);
    };
    const finish = (cancelled) => {
      clearTimeout(timer); timer = null;
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('mousemove', onMouseMove);
      if (!drag) return;
      cancelAnimationFrame(autoT);
      const { col, start, ghost } = drag;
      ghost.remove(); drag = null;
      b.classList.remove('dragging'); document.body.classList.remove('is-dragging');
      b.dataset.dragged = '1';
      setTimeout(() => { delete b.dataset.dragged; }, 400);
      if (cancelled) return;
      const days = cols();
      const [s0] = range();
      const date = addDays(s0, days.indexOf(col));
      const same = sameDay(date, ev.start) && start === ev.start.getHours() * 60 + ev.start.getMinutes();
      if (same) return;
      openEdit(ev, '', 'this', { date, start, dur });
    };
    const onTouchMove = (e) => {
      const t = e.touches[0];
      if (timer) { if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) finish(true); return; }
      if (drag) { e.preventDefault(); place({ x: t.clientX, y: t.clientY }); }
    };
    const onMouseMove = (e) => {
      if (timer) { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) finish(true); return; }
      if (drag) place({ x: e.clientX, y: e.clientY });
    };
    b.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      timer = setTimeout(() => begin({ x: sx, y: sy }), 450);
    }, { passive: true });
    b.addEventListener('touchend', () => finish(false));
    b.addEventListener('touchcancel', () => finish(true));
    b.addEventListener('mousedown', (e) => {
      if (e.button) return;
      sx = e.clientX; sy = e.clientY;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', () => finish(false), { once: true });
      timer = setTimeout(() => begin({ x: sx, y: sy }), 450);
    });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 重なった予定を横に並べる
  function layoutColumns(items) {
    items.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
    let group = [], cols = [], groupEnd = -Infinity;
    const close = () => { group.forEach((g) => (g.cols = cols.length)); group = []; cols = []; };
    items.forEach((it) => {
      if (it.s >= groupEnd) { close(); groupEnd = -Infinity; }
      let c = cols.findIndex((end) => end <= it.s);
      if (c === -1) { c = cols.length; cols.push(it.e); } else cols[c] = it.e;
      it.col = c; group.push(it); groupEnd = Math.max(groupEnd, it.e);
    });
    close();
  }

  function renderMonth() {
    const [s] = range();
    const today = startOfDay(new Date());
    const m = state.anchor.getMonth();
    const root = el('div', 'mg');
    const head = el('div', 'mg-head');
    for (let i = 0; i < 7; i++) {
      const dow = (i + cfg('weekStart', 0)) % 7;
      head.appendChild(Object.assign(el('div', dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''), { textContent: WD[dow] }));
    }
    root.appendChild(head);
    const body = el('div', 'mg-body');
    for (let i = 0; i < 42; i++) {
      const d = addDays(s, i);
      const cell = el('button', 'mc' + (d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '') + (d.getMonth() !== m ? ' out' : '') + (sameDay(d, today) ? ' today' : '') + (state.holidays.has(ymd(d)) ? ' holiday' : ''));
      cell.appendChild(Object.assign(el('div', 'num'), { textContent: d.getDate() }));
      const evs = eventsOn(d).sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start))
        .concat(state.tasks.filter((t) => t.due && sameDay(t.due, d)).map((t) => ({ task: true, title: t.title })));
      const max = cfg('monthMax', 3);
      evs.slice(0, evs.length > max ? max - 1 : max).forEach((ev) => {
        const x = el('div', 'm-ev ' + (ev.task ? 'task' : ev.allDay ? 'allday' : 'timed'));
        if (!ev.task) { x.style.setProperty('--c', ev.color); x.style.setProperty('--ct', ev.text || '#fff'); }
        x.textContent = ev.title;
        cell.appendChild(x);
      });
      if (evs.length > max) cell.appendChild(Object.assign(el('div', 'more'), { textContent: `ほか${evs.length - (max - 1)}件` }));
      cell.onclick = () => openDayPop(d, cell); // その日の予定を吹き出しで出す
      attachLongPress(cell, () => startSlot({ date: d, start: null }, null)); // 月表示は日付だけ
      body.appendChild(cell);
    }
    root.appendChild(body);
    return root;
  }

  // ---------- 月表示：日付を押すとその日の予定を吹き出しで出す ----------
  const wareki = (d) => { try { return new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { era: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(d); } catch { return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; } };
  function closeDayPop() { document.querySelectorAll('.daypop, .daypop-bg').forEach((x) => x.remove()); document.querySelectorAll('.mc.picked').forEach((x) => x.classList.remove('picked')); }
  function openDayPop(d, cell) {
    closeDayPop();
    cell.classList.add('picked');
    const evs = eventsOn(d).sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
    const tks = state.tasks.filter((t) => t.due && sameDay(t.due, d));
    const bg = el('div', 'daypop-bg');
    const pop = el('div', 'daypop');
    pop.innerHTML = `
      <div class="dp-head"><button class="dp-close">閉じる</button><b>${wareki(d)}</b><span>${WD[d.getDay()]}曜日</span></div>
      <ul class="dp-list">${evs.map((ev, i) => `<li data-e="${i}"><span class="dp-time">${ev.allDay ? '終日' : hm(ev.start)}</span>
        <span class="dp-title" style="--c:${ev.color}">${esc(ev.title)}${ev.location ? `<small>${esc(ev.location)}</small>` : ''}</span></li>`).join('')}
        ${tks.map((t, i) => `<li data-t="${i}"><span class="dp-time">タスク</span><span class="dp-title dp-task">☐ ${esc(t.title)}</span></li>`).join('')}
        ${!evs.length && !tks.length ? '<li class="dp-empty">予定はありません</li>' : ''}</ul>
      <div class="dp-acts"><button class="dp-add">＋ この日に登録</button><button class="dp-day">1日表示で見る</button></div>`;
    $('#app').append(bg, pop);
    // 押したマスの下（入らなければ上）に出し、三角をマスに向ける
    const cr = cell.getBoundingClientRect(), ar = $('#app').getBoundingClientRect();
    const ph = pop.offsetHeight, below = cr.bottom + 10 + ph < window.innerHeight - 90;
    pop.style.top = `${(below ? cr.bottom + 10 : cr.top - 10 - ph) - ar.top}px`;
    pop.classList.add(below ? 'down' : 'up');
    pop.style.setProperty('--ax', `${cr.left + cr.width / 2 - ar.left - 12}px`);
    bg.onclick = closeDayPop;
    pop.querySelector('.dp-close').onclick = closeDayPop;
    pop.querySelectorAll('li[data-e]').forEach((li) => li.onclick = () => { closeDayPop(); openEvent(evs[Number(li.dataset.e)]); });
    pop.querySelectorAll('li[data-t]').forEach((li) => li.onclick = () => { closeDayPop(); openTask(tks[Number(li.dataset.t)]); });
    pop.querySelector('.dp-add').onclick = () => { closeDayPop(); startSlot({ date: d, start: null }, null); };
    pop.querySelector('.dp-day').onclick = () => { closeDayPop(); state.anchor = d; setView('day'); };
  }

  // ---------- 声の命令 ----------
  async function runCommand(cmd, text) {
    if (cmd.cmd === 'show') { state.anchor = startOfDay(cmd.date); state.scrollTop = null; setView(cmd.view); $('#intext').value = ''; return; }
    if (cmd.cmd === 'search') { $('#intext').value = ''; openSearch(cmd.word); return; }
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
    $('#intext').value = '';
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
    const canEdit = !!(cal && cal.writable);
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
        : '<p class="note">このカレンダーは見るだけで、変更や削除はできません。</p>'}`);
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
    const range = ev.recurring ? `<br><b>${SCOPE_LABEL[scope]}</b>を削除します` : '';
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
        showUndo(`削除しました：${ev.title}`, async () => { await undo(); load(); });
      } catch (err) { b.disabled = false; b.textContent = '削除する'; handleError(err); }
    };
  }

  // 同じ内容で別の予定を作る
  function openDuplicate(ev) {
    const v = eventToForm(ev);
    openForm(v, {
      heading: '複製して登録しますか？', busyLabel: '登録中…', fixedKind: true, keepRemind: true, allowRecur: true,
      onOk: async (out) => {
        const undo = await insertEvent({ ...out, description: ev.description });
        noteCorpus(out);
        showUndo(`複製しました：${out.title}`, async () => { await undo(); load(); });
      },
    });
  }

  // ---------- 新しい版の確認 ----------
  // ページ自体がキャッシュされて古い版が動き続けるのを防ぐ。新しい版があれば1回だけ開き直す
  async function checkNewVersion() {
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
    clearTimeout(dictPushTimer);
    dictPushTimer = setTimeout(() => pushDict().catch((err) => console.warn('設定の保存に失敗', err)), 800);
  }
  function syncedSettings() {
    const c = {};
    try { Object.keys(localStorage).filter((k) => k.startsWith('cfg.')).forEach((k) => { c[k.slice(4)] = store.get(k, null); }); } catch {}
    return { cfg: c, theme: store.get('theme', null), mode: store.get('mode', null), hidden: store.get('hiddenCals', null) };
  }
  function applySynced(r) {
    if (!r || !r.settings) return;
    const x = r.settings;
    Object.entries(x.cfg || {}).forEach(([k, v]) => store.set(`cfg.${k}`, v)); // ここでは保存し直さない
    if (x.theme) store.set('theme', x.theme);
    if (x.mode) store.set('mode', x.mode);
    if (x.hidden) { store.set('hiddenCals', x.hidden); state.hidden = new Set(x.hidden); state.hiddenSaved = true; }
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
        ${row('月の1マスの件数', sel('monthMax', 3, [[2, '2件'], [3, '3件'], [4, '4件'], [5, '5件']]))}`)}
      ${group('cal', 'カレンダーと色', cals)}
      ${group('input', '入力の標準', `
        ${wcals.length ? row('標準のカレンダー', sel('defCal', '', [['', '自動（自分用）'], ...wcals])) : ''}
        ${lists.length > 1 ? row('標準のToDoリスト', sel('defList', '', [['', '自動（先頭のリスト）'], ...lists])) : ''}
        ${row('標準の通知', sel('defRemind', '', REMINDS.map((r) => [r.v, r.label])))}
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
      ${group('sync', '同期とアカウント', `
        <p class="note" style="margin-top:0">${state.demo ? 'お試し表示中です。' : state.token ? 'Googleに接続中です。開いたときと、アプリに戻ったときに自動で更新します。' : 'Googleとの接続が切れています。'}</p>
        <p class="note" style="margin-top:4px">もしかしての候補：<span id="m-corpus"></span></p>
        <button class="act" id="m-corpus-reload" style="margin-top:6px">今すぐ更新</button>
        ${state.demo
          ? (cfgClientId() ? '<button class="act" id="m-login">Googleでログインする</button>' : '<p class="note">Googleとつなぐには config.js にクライアントIDを設定します（SETUP.md 参照）。</p>')
          : '<button class="act" id="m-logout">ログアウト</button>'}`)}
      <p class="note">Koe ・ 版 ${APP_VERSION}<br>辞書と設定は、Google ToDoの「Koe設定」リストでiPhoneとパソコンに共有します。</p>`);
    const sh = $('#sheet');
    sh.querySelectorAll('.mgroup').forEach((d) => d.addEventListener('toggle', () => { if (d.open) menuOpen.add(d.dataset.g); else menuOpen.delete(d.dataset.g); }));
    sh.querySelectorAll('select.cfg').forEach((x) => x.onchange = () => {
      const k = x.dataset.k;
      const v = ['weekStart', 'monthMax', 'hourH'].includes(k) ? Number(x.value) : x.value;
      setCfg(k, v);
      if (k === 'textSize' || k === 'hourH') applyTheme();
      if (['weekStart', 'monthMax', 'startHour', 'hourH', 'weekStyle'].includes(k)) { state.scrollTop = null; load(); }
    });
    sh.querySelectorAll('.swatches button').forEach((b) => b.onclick = () => {
      const id = b.parentElement.dataset.id, cur = cfg('calColors', {});
      if (b.dataset.c) cur[id] = b.dataset.c; else delete cur[id];
      setCfg('calColors', cur);
      applyCalColors(state.calendars);
      store.set('calCache', state.calendars);
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
    sh.querySelectorAll('.cal').forEach((b) => b.onclick = () => {
      const id = b.dataset.id;
      state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
      b.classList.toggle('on');
      store.set('hiddenCals', [...state.hidden]); touchSync();
      load();
    });
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
    const lo = $('#m-logout'); if (lo) lo.onclick = logout;
    const li = $('#m-login'); if (li) li.onclick = () => { closeSheet(); state.demo = false; showLogin(); };
  }

  // ---------- データ ----------
  async function load() {
    const id = ++state.reqId;
    const [s, e] = range();
    if (state.demo) {
      demoEvents().forEach((ev) => { const c = state.calendars.find((x) => x.id === ev.calId); if (c) ev.color = c.color; });
      state.events = demoEvents().filter((ev) => !state.hidden.has(ev.calId) && ev.start < e && ev.end > s);
      state.tasks = demoTaskList().slice();
      state.taskLists = DEMO_LISTS;
      state.holidays = new Map([[`${new Date().getFullYear()}-11-03`, '文化の日']]);
      render(); return;
    }
    if (!state.token) { loadCached(); return; } // 接続が切れている間は保存済みを表示
    $('#view').classList.add('loading');
    try {
      const holidayCals = state.calendars.filter(isHolidayCal);
      const targets = state.calendars.filter((c) => !state.hidden.has(c.id) || isHolidayCal(c));
      const tasksP = state.tasksOk ? fetchTasks().catch((err) => { if (err.scope) state.tasksOk = false; else if (err.auth) throw err; else console.error(err); return state.tasks; }) : Promise.resolve([]);
      const [lists, tasks] = await Promise.all([Promise.all(targets.map((c) => fetchEvents(c, s, e))), tasksP]);
      if (id !== state.reqId) return;
      const hol = new Map();
      lists.flat().forEach((ev) => { if (holidayCals.some((c) => c.id === ev.calId)) hol.set(ymd(ev.start), ev.title); });
      state.holidays = hol;
      state.events = lists.flat().filter((ev) => !state.hidden.has(ev.calId));
      state.tasks = tasks;
      state.stale = null; state.authLost = false;
      saveCache(rangeKey(), state.events, tasks, hol);
      render();
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
  const isHolidayCal = (c) => /#holiday@/.test(c.id);
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
      state.tasks = (tc.tasks || []).map((t) => ({ ...t, due: t.due ? new Date(t.due) : null }));
      state.taskLists = tc.lists || [];
    }
    state.events = hit ? hit.ev.map((ev) => ({ ...ev, start: new Date(ev.start), end: new Date(ev.end), color: (state.calendars.find((c) => c.id === ev.calId) || ev).color })).filter((ev) => !state.hidden.has(ev.calId)) : [];
    state.holidays = new Map(hit ? hit.hol : []);
    state.stale = hit ? hit.at : -1;
    render();
    return !!hit;
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

  async function api(path, method = 'GET', body) {
    const opt = { method, headers: { Authorization: `Bearer ${state.token}` } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(path.startsWith('http') ? path : API + path, opt);
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
      ${opt.lockDate ? '<p class="note ev-only" style="margin:4px 0 0">この範囲では日付を変えられません。時間・内容・場所・通知は変えられます。</p>' : `<button type="button" class="link ev-only" id="c-endadd" style="margin-top:6px" ${hasEnd ? 'hidden' : ''}>＋ 別の日に終わる</button>`}
      ${opt.allowRecur ? `<label class="f ev-only"><span class="fl">繰り返し</span><select id="c-recur">${RECURS.map((r) => `<option value="${r.v}" ${r.v === ((v.recur && v.recur.freq) || '') ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>
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
    state.events.forEach((e) => { const t = kind === 'titles' ? e.title : e.location; if (t) m[t] = (m[t] || 0) + 1; });
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
            if (it.summary) titles[it.summary] = (titles[it.summary] || 0) + 1;
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
    if (!state.token && !state.demo && !state.tasks.length) { box.hidden = true; return; }
    box.hidden = false;
    if (state.view === 'today' && (state.demo || state.tasksOk || !state.token)) { box.hidden = true; return; } // 今日の画面の中に出している
    if (state.token && !state.demo && !state.tasksOk) {
      box.innerHTML = `<div class="tk-head"><b>タスク</b><button class="link" id="tk-auth">ToDoリストを表示するには、もう一度ログイン</button></div>`;
      $('#tk-auth').onclick = () => tokenClient && tokenClient.requestAccessToken();
      return;
    }
    const list = visibleTasks();
    const open = store.get('tasksOpen', true);
    const today = startOfDay(new Date());
    box.innerHTML = `
      <button class="tk-head" id="tk-toggle" aria-expanded="${open}"><b>タスク</b><span class="tk-n">${list.length}</span><span class="tk-arrow">${open ? '▾' : '▸'}</span></button>
      <ul class="tk-list" ${open ? '' : 'hidden'}>${list.map((t) => {
        const late = t.due && t.due < today;
        return `<li data-id="${esc(t.id)}" class="${t.parent && list.some((x) => x.id === t.parent) ? 'sub' : ''}"><button class="tk-box" aria-label="完了にする"></button>
          <button class="tk-title">${esc(t.title)}${state.taskLists.length > 1 && t.listTitle ? `<small>${esc(t.listTitle)}</small>` : ''}</button>
          <span class="tk-due${late ? ' late' : ''}">${t.due ? `${t.due.getMonth() + 1}/${t.due.getDate()}（${WD[t.due.getDay()]}）${late ? ' 期限切れ' : ''}` : '期限なし'}</span></li>`;
      }).join('') || '<li class="tk-empty">この期間のタスクはありません</li>'}</ul>`;
    $('#tk-toggle').onclick = () => { store.set('tasksOpen', !open); renderTasks(); };
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

  // 重なりの確認用：指定期間の予定（読めなければ空）
  async function eventsBetween(a, b) {
    const hit = (e) => e.start < b && e.end > a;
    if (state.demo) return demoEvents().filter(hit);
    const [rs, re] = range();
    if (a >= rs && b <= re) return state.events.filter(hit);
    if (!state.token) return [];
    try {
      const cals = state.calendars.filter((c) => !isHolidayCal(c) && !state.hidden.has(c.id));
      return (await Promise.all(cals.map((c) => fetchEvents(c, a, b)))).flat();
    } catch (err) { return []; }
  }

  // 予定の今の内容を、確認画面の形にする
  function eventToForm(ev) {
    const date = startOfDay(ev.start);
    const r = ev.reminders;
    let remind = 'default';
    // 通知が2つ以上なら1つに絞らず「そのまま」にする
    if (r && r.useDefault === false && !(r.overrides && r.overrides.length > 1)) remind = r.overrides && r.overrides.length ? String(r.overrides[0].minutes) : '';
    if (state.demo) remind = ev.remind || '';
    const start = ev.allDay ? 9 * 60 : ev.start.getHours() * 60 + ev.start.getMinutes();
    return {
      calId: ev.calId, title: ev.title, location: ev.location, date, allDay: ev.allDay,
      start, end: ev.allDay ? start + 60 : ev.end.getHours() * 60 + ev.end.getMinutes(),
      endDays: ev.allDay ? 0 : Math.round((startOfDay(ev.end) - date) / 86400000), // 終わりが何日後か
      remind, spanDays: ev.allDay ? Math.max(1, Math.round((startOfDay(ev.end) - date) / 86400000)) : 1,
    };
  }

  // 変更する（指示があればその項目だけ差し替えて確認画面へ）
  function openEdit(ev, text, scope = 'this', moved) {
    const locked = scope !== 'this'; // 全体やこの日以降は、日付を動かさない（繰り返しの規則とずれるため）
    const base = eventToForm(ev);
    const v = { ...base };
    const changed = new Set();
    if (moved) { // 動かした先の日時を入れて、長さは保つ
      v.date = moved.date; v.allDay = false; v.start = moved.start;
      v.end = (moved.start + moved.dur) % 1440; v.endDays = Math.floor((moved.start + moved.dur) / 1440);
      if (!sameDay(moved.date, base.date)) changed.add('date');
      changed.add('time');
    }
    if (text) {
      text = applyDict(text);
      const c = window.KoeParse.parseChange(text, pOpts({ calendars: writableCals() }));
      if (locked && c.date) { delete c.date; toast('この範囲では日付を変えられません。時間や内容は変えられます'); }
      if (!Object.keys(c).length) { toast('変更する内容が聞き取れませんでした。例：「15時からに変更」'); return false; }
      if (c.calId) { v.calId = c.calId; changed.add('calId'); }
      if (c.title !== undefined) { v.title = applyDictField(c.title); changed.add('title'); }
      if (c.location !== undefined) { v.location = applyDictField(c.location); changed.add('location'); }
      if (c.date) { v.date = c.date; changed.add('date'); }
      if (c.allDay === true) { v.allDay = true; changed.add('time'); }
      if (c.start != null) {
        const dur = base.allDay ? 60 : base.end + base.endDays * 1440 - base.start;
        const endAbs = c.end != null ? c.end : c.start + dur; // 終わりを言わなければ長さを保つ
        v.allDay = false; v.start = c.start; v.end = endAbs % 1440; v.endDays = Math.floor(endAbs / 1440);
        changed.add('time');
      }
      if (c.remind) { v.remind = String(c.remind.minutes); v.remindLabel = c.remind.label; changed.add('remind'); }
    }
    openForm(v, {
      heading: ev.recurring ? `変更しますか？（${SCOPE_LABEL[scope]}）` : 'この内容に変更しますか？', heard: text, busyLabel: '変更中…', okLabel: '変更する', changed, keepRemind: true, fixedKind: true,
      lockDate: locked, lockCal: ev.recurring && scope === 'this',
      notConflict: (e) => e.id === ev.id || (scope !== 'this' && ev.masterId && e.masterId === ev.masterId),
      keepLabel: ev.reminders && ev.reminders.overrides && ev.reminders.overrides.length > 1 ? `そのまま（通知${ev.reminders.overrides.length}件）` : '',
      onOk: async (out) => { await updateEvent(ev, out, scope); toast(`変更しました：${out.title}`); },
    });
    return true;
  }

  // ---------- Googleへの書き込み ----------
  function eventBody(v) {
    let endMin = v.end + (v.endDays || 0) * 1440;
    if (!v.allDay && endMin <= v.start) endMin += 24 * 60; // 日をまたぐ
    const at = (min) => { const d = new Date(v.date); d.setMinutes(min); return d; };
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const local = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    const body = {
      summary: v.title,
      location: v.location,
      start: v.allDay ? { date: ymd(v.date) } : { dateTime: local(at(v.start)), timeZone: tz },
      end: v.allDay ? { date: ymd(addDays(v.date, v.spanDays || 1)) } : { dateTime: local(at(endMin)), timeZone: tz },
    };
    if (v.remind !== 'default') {
      // 設計書：通知は言ったときだけ。基本は通知なし
      const min = v.remind === 'prevday' ? (v.allDay ? 15 * 60 : 24 * 60) : v.remind ? Number(v.remind) : null;
      body.reminders = { useDefault: false, overrides: min != null ? [{ method: 'popup', minutes: min }] : [] };
    }
    if (v.description) body.description = v.description;
    if (v.recur) { const rule = window.KoeParse.recurRule(v.recur, v.date, v.allDay); if (rule) body.recurrence = [rule]; }
    return { body, startDate: v.allDay ? v.date : at(v.start), endDate: v.allDay ? addDays(v.date, v.spanDays || 1) : at(endMin) };
  }

  // 登録して、取り消す処理を返す
  async function insertEvent(v) {
    const { body, startDate, endDate } = eventBody(v);
    if (state.demo) {
      const c = state.calendars.find((x) => x.id === v.calId);
      const id = 'demo' + Date.now();
      demoEvents().push({ id, calId: v.calId, title: v.title, location: v.location, allDay: v.allDay,
        start: startDate, end: endDate, color: c.color, remind: v.remind });
      return async () => { demoStore = demoEvents().filter((x) => x.id !== id); };
    }
    if (!body.location) delete body.location;
    if (!body.reminders) body.reminders = v.remind === 'default' ? { useDefault: true } : { useDefault: false, overrides: [] };
    const created = await api(`/calendars/${encodeURIComponent(v.calId)}/events`, 'POST', body);
    return () => api(`/calendars/${encodeURIComponent(v.calId)}/events/${encodeURIComponent(created.id)}`, 'DELETE');
  }

  async function updateEvent(ev, v, scope = 'this') {
    const { body, startDate, endDate } = eventBody(v);
    if (state.demo) {
      const x = demoEvents().find((e) => e.id === ev.id);
      const c = state.calendars.find((k) => k.id === v.calId);
      Object.assign(x, { calId: v.calId, title: v.title, location: v.location, allDay: v.allDay, start: startDate, end: endDate,
        color: c.color, remind: v.remind === 'default' ? x.remind : v.remind });
      return;
    }
    // 通知を変えていなければ Google に送らない（複数の通知やメール通知をそのまま残す）
    const keepReminders = v.remind === 'default' || v.remind === eventToForm(ev).remind;
    if (keepReminders) delete body.reminders;
    const evPath = (cal, id) => `/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(id)}`;
    if (scope !== 'this' && ev.masterId) {
      const master = await api(evPath(ev.calId, ev.masterId));
      if (scope === 'following' && !isFirstOf(ev, master)) {
        // この日より前はそのまま残し、この日から新しい繰り返しを作る
        const until = window.KoeParse.untilBefore(ev.start, ev.allDay);
        let remaining = 0;
        if ((master.recurrence || []).some((l) => /COUNT=/.test(l))) {
          const q = new URLSearchParams({ timeMax: ev.start.toISOString(), maxResults: '2500', showDeleted: 'true' });
          const past = await api(`${evPath(ev.calId, ev.masterId)}/instances?${q}`);
          const total = Number((master.recurrence.find((l) => /COUNT=/.test(l)).match(/COUNT=(\d+)/) || [])[1]);
          remaining = total - (past.items || []).length;
        }
        const rule = window.KoeParse.splitRule(master.recurrence || [], until, remaining);
        const created = await api(`/calendars/${encodeURIComponent(v.calId)}/events`, 'POST', {
          ...body, recurrence: rule.next, reminders: body.reminders || master.reminders,
          description: master.description, colorId: master.colorId, transparency: master.transparency, visibility: master.visibility,
        });
        try {
          await api(evPath(ev.calId, ev.masterId), 'PATCH', { recurrence: rule.old });
        } catch (err) { // 片方だけ成功すると二重になるので、作った方を消す
          await api(evPath(v.calId, created.id), 'DELETE').catch(() => {});
          throw err;
        }
        return;
      }
      // すべての日：開始日はそのまま、時間と内容を変える
      const masterDate = master.start.date ? parseYMD(master.start.date) : startOfDay(new Date(master.start.dateTime));
      const b = eventBody({ ...v, date: masterDate }).body;
      if (keepReminders) delete b.reminders;
      await api(evPath(ev.calId, ev.masterId), 'PATCH', b);
      if (v.calId !== ev.calId) await api(`${evPath(ev.calId, ev.masterId)}/move?destination=${encodeURIComponent(v.calId)}`, 'POST');
      return;
    }
    await api(evPath(ev.calId, ev.id), 'PATCH', body);
    if (v.calId !== ev.calId) await api(`${evPath(ev.calId, ev.id)}/move?destination=${encodeURIComponent(v.calId)}`, 'POST');
  }

  // この予定が繰り返しの最初の回か
  function isFirstOf(ev, master) {
    const m = master.start.date ? parseYMD(master.start.date) : new Date(master.start.dateTime);
    return m.getTime() === ev.start.getTime();
  }

  // 削除して、元に戻す処理を返す
  async function deleteEvent(ev, scope = 'this') {
    const path = (id) => `/calendars/${encodeURIComponent(ev.calId)}/events/${encodeURIComponent(id)}`;
    if (state.demo) {
      demoStore = demoEvents().filter((e) => e.id !== ev.id);
      return async () => { demoStore = demoEvents().concat(ev); };
    }
    if (scope !== 'this' && ev.masterId) {
      const master = await api(path(ev.masterId));
      if (scope === 'following' && !isFirstOf(ev, master)) {
        const orig = master.recurrence || [];
        const rule = window.KoeParse.splitRule(orig, window.KoeParse.untilBefore(ev.start, ev.allDay));
        await api(path(ev.masterId), 'PATCH', { recurrence: rule.old });
        return () => api(path(ev.masterId), 'PATCH', { recurrence: orig });
      }
      await api(path(ev.masterId), 'DELETE');
      return () => api(path(ev.masterId), 'PATCH', { status: 'confirmed' });
    }
    await api(path(ev.id), 'DELETE');
    return () => api(path(ev.id), 'PATCH', { status: 'confirmed' });
  }

  // ---------- 声で登録・変更 ----------
  const voice = { open: false, rec: null, heard: '', final: '', error: '', onText: null, prompt: '' };
  const VOICE_ERR = {
    'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定で許可してください',
    'service-not-allowed': 'このブラウザでは音声認識が使えません。文字で入力してください',
    'audio-capture': 'マイクが見つかりません',
    'network': '音声認識につながりませんでした。通信を確認してください',
  };

  function startVoice(onText = openConfirm, prompt = '話してください\n例：明日14時、会議、本館3階会議室、10分前に通知') {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('このブラウザは声の入力に対応していません。文字で入力してください'); return; }
    voice.open = true; voice.onText = onText; voice.prompt = prompt;
    if (onText === openConfirm) voice.slot = null;
    $('#voice').hidden = false; $('#sheet-bg').hidden = false;
    drawVoiceQuick();
    listen(SR);
  }

  function setHeard(text) {
    const h = $('#v-heard');
    h.textContent = text || voice.prompt;
    h.classList.toggle('empty', !text);
  }

  function listen(SR = window.SpeechRecognition || window.webkitSpeechRecognition) {
    voice.heard = voice.final = voice.error = '';
    setHeard('');
    $('#v-hint').textContent = '聞き取り中…話し終えて2秒ほど待つと確認画面へ';
    $('#voice').classList.add('on');
    const rec = new SR();
    rec.lang = 'ja-JP';
    rec.interimResults = true;
    rec.continuous = true; // 項目の間で少し黙っても止まらない。2秒黙ったらこちらで止める
    rec.maxAlternatives = 1;
    const stopLater = () => {
      clearTimeout(voice.silence);
      voice.silence = setTimeout(() => { if (voice.rec === rec) rec.stop(); }, 2000);
    };
    rec.onresult = (e) => {
      // iPhoneは結果を累積して返すことがあるので、同じ内容を二重に足さない
      const join = (acc, t) => (t.startsWith(acc) ? t : acc.startsWith(t) ? acc : acc + t);
      let fin = '', all = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i], t = r[0].transcript;
        all = join(all, t);
        if (r.isFinal) fin = join(fin, t);
      }
      voice.final = fin; voice.heard = all;
      setHeard(all);
      stopLater();
    };
    rec.onerror = (e) => { voice.error = e.error; };
    rec.onend = () => {
      clearTimeout(voice.silence);
      $('#voice').classList.remove('on');
      voice.rec = null;
      if (!voice.open) return;
      const text = (voice.heard || voice.final).trim();
      if (text && !VOICE_ERR[voice.error]) { const cb = voice.onText; closeVoice(); cb(text); return; }
      $('#v-hint').textContent = VOICE_ERR[voice.error] || '聞き取れませんでした。マイクを押してもう一度話してください';
    };
    voice.rec = rec;
    try { rec.start(); } catch (err) { console.error(err); rec.onend(); }
  }

  function closeVoice() {
    voice.open = false;
    clearTimeout(voice.silence);
    voice.slot = null;
    if (voice.rec) { try { voice.rec.abort(); } catch {} voice.rec = null; }
    $('#voice').hidden = true;
    if ($('#sheet').hidden) $('#sheet-bg').hidden = true;
    document.querySelectorAll('.slot-mark').forEach((m) => m.remove());
  }

  // ---------- 空き時間の長押しで登録 ----------
  let pendingSlot = null; // 長押し後に「文字で入力する」を選んだときの枠
  function slotLabel(slot) { return slot.start != null ? `${md(slot.date)} ${minToHM(slot.start)}` : `${md(slot.date)}`; }

  function startSlot(slot, markParent, markTop) {
    if (!writableCals().length) { toast('書き込めるカレンダーがありません'); return; }
    if (navigator.vibrate) navigator.vibrate(15);
    document.querySelectorAll('.slot-mark').forEach((m) => m.remove());
    if (markParent) {
      const mk = el('div', 'slot-mark');
      if (markTop != null) mk.style.top = `${markTop}px`;
      mk.textContent = slotLabel(slot);
      markParent.appendChild(mk);
    }
    voice.slot = slot;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { useTextForSlot(slot); return; }
    startVoice((t) => openConfirm(t, slot), `${slotLabel(slot)} の予定を話してください\n例：会議、本館3階会議室、10分前に通知`);
  }

  function useTextForSlot(slot) {
    pendingSlot = slot;
    $('#intext').placeholder = `${slotLabel(slot)} に登録…（内容を打つ）`;
    $('#intext').focus();
  }
  function clearSlot() {
    pendingSlot = null;
    $('#intext').placeholder = '打って登録…（例：明日14時 打ち合わせ）';
  }

  // 長押しを検出。指が動いたら（スクロール）取り消す
  function attachLongPress(target, onFire) {
    let timer = null, sx = 0, sy = 0;
    const cancel = () => { clearTimeout(timer); timer = null; };
    target.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('.ev, .chip, .m-ev')) return;
      sx = e.clientX; sy = e.clientY;
      const pt = { x: e.clientX, y: e.clientY };
      cancel();
      timer = setTimeout(() => { timer = null; target.dataset.fired = '1'; onFire(pt); }, 500);
    });
    target.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => target.addEventListener(t, cancel));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    // 長押し直後のクリック（月表示の日付タップなど）を打ち消す
    target.addEventListener('click', (e) => { if (target.dataset.fired) { delete target.dataset.fired; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }

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
})();
