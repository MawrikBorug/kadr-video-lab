import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {Admission} from '../server/admission.mjs';
import {execute} from '../server/app.mjs';
import {sign,unseal,Failure} from '../server/core.mjs';
import {Models,validateImages,generateAnalysis,recognize,reviewText,VISUAL_GAP_NOTICE} from '../server/models.mjs';
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
 for(let i=1;i<40;i++)await a.reserveCall();await assert.rejects(a.reserveCall(),{code:'DAILY_BUDGET'});
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
 const result=await generateAnalysis(models,{scope:{id:'movie:1'},documents:[{id:'S1',text:'evidence'}],visualEvidenceIds:['S1'],references:[],limitations:[]});
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
test('a live TMDB Wikidata crosswalk still rejects conflicting work identifiers',async()=>{
 const source=new Sources(AbortSignal.timeout(1000));
 source.json=async()=>{throw Error('search index must not replace a supplied crosswalk');};
 source.entity=async()=>({id:'Q1',claims:{P4947:[{mainsnak:{datavalue:{value:'99'}}}]},sitelinks:{enwiki:{title:'Wrong work'}}});
 await assert.rejects(source.identity({id:1,type:'movie',wikidata:'Q1'}),{code:'SOURCE_IDENTITY_CONFLICT'});
});
test('a model false pass cannot admit visual prose without visual evidence',async()=>{
 const headings=['Краткое резюме','Сюжет и финал','Смысл','Детали и отсылки','Создание','Персонажи','Визуальный язык','Теории','Источники'];
 const text=headings.map((h,i)=>`${i+1}. ${h}\n\nSynthetic factual paragraph ${i}.`).join('\n\n');
 const models={call:async()=>({checks:headings.map((_,index)=>({index,status:'supported',source_ids:['S1'],basis:'Synthetic model falsely declares all paragraphs supported.'})),issues:[]})};
 const r=await reviewText(models,{documents:[{id:'S1',text:'Plot prose only.'}],visualEvidenceIds:[]},text);
 assert.equal(r.verdict,'fail');assert.equal(r.checks[6].modelStatus,'supported');assert.equal(r.checks[6].status,'unsupported');assert.equal(r.serverIssues.length,1);
 const gapText=text.replace('Synthetic factual paragraph 6.','В источниках отсутствуют данные для анализа света и цвета.');
 models.call=async()=>({checks:headings.map((_,index)=>({index,status:'supported',evidence_gap_only:index===6,source_ids:['S1'],basis:'The source contains only plot prose and no visual observations.'})),issues:[]});
 const honest=await reviewText(models,{documents:[{id:'S1',text:'Plot prose only.'}],visualEvidenceIds:[]},gapText);
 assert.equal(honest.verdict,'pass');assert.equal(honest.serverIssues.length,0);
});
test('season materials retain cast roles and every episode plot while excluding future content',async()=>{
 const source=new Sources(AbortSignal.timeout(1000)),qid='Q1';
 const html='<div class="mw-parser-output"><p>'+('Identity and background evidence. '.repeat(20))+'</p><h2>Cast and characters</h2><ul><li>Performer One as Character One</li></ul><h2>Episodes</h2><table>'+Array.from({length:8},(_,i)=>`<tr><td class="description">Episode ${i+1} contains its own distinct cause, character action and ending.</td></tr>`).join('')+'</table><h2>Season 2</h2><p>SECRET FUTURE CONTENT must never enter the selected-season materials.</p></div>';
 source.json=async(_u,p)=>p.action==='query'?{query:{pages:{1:{pageprops:{wikibase_item:qid}}}}}:{parse:{text:{'*':html}}};
 const r=await source.article({id:qid,sitelinks:{enwiki:{title:'Synthetic season'}}},1);
 assert.equal(r.episodeCount,8);assert.ok(r.text.includes('Performer One as Character One'));assert.ok(r.text.includes('Episode 8 contains'));assert.ok(!r.text.includes('SECRET FUTURE'));
});
test('known visual-source gap is labelled as server text; every generated block is reviewed',async()=>{
 const headings=['Краткое резюме','Сюжет и финал','Смысл','Детали и отсылки','Создание','Персонажи','Визуальный язык','Теории','Источники'];let calls=0;
 const models={progress:()=>{},admission:{checkpoint:async()=>{}},call:async spec=>{
  calls++;if(!spec.schema)return headings.map((h,i)=>`${i+1}. ${h}\n\n${i===6?'Unsupported appearance claim.':'Synthetic source-backed paragraph.'}`).join('\n\n');
  const payload=JSON.parse(spec.prompt.slice(spec.prompt.indexOf('{')));assert.equal(payload.blocks.length,8);
  assert.ok(!spec.prompt.includes('Unsupported appearance claim'));assert.ok(!spec.prompt.includes(VISUAL_GAP_NOTICE));
  return {checks:payload.blocks.map(b=>({index:b.index,status:'supported',source_ids:['S1'],evidence_gap_only:false,basis:'Synthetic source supports the supplied fictional test paragraph.'})),issues:[]};
 }};
 const r=await generateAnalysis(models,{scope:{id:'movie:1'},documents:[{id:'S1',text:'Synthetic evidence.'}],references:[],visualEvidenceIds:[],limitations:[]});
 assert.equal(r.status,'verified');assert.equal(calls,2);assert.ok(r.text.includes(VISUAL_GAP_NOTICE));assert.equal(r.systemNotices[0].origin,'server');
});
