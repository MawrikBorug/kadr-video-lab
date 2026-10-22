import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionPieceStore} from '../web/piece-store.mjs';
const put=(s,i,b)=>new Promise((resolve,reject)=>s.put(i,b,e=>e?reject(e):resolve()));
const get=(s,i,opts)=>new Promise((resolve,reject)=>s.get(i,opts,(e,b)=>e?reject(e):resolve(b)));
const destroy=s=>new Promise((resolve,reject)=>s.destroy(e=>e?reject(e):resolve()));
test('piece stores isolate runs and support byte-range reads without whole-file Blob',async()=>{
  const a=new SessionPieceStore(4,{length:7,useMemory:true}),b=new SessionPieceStore(4,{length:7,useMemory:true});
  assert.notEqual(a.name,b.name);await put(a,0,new Uint8Array([1,2,3,4]));
  assert.deepEqual(await get(a,0,{offset:1,length:2}),new Uint8Array([2,3]));
  await assert.rejects(get(b,0,{}),/piece_not_available/);
  await put(b,0,new Uint8Array([5,6,7,8]));await destroy(a);
  assert.deepEqual(await get(b,0,{}),new Uint8Array([5,6,7,8]));await destroy(b);
});
