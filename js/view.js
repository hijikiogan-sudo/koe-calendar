// Koe：画面の表示（今日・日・週・月）
'use strict';
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
  if (state.view === 'day') v.appendChild(memoBar(state.anchor));
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
  if (state.view === 'day') return `${a.getMonth() + 1}月${a.getDate()}日${cfg('rokuyo', false) && window.KoeRokuyo ? `<small>${window.KoeRokuyo.rokuyo(a)}</small>` : ''}`;
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
    h.innerHTML = `${WD[d.getDay()]}<b>${d.getDate()}</b>${cfg('rokuyo', false) && window.KoeRokuyo ? `<span class="rk">${window.KoeRokuyo.rokuyo(d)}</span>` : ''}${state.diary.has(ymd(d)) ? `<span class="dh-memo">${MEMO_MARK}</span>` : ''}`;
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
      b.innerHTML = `<div class="ev-grip" aria-hidden="true"></div><div class="ev-in">${n === 1 && h >= 36 ? `<div class="t">${hm(t.ev.start)}〜${hm(t.ev.end)}</div>` : ''}<div class="ev-title">${esc(t.ev.title)}</div>${t.ev.location && h >= 56 ? `<div class="p">${esc(t.ev.location)}</div>` : ''}</div>`;
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
  root.appendChild(memoBar(today));
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
  const start0 = ev.start.getHours() * 60 + ev.start.getMinutes();
  let timer = null, drag = null, sx = 0, sy = 0, grab = 0, autoT = null, lastPt = null, resizing = false, newDur = dur;
  const scroller = () => root.querySelector('.tg-scroll');
  const cols = () => [...root.querySelectorAll('.dcol')];
  const place = (pt) => {
    lastPt = pt;
    if (resizing) { // 下端を動かして終わりの時刻を変える
      const c = b.parentElement;
      const end = Math.round((pt.y - c.getBoundingClientRect().top) / HOUR * 4) * 15;
      const e = Math.min(Math.max(end, start0 + 15), 1440);
      newDur = e - start0;
      drag.col = c; drag.start = start0;
      if (drag.ghost.parentElement !== c) c.appendChild(drag.ghost);
      drag.ghost.style.top = `${start0 / 60 * HOUR}px`;
      drag.ghost.style.height = `${newDur / 60 * HOUR - 1}px`;
      drag.label.textContent = `${minToHM(start0)}〜${minToHM(e)}`;
      return;
    }
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
    if (resizing) { resizing = false; if (newDur !== dur) openEdit(ev, '', 'this', { date: startOfDay(ev.start), start: start0, dur: newDur }); return; }
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
    resizing = !!(e.target.closest && e.target.closest('.ev-grip'));
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    timer = setTimeout(() => begin({ x: sx, y: sy }), resizing ? 200 : 450);
  }, { passive: true });
  b.addEventListener('touchend', () => finish(false));
  b.addEventListener('touchcancel', () => finish(true));
  b.addEventListener('mousedown', (e) => {
    if (e.button) return;
    sx = e.clientX; sy = e.clientY;
    resizing = !!e.target.closest('.ev-grip');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', () => finish(false), { once: true });
    timer = setTimeout(() => begin({ x: sx, y: sy }), resizing ? 200 : 450);
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
    if (state.diary.has(ymd(d))) cell.appendChild(Object.assign(el('span', 'mc-memo'), { textContent: MEMO_MARK }));
    if (cfg('rokuyo', false) && window.KoeRokuyo) cell.appendChild(Object.assign(el('span', 'rk'), { textContent: window.KoeRokuyo.rokuyo(d) }));
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
    <button class="dp-memo">${MEMO_MARK} ${state.diary.has(ymd(d)) ? esc(state.diary.get(ymd(d)).description || '') : 'メモを書く'}</button>
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
  pop.querySelector('.dp-memo').onclick = () => { closeDayPop(); openMemo(d); };
  pop.querySelectorAll('li[data-e]').forEach((li) => li.onclick = () => { closeDayPop(); openEvent(evs[Number(li.dataset.e)]); });
  pop.querySelectorAll('li[data-t]').forEach((li) => li.onclick = () => { closeDayPop(); openTask(tks[Number(li.dataset.t)]); });
  pop.querySelector('.dp-add').onclick = () => { closeDayPop(); startSlot({ date: d, start: null }, null); };
  pop.querySelector('.dp-day').onclick = () => { closeDayPop(); state.anchor = d; setView('day'); };
}
