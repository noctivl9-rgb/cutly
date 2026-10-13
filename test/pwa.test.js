const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
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
