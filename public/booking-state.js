(function(root){
 'use strict';
 const KEY='cutly-booking-v2';
 function read(storage){try{const value=JSON.parse(storage.getItem(KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
 function write(storage,patch){const old=read(storage),next={...old,...patch};if(['serviceId','date','time','rewardId'].some(key=>key in patch&&patch[key]!==old[key]))delete next.idempotencyKey;storage.setItem(KEY,JSON.stringify(next));return next;}
 function clear(storage){storage.removeItem(KEY);}
 const api={KEY,read,write,clear};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CutlyDraft=api;
})(typeof window!=='undefined'?window:globalThis);
