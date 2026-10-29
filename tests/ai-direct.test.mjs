import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Models,recognize,generateAnalysis} from '../server/models.mjs';
import {SECTIONS} from '../server/core.mjs';

const card=(id,title,year=2010,type='movie')=>({id,type,title,original:title,year,catalogVerified:true});
const fakeModels=reply=>({calls:[],progress:()=>{},admission:{checkpoint:async()=>{}},async call(spec){this.calls.push(spec);return reply;}});

test('a real frame reaches one vision request with user clues, without a caption relay',async()=>{
 const raw=await readFile('tests/fixtures/groq-eval/closure-media/sintel-2-1024.jpg');
 const image='data:image/jpeg;base64,'+raw.toString('base64');
 const models=fakeModels('Sintel | 2010 | movie'),catalog={search:async()=>[card(1,'Sintel')]};
 const result=await recognize(models,catalog,{frames:[image],description:'Короткая анимация про дракона'});
 assert.equal(models.calls.length,1);const call=models.calls[0];
 assert.equal(call.vision,true);assert.deepEqual(call.images,[image]);assert.equal(call.prompt,'Короткая анимация про дракона');
 assert.ok(!call.system.includes('Do not name a film'));assert.ok(!call.prompt.includes('sintel-2'));
 assert.equal(result.modelEvidence.directImageInput,true);assert.equal(result.candidates[0].frameMatchVerified,false);
});

test('description-only input needs one text request; a negative answer spends no catalogue requests',async()=>{
 const models=fakeModels('UNKNOWN');let searches=0;
 const result=await recognize(models,{search:async()=>{searches++;return [];}},{description:'Придуманная история, которую нельзя уверенно узнать.'});
 assert.equal(models.calls.length,1);assert.equal(models.calls[0].vision,false);assert.equal(models.calls[0].recognition,true);
 assert.deepEqual(models.calls[0].images,[]);assert.equal(searches,0);assert.equal(result.status,'not_found');
});

test('catalogue candidates survive approximate years and article differences, while unrelated titles do not',async()=>{
 const models=fakeModels('Batman | 2021 | movie');
 const catalog={search:async()=>[card(3,'Unrelated movie',2021),card(2,'The Batman',2022),card(1,'Batman',1989)]};
 const result=await recognize(models,catalog,{description:'Готэм, мрачный детектив и Загадочник.'});
 assert.deepEqual(result.candidates.map(x=>x.id),[2,1]);
 assert.ok(result.candidates.every(x=>x.assessment==='ambiguous'&&x.frameMatchVerified===false));
});

test('up to three hypotheses have fair catalogue representation and no duplicate cards',async()=>{
 const models=fakeModels('First | 2020 | movie\nSecond | ? | tv\nThird | 2000 | movie\nIgnored | 2001 | movie');
 const searches=[];const catalog={search:async title=>{searches.push(title);return title==='First'?[card(1,'First',2020),card(2,'First',1980)]:title==='Second'?[card(3,'Second',2022,'tv')]:[card(4,'Third',1999)];}};
 const result=await recognize(models,catalog,{description:'Описание с несколькими возможными произведениями.'});
 assert.deepEqual(searches,['First','Second','Third']);assert.deepEqual(result.candidates.map(x=>x.id),[1,3,4]);
});

test('full analysis generates once from identity alone with all nine sections and honest knowledge provenance',async()=>{
 const prose=SECTIONS.map((s,i)=>`${i+1}. ${s}\n\nСодержательный авторский разбор раздела ${i+1}.`).join('\n\n');
 const models=fakeModels(prose);
 const result=await generateAnalysis(models,{scope:{id:'movie:1',title:'Sintel',year:2010,privateToken:'DO_NOT_SEND'},documents:[],references:[],visualEvidenceIds:[]});
 assert.equal(models.calls.length,1);assert.equal(result.status,'generated');assert.equal(result.text,prose);
 assert.equal(result.observations.allSectionsPresent,true);assert.deepEqual(result.sources,[]);
 const payload=JSON.parse(models.calls[0].prompt);
 assert.equal(payload.sections.length,9);assert.ok(payload.sourcesNote.includes('No external sources were retrieved'));
 assert.ok(!models.calls[0].prompt.includes('DO_NOT_SEND'));assert.equal(models.calls[0].schema,undefined);
 assert.ok(!result.text.includes('Ограничение источников'));assert.equal(result.reviews,undefined);
});

test('optional context stays ordinary text; no quote extraction, visual source gate or exact-heading rejection',async()=>{
 const models=fakeModels('Полный связный разбор с другими заголовками, а не JSON.');
 const result=await generateAnalysis(models,{scope:{id:'tv:1',title:'Fallout',year:2024,season:1,privateFuture:'DO_NOT_SEND_FUTURE'},context:'Некоторый обычный контекст, без цитат и идентификаторов утверждений.'});
 assert.equal(result.status,'generated');assert.equal(result.observations.allSectionsPresent,false);assert.equal(models.calls.length,1);
 const payload=JSON.parse(models.calls[0].prompt);assert.equal(payload.work.season,1);assert.ok(payload.boundary.includes('Only season 1'));
 assert.ok(payload.additionalContext.includes('без цитат'));assert.ok(!models.calls[0].prompt.includes('DO_NOT_SEND_FUTURE'));
 assert.ok(models.calls[0].system.includes('interpretations'));assert.ok(!models.calls[0].system.includes('Use ONLY supplied'));
});

test('transport makes one plain-text call and prevents an accidental second model stage',async()=>{
 const saved=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url,...options});return {ok:true,status:200,json:async()=>({model:'openai/gpt-oss-120b',usage:{total_tokens:20},choices:[{finish_reason:'stop',message:{content:'Обычный полный текст'}}]})};};
 try{
  const models=new Models({GROQ_API_KEY:'synthetic-test-key'},{beforeCall:async()=>{}},AbortSignal.timeout(1000));
  assert.equal(await models.call({system:'Simple instruction',prompt:'A useful analysis',output:3200}),'Обычный полный текст');
  const body=JSON.parse(requests[0].body);assert.equal(body.response_format,undefined);
  await assert.rejects(models.call({system:'second stage',prompt:'should never spend'}),{code:'MODEL_BUDGET'});
  assert.equal(requests.length,1);
 }finally{globalThis.fetch=saved;}
});

test('long optional context is bounded with an explicit limitation and preserves the full output budget',async()=>{
 const models=fakeModels('Полный разбор, сгенерированный независимо от длины дополнительного текста.');
 const result=await generateAnalysis(models,{scope:{id:'movie:1',title:'Sintel',year:2010},context:'Длинный необязательный материал о произведении. '.repeat(1500)});
 assert.equal(models.calls.length,1);assert.equal(models.calls[0].output,3200);
 assert.equal(result.status,'generated');assert.equal(result.observations.contextTruncated,true);
 assert.ok(result.limitations.some(x=>x.includes('контекст сокращён')));
 assert.ok(models.calls[0].prompt.length<120000);
});

test('catalogue identity and credits are not described as retrieved plot evidence or verified facts',async()=>{
 const models=fakeModels('Полный разбор на основе знаний модели и каталожных метаданных.');
 await generateAnalysis(models,{scope:{id:'movie:1',title:'Sintel',year:2010},contextMode:'model_knowledge_with_catalog_metadata',documents:[{title:'TMDB metadata',text:'Cast and identity only'}]});
 const payload=JSON.parse(models.calls[0].prompt);
 assert.ok(payload.sourcesNote.includes('No independent plot article or web fact-check'));
 assert.ok(payload.sourcesNote.includes('model knowledge'));
});

test('blank successful provider text is a malformed response, without a second request',async()=>{
 const saved=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return {ok:true,status:200,json:async()=>({model:'openai/gpt-oss-120b',usage:{},choices:[{finish_reason:'stop',message:{content:' \n\t '}}]})};};
 try{
  const models=new Models({GROQ_API_KEY:'synthetic-test-key'},{beforeCall:async()=>{}},AbortSignal.timeout(1000));
  await assert.rejects(models.call({system:'Write a useful analysis',prompt:'Sintel'}),{code:'MODEL_RESPONSE'});
  assert.equal(calls,1);
 }finally{globalThis.fetch=saved;}
});

 test('a short shared title word does not turn another franchise into a catalogue candidate',async()=>{
  const models={progress:()=>{},call:async()=>'The Ring | 2002 | movie'};
  const catalog={search:async()=>[
    {id:1,type:'movie',title:'The Ring',original:'The Ring',year:2002},
    {id:2,type:'movie',title:'The Lord of the Rings: The Fellowship of the Ring',original:'The Lord of the Rings: The Fellowship of the Ring',year:2001}]};
  const result=await recognize(models,catalog,{frames:[],description:'An uncertain title from a frame.'});
  assert.deepEqual(result.candidates.map(x=>x.id),[1]);
 });
