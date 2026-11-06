// Koe：声で登録・変更、空き時間の長押し
'use strict';
// ---------- 声で登録・変更 ----------
const voice = { open: false, rec: null, heard: '', final: '', error: '', onText: null, prompt: '' };
const VOICE_ERR = {
  'not-allowed': NATIVE ? 'マイクか音声認識が許可されていません。設定アプリのKoeで許可してください' : 'マイクの使用が許可されていません。ブラウザの設定で許可してください',
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
  if (!writableCals().length) { toast(noWriteMsg()); return; }
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
function attachLongPress(target, onFire, touchOnly) {
  let timer = null, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  target.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('.ev, .chip, .m-ev')) return;
    if (touchOnly && e.pointerType === 'mouse') return; // マウスはなぞる操作を使う
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
