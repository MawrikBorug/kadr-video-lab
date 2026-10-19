import {PROVIDERS,MODE_NAMES,buildRequest,configForSample,modeIssue} from './providers.js';
export const PROFILES={quick:{name:'Быстрая диагностика',minimumSeconds:0,defaultSeconds:20},five:{name:'Не менее пяти минут main video',minimumSeconds:300,defaultSeconds:300},full:{name:'Полный сеанс',minimumSeconds:0,defaultSeconds:14400}};
export const TERMINAL=['completed','failed','timeout','auth-required','rate-limited','skipped','cancelled'];
export const nowMSK=utc=>new Date(Date.parse(utc)+10800000).toISOString().replace('Z','+03:00');
const uid=()=>crypto.randomUUID();
export function availableModes(registry=[]){
 const modes=[];
 for(const [provider,p] of Object.entries(PROVIDERS))for(const mode of p.modes){const issue=modeIssue(p,mode);modes.push({key:`${provider}:${mode}`,provider,mode,refId:p.refId,label:`${p.refId} · ${p.name} · ${MODE_NAMES[mode]}`,issue,priority:['apple','blender'].indexOf(provider)>=0?0:mode==='catalog'?1:2});}
 for(const p of registry)if(!Object.values(PROVIDERS).some(v=>v.refId===p.id)){
  const excluded=['excluded','out-of-scope'].includes(p.workingStatus),auth=p.status==='нужен собственный доступ';
  modes.push({key:`${p.providerKey}:unknown`,provider:p.providerKey,mode:'unknown',refId:p.id,label:`${p.id} · ${p.name}`,priority:3,issue:{code:excluded?'excluded':auth?'auth-required':p.status==='только инфраструктура'?'infrastructure':'unknown-contract',reason:p.id==='C26'?'Lumex вне текущей работы':p.id==='X32'?'VidFast: маршрут не установлен':p.id==='C12'?'Vimeo: старый demo недоступен, нужен свой разрешённый объект':p.id==='C14'?'PeerTube: нужен конкретный разрешённый UUID':p.reason,next:p.next}});
 }
 return modes;
}
export function previewQueue(modes,subjects,settings={}){
 const result=[],seen=new Set();
 for(const mode of [...modes].sort((a,b)=>a.priority-b.priority))for(const sample of subjects){
  const c=configForSample(mode.provider,mode.mode,sample,settings),key=`${mode.key}:${sample.canonicalId||sample.key}:${c.season}:${c.episode}`;
  if(seen.has(key))continue;seen.add(key);
  let issue=mode.issue;
  if(!issue && ((PROVIDERS[c.provider]?.types?.includes('control')) !== (sample.type==='control')))issue={code:'unsupported-type',reason:'Контроль транспорта — отдельный тестовый объект; его успех не переносится на N14.'};
  if(!issue&&['aniliberty','mikai','animeon'].includes(c.provider)&&settings.season&&Number(settings.season)!==Number(sample.season||1))issue={code:'no-address',reason:'Для этого сезона нужен отдельный ID релиза/профильная нумерация; прежний релиз не преобразуется автоматически.'};
  if(!issue)try{buildRequest(c);}catch(e){issue={code:e.code||'invalid-config',reason:e.message};}
  result.push({config:c,modeKey:mode.key,refId:mode.refId,upstream:PROVIDERS[c.provider]?.origin||mode.refId,status:issue?'skipped':'pending',reason:issue||null});
 }
 if(result.length>5000)throw new Error('За один запуск допускается до 5000 сочетаний. Сузьте выбор.');
 return result;
}
export function createRun(preview,{profile='quick',maxSeconds,environment={},build={}}={}){
 if(!PROFILES[profile])throw new Error('Неизвестный профиль.');
 maxSeconds=Number(maxSeconds??PROFILES[profile].defaultSeconds);
 if(!Number.isFinite(maxSeconds)||maxSeconds<Math.max(1,PROFILES[profile].minimumSeconds)||maxSeconds>14400)throw new Error('Предел профиля: 1–14400 секунд; пятиминутный профиль требует ≥300.');
 const at=new Date().toISOString();
 return {schemaVersion:2,runId:uid(),specVersion:'1.2',build,createdAt:at,createdAtMsk:nowMSK(at),updatedAt:at,environment,profile:{id:profile,maxSeconds,minimumSeconds:PROFILES[profile].minimumSeconds,concurrency:1,requestTimeoutSeconds:20,maxAutoRetries:1,spacingMs:1100},status:'ready',cursor:0,circuits:{},queue:preview.map(p=>({...p,testId:uid(),attempts:[]}))};
}
export function recoverRuns(runs){
 for(const run of runs){
  if(['running','awaiting-user','awaiting-manual'].includes(run.status)){run.status='interrupted';run.interruption='reload-or-unload';}
  for(const item of run.queue)if(['running','awaiting-user','awaiting-manual'].includes(item.status)){
   item.status='interrupted';const a=item.attempts.at(-1);if(a&&!a.endedAt){a.status='interrupted';a.endedAt=new Date().toISOString();a.error={code:'reload-or-unload'};}
  }
 }return runs;
}
export function retryItems(run,testIds){
 const ids=new Set(testIds);for(const item of run.queue)if(ids.has(item.testId)&&['failed','timeout','auth-required','rate-limited','interrupted','cancelled'].includes(item.status)){
  if(item.notBefore&&Date.parse(item.notBefore)>Date.now())continue;
  item.status='pending';item.reason=null;delete run.circuits[item.modeKey];
 }run.status='paused';return run;
}
export function queueSummary(run){
 const counts={};for(const item of run?.queue||[])counts[item.status]=(counts[item.status]||0)+1;
 return {total:run?.queue.length||0,counts,notice:'Завершённый шаг означает выполненную диагностику, а не воспроизведение всех фильмов. HTML, каталог и media — разные слои.'};
}
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();};const abort=()=>{clearTimeout(timer);reject(new Error('interrupted'));};const timer=setTimeout(done,ms);signal?.addEventListener('abort',abort,{once:true});});
export class QueueRunner{
 constructor({execute,onChange=()=>{}}){this.execute=execute;this.onChange=onChange;this.busy=false;}
 changed(){this.run.updatedAt=new Date().toISOString();this.onChange(this.run);}
 async start(run){
  if(this.busy)return;if(run.status==='cancelled')return;
  this.busy=true;this.run=run;run.status='running';this.changed();
  try{for(let i=0;i<run.queue.length&&run.status==='running';i++){
   const item=run.queue[i];if(!['pending','interrupted'].includes(item.status))continue;
   run.cursor=i;
   if(item.notBefore&&Date.parse(item.notBefore)>Date.now()){item.status='rate-limited';item.reason={code:'retry-after',reason:'Ждите Retry-After до нового запуска.'};this.changed();continue;}
   const circuit=run.circuits[item.modeKey];if(circuit?.open){item.status='skipped';item.reason={code:'mode-stopped',reason:`Режим остановлен после ${circuit.code}; другие режимы продолжаются.`};this.changed();continue;}
   this.item=item;this.controller=new AbortController();
   const at=new Date().toISOString(),previous=item.attempts.at(-1);
   const attempt={attemptId:uid(),testId:item.testId,previousAttemptId:previous?.attemptId||null,startedAt:at,startedAtMsk:nowMSK(at),status:'running',steps:[],recordId:null};
   item.attempts.push(attempt);item.status='running';this.changed();
   const setState=(state)=>{if(this.controller?.signal.aborted)return;item.status=state;run.status=state;this.changed();};
   try{
    const result=await this.execute(item,attempt,{signal:this.controller.signal,run,setState});
    if(!this.controller.signal.aborted){attempt.status='completed';item.status='completed';attempt.result=result;run.circuits[item.modeKey]={failures:0};}
   }catch(error){
    if(!this.controller.signal.aborted){
     const code=error.code||'app-error';item.status=['timeout','auth-required','rate-limited'].includes(code)?code:'failed';attempt.status=item.status;
     attempt.error={code,message:error.message,httpStatus:error.httpStatus??null,appStatus:error.appStatus??null,retryAfter:error.retryAfter??null};
     if(error.retryAfter)item.notBefore=new Date(Date.now()+error.retryAfter*1000).toISOString();
     const failures=(run.circuits[item.modeKey]?.failures||0)+1;run.circuits[item.modeKey]={failures,code,open:['auth-required','rate-limited'].includes(code)||failures>=2};
     // One bounded retry for transient errors; auth/403/geo and 429 are never retried automatically.
     if(['network-or-cors','timeout'].includes(code)&&item.attempts.length<=run.profile.maxAutoRetries&&!run.circuits[item.modeKey].open){item.status='pending';i--;}
    }
   }finally{
    attempt.endedAt??=new Date().toISOString();
    if(['awaiting-user','awaiting-manual'].includes(run.status))run.status='running';
    this.changed();
   }
   if(run.status==='running'){this.controller=new AbortController();try{await delay(run.profile.spacingMs,this.controller.signal);}catch{}}
  }
  if(run.status==='running')run.status='completed';
  }finally{this.busy=false;this.item=null;this.controller=null;this.changed();}
 }
 stop(reason='pause',state='paused'){
  if(!this.run)return;this.run.status=state;this.run.interruption=reason;
  if(this.item&&!TERMINAL.includes(this.item.status)){this.item.status='interrupted';const a=this.item.attempts.at(-1);a.status='interrupted';a.error={code:reason};}
  this.controller?.abort();this.changed();
 }
 skip(reason){
  if(!this.item||!reason.trim())return;
  this.item.status='skipped';this.item.reason={code:'manual-skip',reason:reason.trim(),source:'manual'};
  this.item.attempts.at(-1).status='skipped';this.controller?.abort();this.run.status='running';this.changed();
 }
 cancel(){this.stop('cancel','cancelled');for(const item of this.run.queue)if(['pending','interrupted'].includes(item.status)){item.status='cancelled';item.reason={code:'cancelled'};}this.changed();}
}
