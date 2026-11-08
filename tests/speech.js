const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test}=require('node:test');
const P=require('../parse.js');
const now=new Date(2026,10,8,9);
test('言い直した日時を採用し、名前の「いや」は勝手に変換しない',()=>{
  const r=P.parse('明日20時、いや21時から会議',{now});assert.equal(r.start,1260);assert.equal(r.title,'会議');
  const d=P.parse('明日、いや明後日20時会議',{now});assert.equal(d.date.getDate(),10);
  assert.equal(P.normalize('いやま医院で会議'),'いやま医院で会議');
  assert.equal(P.parseChange('20時ではなく21時に変更',{now}).start,1260);
  assert.equal(P.parse('午後8時、いや9時に会議',{now}).start,1260);
  assert.equal(P.parse('二十時、いや二十一時から会議',{now}).start,1260);
});
test('複数通知の順序違い・別文・重複を解析し、予定名に残さない',()=>{
  for(const text of ['明日20時から21時半まで勉強会、30分前と10分前に通知','明日20時から21時半まで勉強会、通知は30分前と10分前','明日20時から21時半まで勉強会、30分前に通知、10分前に通知']){
    const r=P.parse(text,{now});assert.equal(r.title,'勉強会');assert.equal(r.end,1290);assert.deepEqual(r.remind.items.map(x=>x.minutes),[30,10]);
  }
  assert.equal(P.parse('明日20時会議、10分前と10分前に通知',{now}).remind.minutes,10);
});
function speech(pause=3000){
  let clock=0, seq=0;const timers=new Map(),instances=[],received=[];
  const node=()=>({hidden:false,textContent:'',classList:{add(){},remove(){},toggle(){}}});
  const nodes={};const $=id=>nodes[id]||(nodes[id]=node());$('#sheet').hidden=true;
  class SR {constructor(){instances.push(this);this.stops=0}start(){}stop(){this.stops++}abort(){}}
  const c=vm.createContext({window:{SpeechRecognition:SR},NATIVE:true,console,$,document:{querySelectorAll:()=>[]},cfg:()=>pause,received,
    setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{at:clock+ms,fn});return id},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(fs.readFileSync(require.resolve('../js/input.js'),'utf8'),c);
  vm.runInContext('voice.open=true;voice.onText=t=>received.push(t);listen();',c);
  const tick=ms=>{clock+=ms;for(const [id,t]of [...timers])if(t.at<=clock){timers.delete(id);t.fn()}};
  const result=(rec,text,final=false)=>rec.onresult({results:[Object.assign([{transcript:text}],{isFinal:final})]});
  return {c,instances,received,tick,result};
}
test('音声活動で待ち時間が延び、指定時間より早く停止しない',()=>{
  const s=speech(),r=s.instances[0];s.result(r,'明日20時');s.tick(2500);r.onactivity({speaking:true});s.tick(2500);assert.equal(r.stops,0);s.tick(500);assert.equal(r.stops,1);
});
test('古い録音の終了・結果・エラーは新しい録音に混ざらない',()=>{
  const s=speech(),old=s.instances[0];vm.runInContext('listen()',s.c);const next=s.instances[1];
  old.onend();old.onerror({error:'network'});s.result(old,'古い予定');s.result(next,'新しい予定',true);next.onend();assert.deepEqual(s.received,['新しい予定']);
});
test('手動停止モードで自動停止せず、最終結果と途中の後半を落とさない',()=>{
  const s=speech(0),r=s.instances[0];s.result(r,'会議');s.tick(20000);assert.equal(r.stops,0);
  r.onresult({results:[Object.assign([{transcript:'明日'}],{isFinal:true}),Object.assign([{transcript:'20時会議'}],{isFinal:false})]});r.onend();assert.deepEqual(s.received,['明日20時会議']);
});
test('辞書が多くても予定名と長い施設名を候補に残す',()=>{
  const c=vm.createContext({window:{},getDict:()=>Array.from({length:100},(_,i)=>({to:'辞書'+i})),getCorpus:k=>Object.fromEntries(Array.from({length:50},(_,i)=>[(k==='titles'?'予定':'施設名の長い正式名称あいうえおかきくけこさしすせそ')+i,50-i])),console});
  vm.runInContext(fs.readFileSync(require.resolve('../js/native.js'),'utf8'),c);const hints=c.speechHints();assert.equal(hints.length,100);assert.equal(hints.filter(x=>x.startsWith('辞書')).length,40);assert.equal(hints.filter(x=>x.startsWith('予定')).length,30);assert.equal(hints.filter(x=>x.startsWith('施設')).length,30);
});
test('ネイティブの古いセッションから遅れて届くイベントを無視する',()=>{
  const listeners={};const starts=[];
  const plugin={addListener:(name,fn)=>{(listeners[name]||=[]).push(fn);return Promise.resolve({remove(){}})},start:async v=>{starts.push(v)},abort:async()=>{}};
  const c=vm.createContext({window:{Capacitor:{isNativePlatform:()=>true,registerPlugin:()=>plugin}},getDict:()=>[],getCorpus:()=>({}),console});
  vm.runInContext(fs.readFileSync(require.resolve('../js/native.js'),'utf8'),c);
  const rec=new c.window.SpeechRecognition();let heard='',ended=0;rec.onresult=e=>heard=e.results[0][0].transcript;rec.onend=()=>ended++;rec.start();
  listeners.result[0]({session:'old',text:'古い予定'});listeners.end[0]({session:'old'});assert.equal(heard,'');assert.equal(ended,0);
  listeners.result[0]({session:starts[0].session,text:'新しい予定',isFinal:true});assert.equal(heard,'新しい予定');
});
