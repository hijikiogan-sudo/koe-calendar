const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {test}=require('node:test');
const startup=fs.readFileSync(require.resolve('../js/boot.js'),'utf8').split('// ---------- 起動 ----------')[1];
function run({native=true,mode='',client='',demo=false}={}){
 const calls=[];const c=vm.createContext({NATIVE:native,URLSearchParams,location:{search:demo?'?demo':'',pathname:'/'},navigator:{},store:{get:(_,fallback)=>fallback},cfgClientId:()=>client,
 isLocalView:()=>native&&mode==='local',isAppleView:()=>native&&mode==='apple',KoeLocal:{notifySchedule:async()=>{}},state:{},
 checkNewVersion(){},applyTheme(){},bind(){},render(){},prepareNativeLogin(){},
 startDemo:()=>calls.push('demo'),startLocal:()=>calls.push('local'),startApple:()=>calls.push('apple'),startNative:()=>calls.push('native'),showLogin:()=>calls.push('login')});
 vm.runInContext(startup,c);return calls;
}
test('Google設定がなくてもKoeだけ・Appleの保存先を使う',()=>{
 assert.deepEqual(run({mode:'local'}),['local']);assert.deepEqual(run({mode:'apple'}),['apple']);
});
test('初回のアプリは使い方選択、Webはお試しを表示する',()=>{
 assert.deepEqual(run(),['login']);assert.deepEqual(run({native:false}),['demo']);assert.deepEqual(run({client:'configured'}),['native']);
});
test('明示的なお試し指定は保存先より優先する',()=>{
 assert.deepEqual(run({mode:'local',demo:true}),['demo']);
});
