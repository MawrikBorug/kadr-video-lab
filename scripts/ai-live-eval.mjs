// Bounded direct-model diagnostic for an owner-provisioned local environment.
// For the deployed UI (including live TMDB), use check-ai-published.mjs instead.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Models,recognize,generateAnalysis} from '../server/models.mjs';
import {basicAnalysisDossier} from '../server/app.mjs';

const out='artifacts/ai-live-eval';await mkdir(out,{recursive:true});
const report={schema:'kadr.direct-ai-eval.v1',at:new Date().toISOString(),cases:[],requests:[],
  inferenceMax:5,tmdbLive:false,productQualityAccepted:false,physicalIPhone:'NOT_RUN'};
const signal=AbortSignal.timeout(600000);let starts=0,last=0;
const save=()=>writeFile(out+'/report.json',JSON.stringify(report,null,2));
const admission={checkpoint:async()=>signal.throwIfAborted(),beforeCall:async()=>{
  if(starts>=5)throw Error('REQUEST_CAP');if(last)await delay(Math.max(0,last+65000-Date.now()),undefined,{signal});starts++;last=Date.now();
}};
if(!process.env.GROQ_API_KEY){console.log('NOT_RUN: GROQ_API_KEY is not configured. No requests made.');process.exitCode=1;}
else{
 for(const control of ['control-08','control-02','control-07']){
  const models=new Models(process.env,admission,signal),row={id:control,route:'direct-original-pixels-no-live-catalog'};report.cases.push(row);
  try{
   const raw=await readFile(`tests/fixtures/ai-controls/${control}.jpg`);
   // No fixture labels, filenames or expectations enter recognition. This adapter intentionally
   // resolves no cards: the actual hypotheses remain reviewable without pretending TMDB was live.
   const result=await recognize(models,{search:async()=>[]},{frames:['data:image/jpeg;base64,'+raw.toString('base64')],description:''});
   row.hypotheses=result.modelEvidence;row.imageMetadata=result.imageMetadata;
  }catch(e){row.error={code:e.code||'ERROR'};}
  report.requests.push(...models.usage);await save();
  if(row.error)break;
 }
 if(!report.cases.some(c=>c.error))for(const seasonMode of [false,true]){
  const models=new Models(process.env,admission,signal),row={id:seasonMode?'analysis-season':'analysis-film',route:'direct-knowledge-baseline-with-fixed-identity'};report.cases.push(row);
  const card=seasonMode?{id:106379,type:'tv',original:'Fallout',year:2024,url:'https://www.themoviedb.org/tv/106379'}:
   {id:45745,type:'movie',original:'Sintel',year:2010,url:'https://www.themoviedb.org/movie/45745'};
  const season=seasonMode?{number:1,revision:'diagnostic-only',episodes:[]}:null;
  // This script measures model ability, not server access or live finality. The HTTPS flow
  // exercises those independently; no user watch proof is forged or production write made here.
  try{row.result=await generateAnalysis(models,basicAnalysisDossier(card,season));}catch(e){row.error={code:e.code||'ERROR'};}
  report.requests.push(...models.usage);await save();if(row.error)break;
 }
 report.completedAt=new Date().toISOString();await save();
 console.log(JSON.stringify({requests:starts,cases:report.cases.map(c=>({id:c.id,status:c.error?'ERROR':c.result?.status||'RESPONSE'}))}));
}
