// Owner-only bounded live calls. Never imports expected titles into a model prompt.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import {Models,validateImages,reviewText,generateAnalysis} from '../server/models.mjs';
import {Sources} from '../server/sources.mjs';

const out='artifacts/ai-live-eval';await mkdir(out,{recursive:true});
const report={schema:'kadr.ai-user-live-eval.v1',createdAt:new Date().toISOString(),git:process.env.GITHUB_SHA,cases:[],requests:[],
  inferenceMax:16,notPublishedProductQuality:true,physicalIPhone:'NOT_RUN',tmdbLive:false};
let starts=0,last=0;
const signal=AbortSignal.timeout(1800000);
const admission={checkpoint:async()=>{signal.throwIfAborted();},beforeCall:async()=>{
  if(starts>=16)throw Error('LIVE_EVAL_REQUEST_CAP');
  if(last)await delay(Math.max(0,last+65000-Date.now()),undefined,{signal});starts++;last=Date.now();
}};
async function save(){await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
function client(name){
  const m=new Models(process.env,admission,signal,()=>{}),original=m.call.bind(m);
  m.call=async spec=>{const idx=report.requests.length,usedBefore=m.usage.length;report.requests.push({case:name,index:idx,status:'STARTING'});await save();
    try{
      const response=await original(spec);report.requests[idx]={case:name,...m.usage.at(-1)};
      await writeFile(`${out}/${idx}-request.json`,JSON.stringify({...spec,images:spec.images?.map(()=>({pixels:'control JPEG in repository; no filename/title supplied'}))},null,2));
      await writeFile(`${out}/${idx}-response.json`,JSON.stringify(response,null,2));await save();return response;
    }catch(e){report.requests[idx]={case:name,...(m.usage.length>usedBefore?m.usage.at(-1):{}),error:{code:e.code||'ERROR',message:e.message}};await save();throw e;}
  };return m;
}
await save();
// Cases use only neutral filenames. Evaluator manifest is not read by this runner.
for(const number of (process.argv.includes('--review-only')?[]:process.argv.includes('--followup')?['01','03']:['01','02','03','04','05','06','07'])){
 const id='image-'+number,m=client(id);const row={id,kind:'LIVE_INFERENCE_REAL_LICENSED_PIXELS'};report.cases.push(row);
 try{
  let raw=await readFile(`tests/fixtures/ai-controls/control-${number}.jpg`);
  // Same client dimensions/quality, orientation and server normalization policy.
  raw=await sharp(raw).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:94}).toBuffer();
  const images=await validateImages(['data:image/jpeg;base64,'+raw.toString('base64')]);row.image=images.metadata;
  row.response=await m.call({vision:true,structured:true,images:images.images,output:700,
    system:'Identify film/TV from actual pixels. Similarity is not identity. Return JSON; unknown is valid.',
    prompt:'Identify from pixels. Return {"hypotheses":[{"title":"original title","year":2000,"type":"movie|tv","clues":"observed clues"}],"visual_queries":["2-4 objective English visible keywords and medium, alternative wording"],"uncertain":true}. Max3 hypotheses,2 queries. No guessed title/year/duration/city in queries. Consider independent films.'});
 }catch(e){row.error={code:e.code,message:e.message};await save();if(e.code==='MODEL_HTTP'||e.code==='MODEL_RATE_LIMIT')break;}
 await save();
}
const film={id:45745,type:'movie',title:'Sintel',original:'Sintel',year:2010,imdb:'tt1727587',runtime:null,url:'https://www.themoviedb.org/movie/45745'};
let filmDossier;
try{
 const s=new Sources(signal);filmDossier=await s.acquire(film,null,await s.finality(film,null));
 // No expected-error list or evaluation guidance enters this independent reviewer.
 const m=client('rejected-sintel-regression'),text=await readFile('tests/fixtures/ai-controls/rejected-sintel-response.md','utf8');
 const result=await reviewText(m,filmDossier,text);report.cases.push({id:'rejected-sintel-regression',kind:'LIVE_REVIEW_OF_SAVED_WRONG_OUTPUT_CURRENT_AUTOMATIC_SOURCES',result});await save();
}catch(e){report.cases.push({id:'rejected-sintel-regression',error:{code:e.code,message:e.message}});await save();}
for(const kind of (process.argv.includes('--review-only')?[]:['film','season'])){
 const row={id:'analysis-'+kind,kind:'LIVE_AUTOMATIC_SOURCE_GENERATION_REVIEW_NOT_LIVE_TMDB_END_TO_END'};report.cases.push(row);
 try{
  let dossier=filmDossier;
  if(kind==='season'){
   const card={id:106379,type:'tv',title:'Fallout',original:'Fallout',year:2024,imdb:'tt12637874',url:'https://www.themoviedb.org/tv/106379'};
   const season={number:1,revision:'EVALUATOR_ONLY_COMPOSITION_NO_LIVE_TMDB',episodes:Array.from({length:8},(_,i)=>({id:i+1,number:i+1}))};
   const source=new Sources(signal),finality=await source.finality(card,season);row.finality={...finality,documents:undefined};
   if(finality.state!=='confirmed')throw Error('OFFICIAL_FINALITY_NOT_CONFIRMED');dossier=await source.acquire(card,season,finality);
  }
  if(!dossier)throw Error('NO_DOSSIER');row.result=await generateAnalysis(client(row.id),dossier);
  row.sources=dossier.references;row.modelInputs='Retrieved current sources; no manually prepared analysis';
 }catch(e){row.error={code:e.code,message:e.message};}
 await save();
}
report.completedAt=new Date().toISOString();report.attempted=report.requests.length;
report.actualTokens=report.requests.reduce((n,r)=>n+(r.usage?.total_tokens||0),0);await save();
console.log(JSON.stringify({attempted:report.attempted,actualTokens:report.actualTokens,cases:report.cases.map(x=>({id:x.id,status:x.error?'ERROR':x.result?.status||x.result?.verdict||'RESPONSE'}))}));
