// Koe（コエ）：話すだけで予定とタスクが入る手帳。Googleカレンダー／ToDoリスト連動
(() => {
  'use strict';

  const APP_VERSION = '202611051259'; // index.html の ?v= と合わせる（iPhoneに古い版が残らないように）
  const SCOPES = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks';
  const API = 'https://www.googleapis.com/calendar/v3';
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const HOUR = 52; // style.css の --hour と合わせる

  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  const state = {
    view: store.get('view', 'week'),
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
    if (view === 'day') return [a, addDays(a, 1)];
    if (view === 'week') { const s = addDays(a, -a.getDay()); return [s, addDays(s, 7)]; }
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const s = addDays(first, -first.getDay());
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
    const n = state.view === 'day' ? 1 : 7;
    v.appendChild(renderTimeGrid(n));
    // 時間軸のスクロール位置：前の位置を保つ。初回は今の時刻（今日を含まなければ8時）付近
    const scroll = v.querySelector('.tg-scroll');
    if (state.scrollTop != null) scroll.scrollTop = state.scrollTop;
    else {
      const [s] = range(); const today = startOfDay(new Date());
      const showsToday = Array.from({ length: n }, (_, i) => addDays(s, i)).some((d) => sameDay(d, today));
      scroll.scrollTop = (showsToday ? Math.max(new Date().getHours() - 2, 0) : 8) * HOUR;
    }
    scroll.dataset.init = '1';
  }

  // 見出し：月を大きく、年は小さく添える
  function titleHTML() {
    const a = state.anchor;
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
    head.appendChild(el('div'));
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
        const b = el('button', 'ev');
        b.style.cssText = `top:${top}px;height:${h - 1}px;left:${t.col / t.cols * 100}%;width:calc(${100 / t.cols}% - 2px);--c:${t.ev.color}`;
        const short = h < 36;
        b.innerHTML = short
          ? `${esc(t.ev.title)}`
          : `${n === 1 ? `<div class="t">${hm(t.ev.start)}〜${hm(t.ev.end)}</div>` : ''}<div>${esc(t.ev.title)}</div>${t.ev.location ? `<div class="p">${esc(t.ev.location)}</div>` : ''}`;
        b.onclick = () => openEvent(t.ev);
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
    WD.forEach((w) => head.appendChild(Object.assign(el('div'), { textContent: w })));
    root.appendChild(head);
    const body = el('div', 'mg-body');
    for (let i = 0; i < 42; i++) {
      const d = addDays(s, i);
      const cell = el('button', 'mc' + (d.getMonth() !== m ? ' out' : '') + (sameDay(d, today) ? ' today' : '') + (state.holidays.has(ymd(d)) ? ' holiday' : ''));
      cell.appendChild(Object.assign(el('div', 'num'), { textContent: d.getDate() }));
      const evs = eventsOn(d).sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start))
        .concat(state.tasks.filter((t) => t.due && sameDay(t.due, d)).map((t) => ({ task: true, title: t.title })));
      const max = 3;
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

  // ---------- 検索 ----------
  function openSearch() {
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
        ${ev.recurring ? '<p class="note">繰り返しの予定です。変更・削除はこの日の分だけに効きます。</p>' : ''}
        <div class="e-acts" id="e-acts">
          <button class="act" id="e-edit">手で直す</button>
          <button class="act danger" id="e-del">削除</button>
        </div>`
        : '<p class="note">このカレンダーは見るだけで、変更や削除はできません。</p>'}`);
    if (!canEdit) return;

    $('#e-form').onsubmit = (e) => {
      e.preventDefault();
      const t = $('#e-text').value.trim();
      if (t) { $('#e-text').blur(); openEdit(ev, t); }
    };
    $('#e-mic').onclick = () => startVoice((t) => { if (!openEdit(ev, t)) openEvent(ev); }, '変更したい内容を話してください（例：15時からに変更）');
    $('#e-edit').onclick = () => openEdit(ev, '');
    // 削除は2段階で確認
    $('#e-del').onclick = () => {
      $('#e-acts').innerHTML = `
        <p class="confirm-q">本当に削除しますか？<br><small>「${esc(ev.title)}」${when}</small></p>
        <button class="act danger-solid" id="e-del2">削除する</button>
        <button class="act" id="e-keep">やめる</button>`;
      $('#e-keep').onclick = () => openEvent(ev);
      $('#e-del2').onclick = async () => {
        const b = $('#e-del2'); b.disabled = true; b.textContent = '削除中…';
        try {
          await deleteEvent(ev);
          closeSheet();
          load();
          showUndo(`削除しました：${ev.title}`, async () => { await undeleteEvent(ev); load(); });
        } catch (err) { b.disabled = false; b.textContent = '削除する'; handleError(err); }
      };
    };
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
    const dark = m === 'dark' || (m === 'auto' && darkMQ.matches);
    document.documentElement.dataset.theme = THEMES.some((x) => x.id === t) ? t : DEFAULT_THEME;
    document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
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
  function setDict(d) {
    store.set('dict', d); store.set('dictAt', Date.now());
    clearTimeout(dictPushTimer);
    dictPushTimer = setTimeout(() => pushDict().catch((err) => console.warn('辞書の保存に失敗', err)), 800);
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
    const json = JSON.stringify({ at: store.get('dictAt', Date.now()), items: getDict() });
    const chunks = json.match(/[\s\S]{1,7000}/g) || [];
    await Promise.all(old.filter((t) => /^dict-/.test(t.title || '')).map((t) => api(`${path}/${encodeURIComponent(t.id)}`, 'DELETE')));
    for (let i = 0; i < chunks.length; i++) await api(path, 'POST', { title: `dict-${String(i).padStart(3, '0')}`, notes: chunks[i] });
  }
  async function syncDict() {
    if (state.demo || !state.token || !state.tasksOk) return;
    try {
      const list = await settingsList(false);
      const local = getDict(), localAt = store.get('dictAt', 0);
      if (!list) { if (local.length) await pushDict(); return; }
      const items = ((await api(`${TASKS_API}/lists/${encodeURIComponent(list.id)}/tasks?maxResults=100`)).items || [])
        .filter((t) => /^dict-/.test(t.title || '')).sort((a, b) => (a.title < b.title ? -1 : 1));
      if (!items.length) { if (local.length) await pushDict(); return; }
      const remote = JSON.parse(items.map((t) => t.notes || '').join(''));
      if (!localAt) { // この端末で初めて：両方の登録を合わせる
        const merged = [...remote.items, ...local.filter((x) => !remote.items.some((r) => r.from === x.from))];
        store.set('dict', merged); store.set('dictAt', Date.now());
        if (merged.length !== remote.items.length) await pushDict();
      } else if (remote.at > localAt) { store.set('dict', remote.items); store.set('dictAt', remote.at); }
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
    box.innerHTML = `<span>登録しました。次から「${esc(p.from)}」を「${esc(p.to)}」にしますか？</span><button class="yes">辞書に登録</button><button class="no">いいえ</button>`;
    $('#app').appendChild(box);
    const timer = setTimeout(() => box.remove(), 15000);
    box.querySelector('.no').onclick = () => { clearTimeout(timer); box.remove(); };
    box.querySelector('.yes').onclick = () => { clearTimeout(timer); addDict(p.from, p.to); box.remove(); toast(`辞書に登録：${p.from} → ${p.to}`); };
  }

  function openMenu() {
    const cals = state.calendars.map((c) =>
      `<button class="cal ${state.hidden.has(c.id) ? '' : 'on'}" data-id="${esc(c.id)}" style="--c:${c.color}"><i></i>${esc(c.name)}</button>`).join('');
    const theme = store.get('theme', DEFAULT_THEME), mode = store.get('mode', 'auto');
    const dict = getDict();
    openSheet(`
      <h2>メニュー</h2>
      <div class="sec">見た目</div>
      <div class="themes">${THEMES.map((t) => `<button class="th${t.id === theme ? ' on' : ''}" data-t="${t.id}">
        <span class="sw3">${t.sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${t.name}</button>`).join('')}</div>
      <div class="modes" style="margin-top:8px">${MODES.map((m) => `<button data-m="${m.id}" class="${m.id === mode ? 'on' : ''}">${m.name}</button>`).join('')}</div>
      <p class="note" style="margin-top:6px">「自動」は iPhone の設定（ライト／ダーク）に合わせます。</p>

      <div class="sec">辞書（こう聞き取られたら → こう書く）</div>
      <ul class="dict">${dict.map((d, i) => `<li><span class="from">${esc(d.from)}</span><span class="arrow">→</span><span class="to">${esc(d.to)}</span>
        <button class="del" data-i="${i}" aria-label="削除">×</button></li>`).join('') || '<li class="dict-empty">まだありません。例：「サーフ会議」→「スタッフ会議」</li>'}</ul>
      <form class="dict-add" id="dict-form">
        <input id="dict-from" placeholder="実際に出る字（隆、高）" autocomplete="off">
        <span>→</span>
        <input id="dict-to" placeholder="書きたい表記" autocomplete="off">
        <button>追加</button>
      </form>

      <p class="note" style="margin-top:6px">iPhoneは「たかし」を「隆」などの漢字で書き起こします。確認画面に出た字を登録してください。「、」で区切ると複数まとめて登録できます。Google ToDoの「Koe設定」リストを使って、iPhoneとパソコンで共有します。</p>

      <div class="sec">もしかしての候補</div>
      <p class="note" style="margin-top:0" id="m-corpus"></p>
      <button class="act" id="m-corpus-reload" style="margin-top:6px">候補を読み直す</button>

      <div class="sec">表示するカレンダー</div>
      ${cals}
      ${state.demo
        ? (cfgClientId() ? '<button class="act" id="m-login">Googleでログインする</button>' : '<p class="note">Googleとつなぐには config.js にクライアントIDを設定します（SETUP.md 参照）。</p>')
        : '<button class="act" id="m-logout">ログアウト</button>'}
      <p class="note">Koe ・ 版 ${APP_VERSION}</p>`);
    const sh = $('#sheet');
    sh.querySelectorAll('.th').forEach((b) => b.onclick = () => {
      store.set('theme', b.dataset.t); applyTheme();
      sh.querySelectorAll('.th').forEach((x) => x.classList.toggle('on', x === b));
    });
    sh.querySelectorAll('.modes button').forEach((b) => b.onclick = () => {
      store.set('mode', b.dataset.m); applyTheme();
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
      store.set('hiddenCals', [...state.hidden]);
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
      await run; showCorpus();
      toast(corpusStatus || '候補を読み直しました');
    };
    const lo = $('#m-logout'); if (lo) lo.onclick = logout;
    const li = $('#m-login'); if (li) li.onclick = () => { closeSheet(); state.demo = false; showLogin(); };
  }

  // ---------- データ ----------
  async function load() {
    const id = ++state.reqId;
    const [s, e] = range();
    if (state.demo) {
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
    state.events = hit ? hit.ev.map((ev) => ({ ...ev, start: new Date(ev.start), end: new Date(ev.end) })).filter((ev) => !state.hidden.has(ev.calId)) : [];
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
      reminders: it.reminders, recurring: !!it.recurringEventId,
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
    { v: '', label: '繰り返さない' }, { v: 'DAILY', label: '毎日' }, { v: 'WEEKDAYS', label: '平日のみ' }, { v: 'WEEKLY', label: '毎週' },
    { v: 'BIWEEKLY', label: '隔週' }, { v: 'MONTHLY', label: '毎月' }, { v: 'YEARLY', label: '毎年' },
  ];
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
      ${v.endDays && !v.allDay ? `<p class="note ev-only" style="margin:4px 0 0;text-align:right">終わりは ${v.endDays}日後（${md(addDays(v.date || startOfDay(new Date()), v.endDays))}）の上記の時刻です</p>` : ''}
      ${v.spanDays > 1 ? `<p class="note ev-only" style="margin:4px 0 0;text-align:right">${v.spanDays}日間（〜${md(addDays(v.date, v.spanDays - 1))}）の終日予定です</p>` : ''}
      ${opt.allowRecur ? `<label class="f ev-only"><span class="fl">繰り返し</span><select id="c-recur">${RECURS.map((r) => `<option value="${r.v}" ${r.v === (v.recur || '') ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>` : ''}
      ${!opt.fixedKind && state.taskLists.length > 1 ? `<div class="f task-only"><span class="fl">リスト</span><div class="cal-chips">${state.taskLists.map((l) => `<button type="button" class="cc lc${l.id === (v.listId || state.taskLists[0].id) ? ' on' : ''}" data-id="${esc(l.id)}" style="--c:var(--task);--ct:var(--on-task)">${esc(l.title)}</button>`).join('')}</div></div>` : ''}
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
    let listId = v.listId || (state.taskLists[0] && state.taskLists[0].id);
    sh.querySelectorAll('.cc.lc').forEach((b) => b.onclick = () => {
      listId = b.dataset.id;
      sh.querySelectorAll('.cc.lc').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('#c-nodue').onchange = (e) => { $('#c-date').disabled = e.target.checked; };
    $('#c-allday').onchange = (e) => { $('#c-start').disabled = $('#c-end').disabled = e.target.checked; };
    $('#c-start').onchange = () => { // 開始を動かしたら長さを保って終わりも動かす
      if (v.endDays) return; // 日をまたぐ予定は終わりの日時を動かさない
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
        recur: $('#c-recur') ? $('#c-recur').value : '',
        monthEnd: !!v.monthEnd,
      };
      if (!out.noDue && isNaN(out.date)) { toast('日付を入れてください'); return; }
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
  function openConfirm(text, slot) {
    text = applyDict(text);
    const cals = writableCals();
    if (!cals.length) { toast('書き込めるカレンダーがありません'); return; }
    const p = window.KoeParse.parse(text, { calendars: cals });
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
      location: p.location, remind: p.remind ? String(p.remind.minutes) : '', remindLabel: p.remind && p.remind.label,
      spanDays: p.spanDays, recur: p.recur ? p.recur.freq : '', monthEnd: !!(p.recur && p.recur.monthEnd),
      listId: (p.calSaid && state.taskLists.find((l) => { const c = cals.find((x) => x.id === p.calId); return c && (c.name.includes(l.title) || l.title.includes(c.name)); }) || {}).id,
    }, {
      heading: 'この内容で登録しますか？', heard: text, busyLabel: '登録中…', allowRecur: true,
      onFixed: (title, location) => { p.title = title; p.location = location; }, // 直した後を基準に、案内の重複を防ぐ
      onOk: async (v) => {
        if (v.kind === 'task') await insertTask(v); else await insertEvent(v);
        noteCorpus(v);
        $('#intext').value = '';
        toast(`${v.kind === 'task' ? 'タスクを' : ''}登録しました：${v.title}`);
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
      demoTaskList().push({ id: 't' + Date.now(), listId: l.id, listTitle: l.title, title: v.title, due: v.noDue ? null : v.date });
      return;
    }
    const body = { title: v.title };
    if (!v.noDue) body.due = dueStr(v.date);
    await api(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`, 'POST', body);
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
    return state.tasks.filter((t) => !t.due || t.due < e)
      .sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due && b.due ? a.due - b.due : 0));
  }

  function renderTasks() {
    const box = $('#tasks');
    if (!state.token && !state.demo && !state.tasks.length) { box.hidden = true; return; }
    box.hidden = false;
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
        return `<li data-id="${esc(t.id)}"><button class="tk-box" aria-label="完了にする"></button>
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
  function openEdit(ev, text) {
    const base = eventToForm(ev);
    const v = { ...base };
    const changed = new Set();
    if (text) {
      text = applyDict(text);
      const c = window.KoeParse.parseChange(text, { calendars: writableCals() });
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
      heading: 'この内容に変更しますか？', heard: text, busyLabel: '変更中…', okLabel: '変更する', changed, keepRemind: true, fixedKind: true,
      keepLabel: ev.reminders && ev.reminders.overrides && ev.reminders.overrides.length > 1 ? `そのまま（通知${ev.reminders.overrides.length}件）` : '',
      onOk: async (out) => { await updateEvent(ev, out); toast(`変更しました：${out.title}`); },
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
    if (v.recur) { const rule = window.KoeParse.recurRule(v.recur, v.date, v.monthEnd); if (rule) body.recurrence = [rule]; }
    return { body, startDate: v.allDay ? v.date : at(v.start), endDate: v.allDay ? addDays(v.date, v.spanDays || 1) : at(endMin) };
  }

  async function insertEvent(v) {
    const { body, startDate, endDate } = eventBody(v);
    if (state.demo) {
      const c = state.calendars.find((x) => x.id === v.calId);
      demoEvents().push({ id: 'demo' + Date.now(), calId: v.calId, title: v.title, location: v.location, allDay: v.allDay,
        start: startDate, end: endDate, color: c.color, remind: v.remind });
      return;
    }
    if (!body.location) delete body.location;
    if (!body.reminders) body.reminders = { useDefault: false, overrides: [] };
    await api(`/calendars/${encodeURIComponent(v.calId)}/events`, 'POST', body);
  }

  async function updateEvent(ev, v) {
    const { body, startDate, endDate } = eventBody(v);
    if (state.demo) {
      const x = demoEvents().find((e) => e.id === ev.id);
      const c = state.calendars.find((k) => k.id === v.calId);
      Object.assign(x, { calId: v.calId, title: v.title, location: v.location, allDay: v.allDay, start: startDate, end: endDate,
        color: c.color, remind: v.remind === 'default' ? x.remind : v.remind });
      return;
    }
    // 通知を変えていなければ Google に送らない（複数の通知やメール通知をそのまま残す）
    if (v.remind === 'default' || v.remind === eventToForm(ev).remind) delete body.reminders;
    await api(`/calendars/${encodeURIComponent(ev.calId)}/events/${encodeURIComponent(ev.id)}`, 'PATCH', body);
    if (v.calId !== ev.calId) {
      await api(`/calendars/${encodeURIComponent(ev.calId)}/events/${encodeURIComponent(ev.id)}/move?destination=${encodeURIComponent(v.calId)}`, 'POST');
    }
  }

  async function undeleteEvent(ev) {
    if (state.demo) { demoStore = demoEvents().concat(ev); return; }
    await api(`/calendars/${encodeURIComponent(ev.calId)}/events/${encodeURIComponent(ev.id)}`, 'PATCH', { status: 'confirmed' });
  }
  async function deleteEvent(ev) {
    if (state.demo) { demoStore = demoEvents().filter((e) => e.id !== ev.id); return; }
    await api(`/calendars/${encodeURIComponent(ev.calId)}/events/${encodeURIComponent(ev.id)}`, 'DELETE');
  }

  // ---------- 声で登録・変更 ----------
  const voice = { open: false, rec: null, heard: '', final: '', error: '', onText: null, prompt: '' };
  const VOICE_ERR = {
    'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定で許可してください',
    'service-not-allowed': 'このブラウザでは音声認識が使えません。文字で入力してください',
    'audio-capture': 'マイクが見つかりません',
    'network': '音声認識につながりませんでした。通信を確認してください',
  };

  function startVoice(onText = openConfirm, prompt = '話してください') {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('このブラウザは声の入力に対応していません。文字で入力してください'); return; }
    voice.open = true; voice.onText = onText; voice.prompt = prompt;
    if (onText === openConfirm) voice.slot = null;
    $('#voice').hidden = false; $('#sheet-bg').hidden = false;
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
    startVoice((t) => openConfirm(t, slot), `${slotLabel(slot)} の予定を話してください（例：打ち合わせ、会議室A）`);
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
    state.calendars = DEMO_CALS;
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
    $('#btn-search').onclick = openSearch;
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
    else if (calCache.length) { state.calendars = calCache; state.authLost = true; loadCached(); } // 切れていても前回の予定は見せる
    else showLogin();
  }
})();
