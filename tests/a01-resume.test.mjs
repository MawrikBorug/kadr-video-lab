import test from 'node:test';import assert from 'node:assert/strict';
import {resumePlan,checkpointSeconds} from '../diagnostics/a01/resume-query.mjs';
const base='https://mawrikborug.github.io/kadr-video-lab/a01/';
test('resume referrer exposes only public A01 path and bounded integer checkpoint',()=>{
 assert.deepEqual(resumePlan(base,230.136),{href:base+'?t=230',referrerPolicy:'unsafe-url',seconds:230});
 assert.equal(resumePlan(base+'?t=120').href,base);
 for(const href of [base+'?token=x',base+'#token=x','https://example.com/a01/','https://mawrikborug.github.io/kadr-video-lab/'])assert.throws(()=>resumePlan(href,120));
 for(const t of [0,-1,Infinity,NaN,86401])assert.throws(()=>resumePlan(base,t));
 assert.equal(checkpointSeconds({time:230.136,duration:888},{series:false}),230);
 assert.throws(()=>checkpointSeconds({time:230,duration:888},{series:true}));
 assert.throws(()=>checkpointSeconds(null,{}));
});
