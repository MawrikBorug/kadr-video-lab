import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PROVIDERS,buildRequest,LabError,configForSample} from '../web/providers.js';
import {availableModes,previewQueue,createRun,QueueRunner,retryItems,recoverRuns} from '../web/queue.js';
import {fetchJSON,parseCatalog} from '../web/catalog.js';
import {newMeasurement,sampleMeasurement,evidenceLevel,excludeUncertainAdWindow} from '../web/measurement.js';
import {makeRecord,exportJSON,exportCSV,loadJournal,saveJournal,mergeExports} from '../web/core.js';
import {completedE2,passedE1} from './fixtures.mjs';
const registry=JSON.parse(await readFile(new URL('../web/data/registry.json',import.meta.url)));
const samples=JSON.parse(await readFile(new URL('../web/data/samples.json',import.meta.url)));
const modes=availableModes(registry),dune=samples.find(s=>s.key==='dune');
const runFor=(provider='primesrc',mode='catalog')=>createRun(previewQueue(modes.filter(m=>m.key===provider+':'+mode),[dune]),{maxSeconds:1});
test('all 125 historical IDs, original statuses, dependencies and explicit excluded/test-object blockers survive import',()=>{
 assert.equal(registry.length,125);assert.equal(new Set(registry.map(r=>r.id)).size,125);
 assert.equal(registry.filter(r=>r.status==='требуется идентификация').length,73);
 for(const id of ['C07','C08','C09','C26','C12','C14','X32'])assert.ok(modes.find(m=>m.refId===id).issue);
 assert.ok(registry.find(r=>r.id==='X28').sharedUpstreams.includes('X11 Ashdi'));
});
test('queue preview preserves every selected combination and explicit reasons; controls precede catalogs',()=>{
 const selected=modes.filter(m=>['primesrc:catalog','yapgrid:embed','vokino:online','apple:media'].includes(m.key));
 const list=previewQueue(selected,[dune,samples.find(s=>s.canonicalId==='T07'),{key:'apple',title:'Apple control',type:'control'}]);
 assert.equal(list.length,12);assert.equal(list[0].refId,'CONTROL-APPLE');
 assert.equal(list.filter(i=>i.status==='pending').length,3);
 assert.ok(list.some(i=>i.reason?.code==='no-address'));assert.ok(list.some(i=>i.reason?.code==='auth-required'));assert.ok(list.some(i=>i.reason?.code==='unsupported-type'));
});
test('distinct documented iframe grammars and unknown television contracts are not conflated',()=>{
 const c=configForSample('vidlink','embed',dune);assert.equal(buildRequest(c).url,'https://vidlink.pro/movie/693134');
 assert.equal(buildRequest({...c,provider:'vidapi'}).url,'https://vaplayer.ru/embed/movie/693134');
 assert.equal(buildRequest({...c,provider:'vidzee'}).url,'https://player.vidzee.wtf/embed/movie/693134');
 assert.equal(buildRequest({...c,provider:'mapple',type:'tv',id:'106379',season:'1',episode:'1'}).url,'https://mapple.fun/watch/tv/106379-1-1');
 assert.equal(buildRequest({...c,provider:'primesrc'}).url,'https://primesrc.me/embed/movie?tmdb=693134');
 assert.throws(()=>buildRequest({...c,provider:'cinesrc',type:'tv'}),e=>e.code==='unsupported-type');
 assert.equal(buildRequest({...c,provider:'stellar'}).url,'https://stellar.rip/en/watch/embed/movie/693134?autoPlay=false&autoNext=false');
});
test('five-minute profile cannot be shortened and JSON app errors do not become success',async()=>{
 assert.throws(()=>createRun([],{profile:'five',maxSeconds:299}));
 assert.equal(createRun([],{profile:'five',maxSeconds:300}).profile.minimumSeconds,300);
 await assert.rejects(fetchJSON('https://fixture.example/',{fetcher:async()=>new Response('{"error":401}',{headers:{'content-type':'application/json'}})}),e=>e.code==='auth-required'&&e.httpStatus===200);
 await assert.rejects(fetchJSON('https://fixture.example/',{fetcher:async()=>new Response('{}',{status:429,headers:{'retry-after':'120','content-type':'application/json'}})}),e=>e.code==='rate-limited'&&e.retryAfter===120);
});
test('request timeout and malformed API data have separate classes',async()=>{
 await assert.rejects(fetchJSON('https://fixture.example/',{timeoutMs:15,fetcher:(_u,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))))}),e=>e.code==='timeout');
 await assert.rejects(fetchJSON('https://fixture.example/',{fetcher:async()=>new Response('not-json',{headers:{'content-type':'application/json'}})}),e=>e.code==='invalid-response');
});
test('runner executes sequentially, keeps terminal results and links new retry attempts',async()=>{
 const run=runFor();run.profile.spacingMs=0;let calls=0;
 const runner=new QueueRunner({execute:async()=>{calls++;if(calls===1)throw new LabError('media-error','fixture error');return {fixture:true};}});
 await runner.start(run);assert.equal(run.queue[0].status,'failed');const first=run.queue[0].attempts[0];
 retryItems(run,[run.queue[0].testId]);await runner.start(run);assert.equal(run.queue[0].status,'completed');
 const next=run.queue[0].attempts[1];assert.notEqual(first.attemptId,next.attemptId);assert.equal(next.previousAttemptId,first.attemptId);
 assert.equal(next.testId,first.testId);assert.equal(calls,2);
});
test('401 and rate limits stop only the affected mode and are never auto-retried',async()=>{
 const preview=previewQueue(modes.filter(m=>['primesrc:catalog','yapgrid:embed'].includes(m.key)),[dune,samples.find(s=>s.key==='fallout')]);
 const run=createRun(preview,{maxSeconds:1});run.profile.spacingMs=0;let active=0,maxActive=0;const calls=[];
 const runner=new QueueRunner({execute:async item=>{active++;maxActive=Math.max(maxActive,active);calls.push(item.modeKey);active--;if(item.modeKey==='primesrc:catalog')throw new LabError('auth-required','401');return {};}});
 await runner.start(run);assert.equal(maxActive,1);assert.equal(calls.filter(k=>k==='primesrc:catalog').length,1);assert.equal(calls.filter(k=>k==='yapgrid:embed').length,2);
 assert.equal(run.queue.find(i=>i.reason?.code==='mode-stopped').status,'skipped');
});
test('pause, reload recovery and resume preserve earlier results and produce a new attempt',async()=>{
 const run=runFor();run.profile.spacingMs=0;let started;const gate=new Promise(r=>started=r);
 const runner=new QueueRunner({execute:(_i,_a,{signal})=>{started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new LabError('interrupted','pause'))));}});
 const pending=runner.start(run);await gate;runner.stop('page-hidden','interrupted');await pending;
 const oldId=run.queue[0].attempts[0].attemptId;assert.equal(run.queue[0].status,'interrupted');
 const restored=recoverRuns(JSON.parse(JSON.stringify([run])))[0];const resumed=new QueueRunner({execute:async()=>({})});restored.profile.spacingMs=0;await resumed.start(restored);
 assert.equal(restored.queue[0].status,'completed');assert.equal(restored.queue[0].attempts[1].previousAttemptId,oldId);
});
test('repeated JSON/CSV export and merge retain partial queue, stable IDs and legacy observations',()=>{
 const r=makeRecord({provider:'yapgrid',stage:'E1',type:'movie',namespace:'tmdb',id:'693134',title:'Fixture'},{device:'unknown'});r.details.notes='Старые заметки';
 const legacy=loadJournal({getItem:()=>JSON.stringify({schemaVersion:1,records:[r]})});assert.equal(legacy.error,null);assert.equal(legacy.records[0].details.notes,r.details.notes);
 const run=runFor(),first=JSON.parse(exportJSON([r],undefined,[run])),second=JSON.parse(exportJSON([r],undefined,[run]));
 assert.equal(first.records[0].attemptId,second.records[0].attemptId);assert.equal(first.runs[0].queue[0].testId,second.runs[0].queue[0].testId);
 const merged=mergeExports(first,second);assert.equal(merged.records.length,1);assert.equal(merged.runs.length,1);
 const csv=exportCSV(merged.records,merged.runs);assert.match(csv,/pending/);assert.match(csv,/testId/);
 const memory=new Map();saveJournal({setItem:(k,v)=>memory.set(k,v)},merged.records,merged.runs);assert.equal(loadJournal({getItem:k=>memory.get(k)}).runs.length,1);
});
test('seek-to-end, repeated intervals, paused/hidden wall time and ads never create completion',()=>{
 const m=newMeasurement(),sample=(p,t,extra={})=>sampleMeasurement(m,{position:p,duration:100,now:t,visible:true,playing:true,seeking:false,mainVideo:true,...extra});
 sample(0,0);sample(1,1000);sample(2,2000);assert.equal(m.uniqueSeconds,2);
 sample(90,3000);sample(99,100000,{visible:false});m.ended=true;sample(100,101000,{playing:false});assert.equal(m.completed,false);assert.equal(m.uniqueSeconds,2);
 sample(0,102000);sample(1,103000);sample(2,104000);assert.equal(m.uniqueSeconds,2);
 sample(3,105000,{mainVideo:false});sample(4,106000,{mainVideo:false});assert.equal(m.uniqueSeconds,2);
 assert.equal(evidenceLevel({measurement:m,layers:{player:{status:'load-event-only'}}}),'L0');
});
test('export removes credentials and nested signed URLs in free text, structures and partial queue',()=>{
 const r=makeRecord({provider:'yapgrid',stage:'E1',title:'Fixture'},{device:'unknown'});r.details.notes='Bearer CANARY_PRIVATE_VALUE https://cdn.example/media?token=CANARY_PRIVATE_VALUE';r.technical.deep={api_key:'CANARY_PRIVATE_VALUE',url:'https://a.example/?query=https%3A%2F%2Fb.example%2F%3Ftoken%3DCANARY_PRIVATE_VALUE'};
 const run=runFor();run.queue[0].reason={nested:{cookie:'CANARY_PRIVATE_VALUE'}};
 for(const out of [exportJSON([r],undefined,[run]),exportCSV([r],[run])])assert.ok(!out.includes('CANARY_PRIVATE_VALUE'));
});
test('catalog normalizers retain fractional anime, source teams, empty variants and canonical TMDB',()=>{
 const c=configForSample('mikai','catalog',samples.find(s=>s.key==='solo'),{episode:'1.5'});
 const d={ok:true,result:{anime:{ids:{mal:52299},year:2024,titles:'Fixture'},licensed:false,releases:[{id:1,kind:'sub',teams:['Fixture UA'],episodes:[{number:1.5,sources:[{provider:'Ashdi',embedUrl:'https://ashdi.vip/example'}]},{number:1,sources:[]}]}]}};
 const normalized=parseCatalog('mikai',d,c);assert.equal(normalized.variants[0].episode,1.5);assert.equal(normalized.variants[0].kind,'sub');assert.equal(normalized.variants[0].language,'unknown-UA-oriented');
 const prime=parseCatalog('primesrc',{info:{title:'Fixture',imdb_id:dune.imdb,tmdb_id:dune.imdb},servers:[]},configForSample('primesrc','catalog',dune));assert.equal(prime.canonicalTMDB,'693134');assert.equal(prime.variants.length,0);
});
test('new post-roll and inserted ad observations cannot produce an ad-free PASS; historical five-category records retain meaning',()=>{
 const e1=passedE1(),e2=completedE2(e1);e2.ads.postRoll='NOT_RUN';
 let out=JSON.parse(exportJSON([e1,e2]));assert.equal(out.records[1].assessment.adFreeSessionStatus,'INCONCLUSIVE');
 e2.ads.postRoll='NOT_OBSERVED';e2.adBreaks.push({type:'post-roll',durationSeconds:4,source:'manual'});out=JSON.parse(exportJSON([e1,e2]));assert.equal(out.records[1].assessment.adFreeSessionStatus,'FAIL');
 e2.adBreaks=[];delete e2.ads.postRoll;delete e2.observationSchemaVersion;
 const old=loadJournal({getItem:()=>JSON.stringify({schemaVersion:1,records:[e1,e2]})});assert.equal(old.error,null);assert.equal(old.records[1].status,'PASS');assert.equal(old.records[1].ads.postRoll,'NOT_RUN');
});
test('an ad reported without a known boundary preserves uncertain evidence and does not count it as main video',()=>{
 const m=newMeasurement();m.intervals=[[0,20]];m.uniqueSeconds=20;m.watchSeconds=20;
 excludeUncertainAdWindow(m,'2026-10-19T00:00:00Z');assert.equal(m.watchSeconds,0);assert.equal(m.uniqueSeconds,0);assert.equal(m.mainVideo,false);assert.deepEqual(m.uncertainAdWindows[0].intervals,[[0,20]]);
});
test('transport controls cannot be cross-labelled as the other control object',()=>{
 const list=previewQueue(modes.filter(m=>['apple:media','blender:media'].includes(m.key)),[{key:'apple',title:'BipBop',type:'control'},{key:'blender',title:'Sintel',type:'control'}]);
 assert.equal(list.filter(i=>i.status==='pending').length,2);assert.equal(list.filter(i=>i.status==='skipped').length,2);
 assert.ok(list.filter(i=>i.status==='pending').every(i=>i.config.provider===i.config.sampleKey));
});
test('Mikai anime metadata does not prove an episode absent from the response',()=>{
 const c=configForSample('mikai','catalog',samples.find(s=>s.key==='solo'),{episode:'1.5'});
 const data={ok:true,result:{anime:{ids:{mal:52299},year:2024,titles:'Fixture'},releases:[{episodes:[{number:1,sources:[]}]}]}};
 const normalized=parseCatalog('mikai',data,c);assert.equal(normalized.identity,'episode-not-returned');assert.equal(normalized.episodeSelection.returned,false);assert.equal(normalized.variants.length,0);
});
