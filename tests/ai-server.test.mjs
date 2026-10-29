import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {Admission} from '../server/admission.mjs';
import {execute} from '../server/app.mjs';
import {sign,unseal,Failure} from '../server/core.mjs';
import {Models,validateImages,generateAnalysis,recognize} from '../server/models.mjs';
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
 await assert.rejects(a.reserve(),{code:'DUPLICATE'});assert.equal([...records.keys()].filter(x=>x.includes('/budget/')).length,3);
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
test('semantic rejection gets exactly one repair/re-review; rejected prose never returned',async()=>{
 const headings=['Краткое резюме','Сюжет и финал','Смысл','Детали и отсылки','Создание','Персонажи','Визуальный язык','Теории','Источники'];
 const calls=[],models={progress:()=>{},admission:{checkpoint:async()=>{}},call:async spec=>{
  calls.push(spec);
  if(spec.schema?.properties.replacements)return {replacements:[{index:0,text:'Still false prose'}]};
  if(spec.structured)return {checks:headings.map((_,index)=>({index,status:index===0?'contradicted':'supported',source_ids:['S1'],basis:'evidence'})),issues:[{reason:'identity contradiction'}]};
  return headings.map((s,i)=>`${i+1}. ${s}\n\nUnverified prose ${i}`).join('\n\n');
 }};
 const result=await generateAnalysis(models,{scope:{id:'movie:1'},documents:[{id:'S1',text:'evidence'}],references:[],limitations:[]});
 assert.equal(calls.length,4);assert.equal(result.status,'rejected');assert.equal(result.text,null);assert.equal(result.reviews.length,2);
});
test('catalog existence alone is not a verified frame match; no fixture lookup',async()=>{
 const replies=[{hypotheses:[{title:'Example',year:2000,type:'movie',clues:'ambiguous'}]},{candidates:[{index:0,assessment:'ambiguous',reason:'insufficient distinguishing detail'}]}];
 const models={progress:()=>{},call:async()=>replies.shift()},catalog={search:async()=>[{id:1,type:'movie',year:2000,title:'Example',catalogVerified:true}]};
 const result=await recognize(models,catalog,{frames:[],description:'A synthetic story description.'});
 assert.equal(result.candidates[0].frameMatchVerified,false);assert.equal(result.candidates[0].assessment,'ambiguous');
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
