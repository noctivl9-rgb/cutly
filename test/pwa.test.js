const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const pwaSource=fs.readFileSync(path.join(__dirname,'../public/pwa.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/manifest.webmanifest'),'utf8'));

function createElement(){
 const listeners={};
 return {hidden:false,open:false,disabled:false,textContent:'',children:[],listeners,
  addEventListener:(kind,fn)=>listeners[kind]=fn,
  showModal(){this.open=true;},close(){this.open=false;},
  replaceChildren(){this.children=[];},append(child){this.children.push(child);}};
}

function runPwa({standalone=false,ios=false,iosBrowser='Safari',dismissed=false}={}){
 const events={},storage=new Map(),elements={
  '[data-install-app]':createElement(),
  '#install-dialog':createElement(),
  '[data-install-help]':createElement(),
  '[data-install-help-title]':createElement(),
  '[data-install-help-steps]':createElement(),
  '[data-install-status]':createElement(),
  '[data-install-later]':createElement()
 };
 const window={matchMedia:()=>({matches:standalone}),addEventListener:(name,fn)=>(events[name]??=[]).push(fn)};
 const navigator={userAgent:ios?`iPhone ${iosBrowser}`:'Android Chrome',platform:ios?'iPhone':'Linux',maxTouchPoints:0};
 const document={querySelector:selector=>elements[selector],querySelectorAll:()=>[],createElement};
 if(dismissed)storage.set('cutly-install-dismissed-v1','1');
 vm.runInNewContext(pwaSource,{window,navigator,document,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
 for(const listener of events.DOMContentLoaded||[])listener();
 return {events,elements,storage,window};
}

test('service worker avoids private API caching and provides offline navigation fallback',async()=>{
 const handlers={},writes=[];const fallback=new Response('offline');
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/service-worker.js'),'utf8'),{
  URL,Response,Promise,self:{location:{origin:'https://cutly.test'},addEventListener:(kind,fn)=>handlers[kind]=fn,clients:{claim:async()=>{}}},
  caches:{match:async key=>key==='/offline.html'?fallback:null,open:async()=>({put:async(...args)=>writes.push(args),addAll:async()=>{}})},
  fetch:async()=>{throw new Error('offline');}
 });
 for(const request of [{method:'POST',url:'https://cutly.test/api/bookings'},{method:'GET',url:'https://cutly.test/api/client/profile'},{method:'GET',url:'https://elsewhere.test/icon.png'}]){
  handlers.fetch({request,respondWith(){assert.fail('Sensitive request intercepted');}});
 }
 let response;handlers.fetch({request:{method:'GET',url:'https://cutly.test/account.html',mode:'navigate'},respondWith(value){response=value;}});
 assert.equal(await(await response).text(),'offline');assert.equal(writes.length,0);
});

test('PWA manifest has standalone launch and valid install icons',()=>{
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.start_url,'/');
 const dimensions=file=>{const image=fs.readFileSync(file);return `${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`;};
 const icon192=manifest.icons.find(icon=>icon.sizes==='192x192');
 const icon512=manifest.icons.find(icon=>icon.sizes==='512x512');
 assert.ok(icon192&&fs.existsSync(path.join(__dirname,'../public',icon192.src.slice(1))));
 assert.ok(icon512&&icon512.purpose.includes('maskable')&&fs.existsSync(path.join(__dirname,'../public',icon512.src.slice(1))));
 assert.equal(dimensions(path.join(__dirname,'../public',icon192.src.slice(1))),'192x192');
 assert.equal(dimensions(path.join(__dirname,'../public',icon512.src.slice(1))),'512x512');
 assert.ok(fs.existsSync(path.join(__dirname,'../public/icons/apple-touch-icon.png')));
 assert.equal(dimensions(path.join(__dirname,'../public/icons/apple-touch-icon.png')),'180x180');
});

test('first browser visit opens the install prompt and closing it is remembered',()=>{
 const {elements,storage}=runPwa();
 assert.equal(elements['#install-dialog'].open,true);
 elements['[data-install-later]'].listeners.click();
 assert.equal(elements['#install-dialog'].open,false);
 assert.equal(storage.get('cutly-install-dismissed-v1'),'1');
 assert.equal(runPwa({dismissed:true}).elements['#install-dialog'].open,false);
});

test('installed standalone app skips the install prompt',()=>{
 const {elements}=runPwa({standalone:true});
 assert.equal(elements['#install-dialog'].open,false);
});

test('iPhone fallback gives Safari home-screen instructions without claiming installation',()=>{
 const {elements,window}=runPwa({ios:true});
 elements['[data-install-app]'].listeners.click();
 assert.equal(elements['[data-install-help]'].hidden,false);
 assert.match(elements['[data-install-help-title]'].textContent,/iPhone/);
 assert.equal(elements['[data-install-help-steps]'].children.length,3);
 assert.equal(elements['[data-install-status]'].textContent,'');
});

test('iPhone browsers other than Safari direct the user to Safari for installation',()=>{
 const {elements}=runPwa({ios:true,iosBrowser:'CriOS'});
 elements['[data-install-app]'].listeners.click();
 assert.match(elements['[data-install-help-steps]'].children[0].textContent,/ouvrez cette page dans Safari/i);
});

test('native install prompt is only requested after the user clicks',async()=>{
 const {elements}=runPwa();
 let prompted=false,prevented=false;
 const captured={};
 const sandboxWindow={matchMedia:()=>({matches:false}),addEventListener:(name,fn)=>(captured[name]??=[]).push(fn)};
 const sandboxNavigator={userAgent:'Android Chrome',platform:'Linux',maxTouchPoints:0};
 const sandboxDocument={querySelector:selector=>elements[selector],querySelectorAll:()=>[],createElement};
 vm.runInNewContext(pwaSource,{window:sandboxWindow,navigator:sandboxNavigator,document:sandboxDocument,localStorage:{getItem:()=>null,setItem(){}}});
 for(const listener of captured.DOMContentLoaded||[])listener();
 assert.equal(prompted,false);
 const installEvent={preventDefault(){prevented=true;},prompt:async()=>{prompted=true;},userChoice:Promise.resolve({outcome:'accepted'})};
 captured.beforeinstallprompt[0](installEvent);
 assert.equal(prevented,true);
 assert.equal(elements['[data-install-app]'].hidden,false);
 assert.equal(prompted,false);
 await elements['[data-install-app]'].listeners.click();
 assert.equal(prompted,true);
 assert.match(elements['[data-install-status]'].textContent,/Installation lancée/);
});
