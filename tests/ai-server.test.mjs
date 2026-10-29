import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {Admission,DAILY_SLOTS} from '../server/admission.mjs';
import {execute,basicAnalysisDossier} from '../server/app.mjs';
import {sign,unseal,Failure} from '../server/core.mjs';
import {Models,validateImages} from '../server/models.mjs';
import {Sources} from '../server/sources.mjs';

test('orientation is applied without cropping; image name never enters inference input',async()=>{
 const raw=await readFile('tests/fixtures/ai-controls/control-06.jpg');
 const result=await validateImages(['data:image/jpeg;base64,'+raw.toString('base64')]);
 assert.equal(result.metadata[0].orientationApplied,true);assert.ok(result.metadata[0].width>result.metadata[0].height);
 const normalized=await sharp(Buffer.from(result.images[0].split(',')[1],'base64')).metadata();assert.equal(normalized.orientation,undefined);
 await assert.rejects(validateImages(Array(4).fill(result.images[0])),{code:'IMAGES'});
});
test('admission is global atomic create, duplicate is not a new AI spend, quota failure closes',async()=>{
 const records=new Map();const storage={put:async(p,t)=>{if(records.has(p)){const e=Error('exists');e.name='BlobAlreadyExistsError';throw e;}records.set(p,JSON.parse(t));},head:async()=>{const e=Error();e.name='BlobNotFoundError';throw e;}};
 const a=new Admission({job:'00000000-0000-0000-0000-000000000001',operation:'recognize',storage});await a.reserve();
 await assert.rejects(a.reserve(),{code:'DUPLICATE'});assert.equal([...records.keys()].filter(x=>x.includes('/budget/')).length,0);
 await a.reserveCall();assert.equal([...records.keys()].filter(x=>x.includes('/budget/')).length,1);
 for(let i=1;i<DAILY_SLOTS;i++)await a.reserveCall();await assert.rejects(a.reserveCall(),{code:'DAILY_BUDGET'});
 assert.ok([...records.values()].every(x=>!JSON.stringify(x).includes('image')));
 const failing=new Admission({job:'00000000-0000-0000-0000-000000000002',operation:'recognize',storage:{put:async()=>{throw Error('offline');}}});
 await assert.rejects(failing.reserve(),{code:'LEDGER_UNAVAILABLE'});
});
test('server rejects forged/cross-session scope, unviewed episodes, unknown finality before AI',async()=>{
 const secret='synthetic-test-secret',session='u1',env={KADR_SESSION_SECRET:secret};
 const selection={kind:'selection',session,type:'tv',id:106379,season:1,revision:'r1',episodeIds:[11,12],exp:Date.now()+10000};
 await assert.rejects(execute({op:'confirm',proof:sign(selection,secret),watchedIds:[11]},{env,session}),{code:'EPISODES_NOT_WATCHED'});
 await assert.rejects(execute({op:'confirm',proof:sign(selection,secret),watchedIds:[11,12]},{env,session:'u2'}),{code:'SCOPE_PROOF'});
 const confirmed=await execute({op:'confirm',proof:sign(selection,secret),watchedIds:[11,12]},{env,session});
 assert.equal(unseal(confirmed.proof,secret).kind,'watched');
 class Catalog{async detail(){return {id:106379,type:'tv'};}async season(){return {revision:'r1'};}}
 class Sources{async finality(){return {state:'unknown',reason:'missing publisher evidence'};}}
 await assert.rejects(execute({op:'analysis',type:'tv',id:106379,season:1,proof:confirmed.proof},{env,session,factories:{Catalog,Sources}}),{code:'FINALITY_UNKNOWN'});
});
test('B04 publisher port admits only matching eight episodes and excludes future subtree',async()=>{
 const source=new Sources(AbortSignal.timeout(1000));
 source.publicHTML=async url=>url.includes('aboutamazon')?{hash:'synthetic-amazon',html:'<html><body><h1>Fallout</h1><div class="contentItem-role-text">Watch all eight episodes of Fallout Season 1. The final episode of Fallout Season 1 is discussed.</div><h2>Season 2</h2><div class="contentItem-role-text">SECRET FUTURE</div><h2>Less was more visually</h2><p>Creators reported camera and visual effects choices for season one.</p></body></html>'}:{hash:'synthetic-prime',html:'<html><head><title>Fallout - Staffel 1</title></head><body>'+Array.from({length:8},(_,i)=>`<h3>${i+1}. Episode</h3>`).join('')+'</body></html>'};
 const card={id:106379,type:'tv'},season={number:1,revision:'r1',episodes:Array.from({length:8},(_,i)=>({id:i+1,number:i+1}))};
 const result=await source.finality(card,season);assert.equal(result.state,'confirmed');assert.ok(!JSON.stringify(result.documents).includes('SECRET FUTURE'));
 const missing=await source.finality(card,{...season,episodes:season.episodes.slice(0,7)});assert.equal(missing.state,'unknown');
});
test('actual model preflight rejects excessive input before any inference admission',async()=>{
 let called=false;const m=new Models({GROQ_API_KEY:'synthetic'}, {beforeCall:async()=>{called=true;}},AbortSignal.timeout(1000));
 await assert.rejects(m.call({system:'test',prompt:'impossible oversized prompt '.repeat(10000),output:3600}),{code:'INPUT_BUDGET'});assert.equal(called,false);
});
test('a live TMDB Wikidata crosswalk still rejects conflicting work identifiers',async()=>{
 const source=new Sources(AbortSignal.timeout(1000));
 source.json=async()=>{throw Error('search index must not replace a supplied crosswalk');};
 source.entity=async()=>({id:'Q1',claims:{P4947:[{mainsnak:{datavalue:{value:'99'}}}]},sitelinks:{enwiki:{title:'Wrong work'}}});
 await assert.rejects(source.identity({id:1,type:'movie',wikidata:'Q1'}),{code:'SOURCE_IDENTITY_CONFLICT'});
});
test('season materials retain cast roles and every episode plot while excluding future content',async()=>{
 const source=new Sources(AbortSignal.timeout(1000)),qid='Q1';
 const html='<div class="mw-parser-output"><p>'+('Identity and background evidence. '.repeat(20))+'</p><h2>Cast and characters</h2><ul><li>Performer One as Character One</li></ul><h2>Episodes</h2><table>'+Array.from({length:8},(_,i)=>`<tr><td class="description">Episode ${i+1} contains its own distinct cause, character action and ending.</td></tr>`).join('')+'</table><h2>Season 2</h2><p>SECRET FUTURE CONTENT must never enter the selected-season materials.</p></div>';
 source.json=async(_u,p)=>p.action==='query'?{query:{pages:{1:{pageprops:{wikibase_item:qid}}}}}:{parse:{text:{'*':html}}};
 const r=await source.article({id:qid,sitelinks:{enwiki:{title:'Synthetic season'}}},1);
 assert.equal(r.episodeCount,8);assert.ok(r.text.includes('Performer One as Character One'));assert.ok(r.text.includes('Episode 8 contains'));assert.ok(!r.text.includes('SECRET FUTURE'));
});
test('role evidence stays on the server before watched confirmation',async()=>{
 class Catalog{async detail(){return{id:1,type:'tv',cast:[{character:'PRIVATE_ROLE_EVIDENCE'}],seasons:[]};}async season(){return{number:1,cast:[{character:'PRIVATE_ROLE_EVIDENCE'}],revision:'r1',episodes:[{id:11,number:1}]};}}
 class Sources{async finality(){return{state:'confirmed',references:[]};}}
 const r=await execute({op:'prepare',id:1,type:'tv',season:1},{env:{KADR_SESSION_SECRET:'synthetic-secret'},session:'s1',factories:{Catalog,Sources}});
 assert.equal(r.card.cast,undefined);assert.equal(r.season.cast,undefined);assert.ok(!JSON.stringify(r).includes('PRIVATE_ROLE_EVIDENCE'));
});

function directFixture({type='movie',enrich=false,after=false}={}){
 const secret='synthetic-session-secret',session='test-session';let calls=0,acquisitions=0,seasonReads=0,finalityReads=0;
 const card={id:1,type,title:'Example',original:'Example',year:2000,url:'https://www.themoviedb.org/'+type+'/1',overview:'Catalogue overview.'};
 const season={number:1,revision:'r1',episodes:[{id:11,number:1,title:'First'}]};
 class Catalog{async detail(){return card;}async season(){seasonReads++;return after&&seasonReads>1?{...season,revision:'changed'}:season;}}
 class Sources{async finality(){finalityReads++;return {state:'confirmed'};}async acquire(){acquisitions++;throw new Failure('NO_SOURCE','Unavailable optional article.');}}
 class Admission{async reserve(){}async checkpoint(){}}
 class Models{constructor(_e,admission,_s,progress){Object.assign(this,{admission,progress,usage:[]});}async call(){calls++;return '1. Краткое резюме\n\nAn ordinary generated draft without external quotes.';}}
 const proof=sign({kind:'watched',session,type,id:1,season:type==='tv'?1:null,revision:type==='tv'?'r1':null,episodeIds:type==='tv'?[11]:[],exp:Date.now()+10000},secret);
 return {run:()=>execute({op:'analysis',type,id:1,...(type==='tv'?{season:1}:{}),proof,enrichSources:enrich},
  {env:{KADR_SESSION_SECRET:secret},session,signal:AbortSignal.timeout(5000),factories:{Catalog,Sources,Admission,Models}}),counts:()=>({calls,acquisitions,seasonReads,finalityReads}),card,season};
}
test('analysis generates without fetching plot sources or requiring quote coverage',async()=>{
 const f=directFixture(),r=await f.run();assert.equal(r.status,'generated');assert.ok(r.text.includes('ordinary generated draft'));
 assert.deepEqual(f.counts(),{calls:1,acquisitions:0,seasonReads:0,finalityReads:1});
});
test('optional unavailable sources do not block generation or claim their retrieval',async()=>{
 const f=directFixture({enrich:true}),r=await f.run();assert.equal(r.status,'generated');assert.equal(f.counts().acquisitions,1);assert.equal(f.counts().calls,1);
 assert.ok(r.limitations.some(t=>t.includes('недоступны')));assert.ok(r.sources.every(s=>s.id==='T1'));
});
test('generated season is rechecked before return; changed composition blocks delivery',async()=>{
 const normal=directFixture({type:'tv'});const result=await normal.run();assert.equal(result.status,'generated');assert.equal(normal.counts().seasonReads,2);assert.equal(normal.counts().finalityReads,2);
 const changed=directFixture({type:'tv',after:true});await assert.rejects(changed.run(),{code:'COMPOSITION_CHANGED'});assert.equal(changed.counts().calls,1);
});
test('season analysis context contains selected season only, never the full-series overview',()=>{
 const f=directFixture({type:'tv'});f.card.overview='FUTURE SERIES OVERVIEW';
 const d=basicAnalysisDossier(f.card,f.season);assert.equal(d.scope.season,1);assert.ok(!JSON.stringify(d).includes('FUTURE SERIES OVERVIEW'));assert.ok(d.documents[0].text.includes('First'));
});
