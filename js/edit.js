// Koe：メモ、予定の変更、Googleへの書き込み
'use strict';
// ---------- 日ごとのメモ ----------
// Googleカレンダーの終日の予定として保存する（印を付けて、Koeでは予定と分けて出す）
const MEMO_MARK = '📝';
const memoCalId = () => {
  const w = writableCals();
  const id = cfg('memoCal', '');
  return (w.some((c) => c.id === id) ? id : (w.find((c) => /自分用/.test(c.name)) || w.find((c) => c.primary) || w[0] || {}).id) || '';
};
function openMemo(date, initial) {
  const cur = state.diary.get(ymd(date));
  const text = cur ? cur.description || '' : '';
  const value = initial ? (text ? `${text}\n${initial}` : initial) : text;
  openSheet(`
    <h2>${MEMO_MARK} ${md(date)}のメモ</h2>
    <textarea class="memo-input" id="m-text" rows="6" placeholder="今日のできごとや覚え書き">${esc(value)}</textarea>
    <button class="ok" id="m-save">保存する</button>
    ${cur ? '<button class="act danger" id="m-del">メモを消す</button>' : ''}
    <button class="act" id="m-cancel">やめる</button>`);
  $('#m-cancel').onclick = closeSheet;
  $('#m-save').onclick = async () => {
    const b = $('#m-save'); b.disabled = true; b.textContent = '保存中…';
    try {
      const t = $('#m-text').value.trim();
      if (t) await saveMemo(date, t, cur); else if (cur) await deleteMemo(cur);
      closeSheet(); toast('メモを保存しました'); load();
    } catch (err) { b.disabled = false; b.textContent = '保存する'; handleError(err); }
  };
  if ($('#m-del')) $('#m-del').onclick = async () => {
    try {
      const keep = cur.description;
      await deleteMemo(cur); closeSheet(); load();
      showUndo('メモを消しました', async () => { await saveMemo(date, keep, null); load(); });
    } catch (err) { handleError(err); }
  };
}
async function saveMemo(date, text, cur) {
  const summary = `${MEMO_MARK} ${text.split('\n')[0].slice(0, 20)}`;
  if (state.demo) {
    state.demoDiary = state.demoDiary || new Map();
    state.demoDiary.set(ymd(date), { id: `memo${ymd(date)}`, diary: true, description: text, title: summary, start: date, end: addDays(date, 1), allDay: true, calId: 'me' });
    return;
  }
  const calId = cur ? cur.calId : memoCalId();
  if (!calId) throw new Error('書き込めるカレンダーがありません');
  if (cur) { await api(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(cur.id)}`, 'PATCH', { summary, description: text }); return; }
  await api(`/calendars/${encodeURIComponent(calId)}/events`, 'POST', {
    summary, description: text, start: { date: ymd(date) }, end: { date: ymd(addDays(date, 1)) }, transparency: 'transparent',
    reminders: { useDefault: false, overrides: [] }, extendedProperties: { private: { koeMemo: '1' } },
  });
}
async function deleteMemo(cur) {
  if (state.demo) { state.demoDiary.delete(ymd(cur.start)); return; }
  await api(`/calendars/${encodeURIComponent(cur.calId)}/events/${encodeURIComponent(cur.id)}`, 'DELETE');
}
// 日表示・今日の画面に出すメモ欄
function memoBar(date) {
  const m = state.diary.get(ymd(date));
  const b = el('button', 'memo-bar' + (m ? ' has' : ''));
  b.innerHTML = m ? `<span>${MEMO_MARK}</span><span class="memo-text">${esc(m.description || '')}</span>` : `<span>${MEMO_MARK}</span><span class="memo-text empty">メモを書く</span>`;
  b.onclick = () => openMemo(date);
  return b;
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
function openEdit(ev, text, scope = 'this', moved, master) {
  const locked = scope !== 'this'; // 全体やこの日以降は、日付を動かさない（繰り返しの規則とずれるため）
  // 全体やこの日以降は、今の繰り返しの規則を読んでから開く
  if (locked && ev.masterId && !master && !state.demo) {
    api(`/calendars/${encodeURIComponent(ev.calId)}/events/${encodeURIComponent(ev.masterId)}`)
      .then((m) => { if (!openEdit(ev, text, scope, moved, m)) openEvent(ev); }).catch(handleError);
    return true;
  }
  const base = eventToForm(ev);
  const v = { ...base };
  const recNow = master ? window.KoeParse.parseRule(master.recurrence) : null;
  if (recNow) v.recur = recNow;
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
    allowRecur: locked && !!recNow, recurRequired: locked, recurLocked: locked && !!master && !recNow,
    notConflict: (e) => e.id === ev.id || (scope !== 'this' && ev.masterId && e.masterId === ev.masterId),
    keepLabel: ev.reminders && ev.reminders.overrides && ev.reminders.overrides.length > 1 ? `そのまま（通知${ev.reminders.overrides.length}件）` : '',
    onOk: async (out) => {
      out.recurChanged = !!recNow && JSON.stringify(out.recur) !== JSON.stringify(normalizeRec(recNow));
      await updateEvent(ev, out, scope);
      toast(`変更しました：${out.title}`);
    },
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
  const { body, startDate, endDate } = eventBody(scope === 'this' ? { ...v, recur: null } : v);
  delete body.recurrence; // 繰り返しの規則は下で範囲ごとに扱う
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
      if (v.recurChanged) { // 規則を変えたときは、この日から新しい規則で始める
        const others = rule.next.filter((l) => !/^RRULE:/.test(l));
        rule.next = [window.KoeParse.recurRule(v.recur, v.date, v.allDay), ...others];
      }
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
    let masterDate = master.start.date ? parseYMD(master.start.date) : startOfDay(new Date(master.start.dateTime));
    if (v.recurChanged && v.recur.freq === 'WEEKLY') { while (!v.recur.days.includes(masterDate.getDay())) masterDate = addDays(masterDate, 1); }
    if (v.recurChanged && v.recur.freq === 'WEEKDAYS') { while (masterDate.getDay() === 0 || masterDate.getDay() === 6) masterDate = addDays(masterDate, 1); }
    const b = eventBody({ ...v, recur: null, date: masterDate }).body;
    if (keepReminders) delete b.reminders;
    if (v.recurChanged) b.recurrence = [window.KoeParse.recurRule(v.recur, masterDate, v.allDay), ...(master.recurrence || []).filter((l) => !/^RRULE:/.test(l))];
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
