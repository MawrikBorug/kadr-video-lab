import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {Admission} from '../server/admission.mjs';
import {execute} from '../server/app.mjs';
import {sign,unseal,Failure} from '../server/core.mjs';
import {validateImages,generateAnalysis,recognize} from '../server/models.mjs';

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
 await assert.rejects(a.reserve(),{code:'DUPLICATE'});assert.equal([...records.keys()].filter(x=>x.includes('/budget/')).length,2);
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
 const calls=[],models={progress:()=>{},admission:{checkpoint:async()=>{}},call:async spec=>{
  calls.push(spec);return spec.structured?{verdict:'fail',coverage_complete:true,issues:[{reason:'identity contradiction'}],checked_fact_count:6}:'1. Summary\nUnverified prose';
 }};
 const result=await generateAnalysis(models,{scope:{id:'movie:1'},documents:[{id:'S1',text:'evidence'}],references:[],limitations:[]});
 assert.equal(calls.length,4);assert.equal(result.status,'rejected');assert.equal(result.text,null);assert.equal(result.reviews.length,2);
});
test('catalog existence alone is not a verified frame match; no fixture lookup',async()=>{
 const replies=[{hypotheses:[{title:'Example',year:2000,type:'movie',clues:'ambiguous'}]},{candidates:[{id:1,type:'movie',assessment:'ambiguous',reason:'insufficient distinguishing detail'}]}];
 const models={progress:()=>{},call:async()=>replies.shift()},catalog={search:async()=>[{id:1,type:'movie',year:2000,title:'Example',catalogVerified:true}]};
 const result=await recognize(models,catalog,{frames:[],description:'A synthetic story description.'});
 assert.equal(result.candidates[0].frameMatchVerified,false);assert.equal(result.candidates[0].assessment,'ambiguous');
});
