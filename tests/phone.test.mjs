import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newMeasurement,requestRestore,observeRestore,evidenceSummary} from '../web/measurement.js';
import {makeRecord,exportJSON,exportCSV,loadJournal} from '../web/core.js';
import {createRun,previewQueue,availableModes,QueueRunner,retryItems} from '../web/queue.js';
import {buildRequest,configForSample} from '../web/providers.js';
import {mikaiEmbedChoices} from '../web/catalog.js';
import {createAdapter} from '../server/adapter.mjs';
import {privateSearch} from '../web/backend.js';
const samples=JSON.parse(await readFile(new URL('../web/data/samples.json',import.meta.url)));
const dune=samples.find(s=>s.key==='dune'),fallout=samples.find(s=>s.key==='fallout');
test('restore completion is a confirmed position, separate from resumed progress and full-watch completion',()=>{
 const m=newMeasurement();requestRestore(m,14.77,'saved-native-position');
 assert.equal(observeRestore(m,{position:14.77,seeking:true,event:'timeupdate'}),false);
 assert.equal(m.commands.restore.completed,false);
 observeRestore(m,{position:14.78,seeking:false,event:'seeked'});assert.equal(m.commands.restore.completed,true);assert.equal(m.commands.restore.status,'observed');assert.equal(m.commands.restore.playbackResumed,false);assert.equal(m.completed,false);
 observeRestore(m,{position:15.3,seeking:false,event:'progress'});assert.equal(m.commands.restore.playbackResumed,true);assert.equal(m.watchSeconds,0);
});
test('legacy manual iframe video survives load and export as useful manual evidence without technical promotion',()=>{
 const r=makeRecord(configForSample('vidzee','embed',dune),{vpn:'unknown'});r.layers.mainVideo={status:'observed-manual',source:'manual'};r.manualConfirmations.push({field:'mainVideo',value:true,source:'manual'});
 const old=loadJournal({getItem:()=>JSON.stringify({schemaVersion:2,records:[r]})});const copy=JSON.stringify(old.records);
 const out=JSON.parse(exportJSON(old.records));assert.equal(out.records[0].evidenceLevel,'L0');assert.equal(out.records[0].evidence.manualMainVideo,true);assert.match(out.records[0].evidence.summary,/подтверждено вручную/);assert.equal(out.records[0].environment.vpn,'unknown');assert.equal(JSON.stringify(old.records),copy);assert.match(exportCSV(old.records),/manualMainVideo/);
 r.manualConfirmations.push({field:'mainVideo',value:false,source:'manual'});assert.equal(evidenceSummary(r).manualMainVideo,false);
});
test('pre-1.3 journals missing new track-option fields migrate without losing notes or conditions',()=>{
 const r=makeRecord(configForSample('vidzee','embed',dune),{vpn:'unknown'});delete r.details.audioAlternatives;delete r.details.qualityAlternatives;r.details.voice='English — owner observation in this variant';r.details.notes='Historical note';
 const out=loadJournal({getItem:()=>JSON.stringify({schemaVersion:1,records:[r]})});assert.equal(out.error,null);assert.equal(out.records[0].details.audioAlternatives,'');assert.equal(out.records[0].details.qualityAlternatives,'');assert.equal(out.records[0].details.voice,r.details.voice);assert.equal(out.records[0].details.notes,r.details.notes);assert.equal(out.records[0].environment.vpn,'unknown');
});
test('a resumed attempt snapshots new VPN conditions while run and past attempts remain unchanged',async()=>{
 const mode=availableModes().find(m=>m.key==='yapgrid:embed'),run=createRun(previewQueue([mode],[dune]),{environment:{vpn:'unknown'},maxSeconds:1});run.profile.spacingMs=0;
 const runner=new QueueRunner({execute:async()=>{throw Object.assign(new Error('fixture title failed'),{code:'not-found'});}});
 await runner.start(run,{environment:{vpn:'off',confirmationSource:'manual-conditions-form'}});const before=JSON.stringify(run.queue[0].attempts[0]);retryItems(run,[run.queue[0].testId]);await runner.start(run,{environment:{vpn:'on',confirmationSource:'manual-conditions-form'}});
 assert.equal(JSON.stringify(run.queue[0].attempts[0]),before);assert.equal(run.environment.vpn,'unknown');assert.equal(run.queue[0].attempts[1].environment.vpn,'on');assert.equal(run.queue[0].attempts[1].previousAttemptId,run.queue[0].attempts[0].attemptId);
});
test('sandbox blocker stops a mode immediately; title-not-found never stops the next title',async()=>{
 for(const [code,callsExpected] of [['lab-sandbox',1],['not-found',2]]){
  const mode=availableModes().find(m=>m.key==='yapgrid:embed'),run=createRun(previewQueue([mode],[dune,fallout]),{maxSeconds:1});run.profile.spacingMs=0;let calls=0;
  await new QueueRunner({execute:async()=>{calls++;throw Object.assign(new Error('fixture'),{code});}}).start(run);assert.equal(calls,callsExpected);
  if(code==='lab-sandbox'){const skipped=run.queue.find(i=>i.status==='skipped');retryItems(run,[skipped.testId]);assert.equal(skipped.status,'pending');}
 }
});
test('Mikai embed requires fresh exact episode and known HTTPS source, preserving release provenance',()=>{
 const c={id:'52299',year:2024,episode:'1.5'};const d={ok:true,result:{anime:{ids:{mal:52299},year:2024},releases:[{id:7,kind:'sub',teams:[{name:'Fixture UA'}],episodes:[{number:1.5,sources:[{provider:'Ashdi',embedUrl:'https://ashdi.vip/fixture'},{provider:'Unexpected',embedUrl:'https://private.example/fixture'},{provider:'VK Video',embedUrl:'https://ashdi.vip/excluded'}]}]}]}};
 const a=mikaiEmbedChoices(d,c);assert.equal(a.length,1);assert.equal(a[0].episode,1.5);assert.deepEqual(a[0].teams,['Fixture UA']);assert.throws(()=>mikaiEmbedChoices(d,{...c,episode:1}),/эпизод/);
});
test('all added frame paths come from exact research grammars; open diagnostics require explicit new consent',()=>{
 const c=configForSample('movpi','embed',fallout);assert.equal(buildRequest(c).url,'https://moviesapi.to/tv/106379-1-1');
 assert.equal(buildRequest(configForSample('collaps','embed',dune)).url,'https://api.luxembd.ws/embed/kp/4540126');
 assert.equal(buildRequest({...configForSample('vidlink','embed',dune),sandbox:'documented',unrestrictedConsent:true,diagnosticConsentVersion:2}).sandbox,null);
 assert.throws(()=>buildRequest({...configForSample('vidlink','embed',dune),sandbox:'documented',diagnosticConsentVersion:2}));
});
test('125 stage outcomes are traceable and excluded / shared / partner entities cannot silently become independent catalogs',async()=>{
 const r=JSON.parse(await readFile(new URL('../web/data/registry.json',import.meta.url)));assert.equal(r.length,125);
 for(const p of r){assert.ok(p.stageReview?.reason);assert.ok(p.stageReview?.nextAction);assert.ok(p.stageReview?.checksPerformed.length);assert.equal(p.stageReview.originalResearchStatus,p.status);}
 assert.equal(r.find(p=>p.id==='X03').stageReview.outcome,'partner');assert.equal(r.find(p=>p.id==='L043').stageReview.independentLibrary,false);assert.equal(r.find(p=>p.id==='C09').stageReview.outcome,'excluded');
});
test('owned Kodik search reaches a selected official iframe through the client API without exposing its credential',async()=>{
 const origin='https://mawrikborug.github.io',key='FIXTURE_PRIVATE_UPSTREAM_VALUE',env={KADR_ALLOWED_ORIGIN:origin,KADR_ADAPTER_ACCESS_TOKEN:'fixture-lab-password',KODIK_API_KEY:key};let upstream;
 const handler=createAdapter({env,fetcher:async u=>{upstream=String(u);return new Response(JSON.stringify({results:[{id:'fixture',title:'Fixture '+key,year:2024,link:'https://kodik.info/serial/fixture/hash/720p',translation:{title:'Fixture voice'}},{id:'bad',title:'Bad',link:'https://unapproved.example/player'}]}));}});
 const result=await privateSearch({title:'Fixture',season:1,episode:1},{endpoint:'https://backend.example/api/adapter',accessToken:env.KADR_ADAPTER_ACCESS_TOKEN,fetcher:async(_url,opts)=>handler(new Request('https://backend.example/v1/check',{...opts,headers:{...opts.headers,origin}}))});
 assert.ok(upstream.includes(key));assert.equal(result.choices.length,1);assert.equal(result.choices[0].origin,'https://kodik.info');assert.ok(!JSON.stringify(result).includes(key));assert.match(result.choices[0].title,/redacted/);
});
