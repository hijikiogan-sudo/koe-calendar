// Koe：iOSアプリで動くときだけ使う部分。Web版では何もしない
'use strict';
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const KoeAuth = NATIVE ? window.Capacitor.registerPlugin('KoeAuth') : null;
const KoeSpeech = NATIVE ? window.Capacitor.registerPlugin('KoeSpeech') : null;

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
