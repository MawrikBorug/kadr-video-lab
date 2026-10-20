// Optional server-only component. Never copied into dist, never accepts arbitrary URLs.
import {createHash,timingSafeEqual} from 'node:crypto';
import {applicationError} from '../web/catalog.js';
import {kodikChoices} from './playback.mjs';
const digest=s=>createHash('sha256').update(String(s)).digest();
const reply=(status,body,origin)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':origin,'vary':'Origin'}});
export function createAdapter({env=process.env,fetcher=fetch,clock=Date.now}={}){
 let day='',daily=0,minute=0,minCount=0,busy=false;
 return async request=>{
  const origin=env.KADR_ALLOWED_ORIGIN;
  if(!origin||!/^https:\/\/[^/?#]+$/.test(origin)||!env.KADR_ADAPTER_ACCESS_TOKEN)return reply(503,{code:'adapter-not-configured'},'null');
  if(request.headers.get('origin')!==origin)return reply(403,{code:'origin-denied'},origin);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST','access-control-allow-headers':'authorization, content-type','access-control-max-age':'300'}});
  if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/check')return reply(404,{code:'operation-denied'},origin);
  if(!timingSafeEqual(digest(request.headers.get('authorization')),digest('Bearer '+env.KADR_ADAPTER_ACCESS_TOKEN)))return reply(401,{code:'private-lab-access-required'},origin);
  const at=clock(),today=new Date(at).toISOString().slice(0,10),currentMinute=Math.floor(at/60000);
  if(day!==today){day=today;daily=0;}if(minute!==currentMinute){minute=currentMinute;minCount=0;}
  if(busy||daily>=100||minCount>=10)return reply(429,{code:'lab-budget-limit',retryAfter:60},origin);
  let b;try{const raw=await request.text();if(raw.length>4096)throw new Error();b=JSON.parse(raw);}catch{return reply(400,{code:'invalid-request'},origin);}
  if(!b||Object.keys(b).some(k=>!['provider','operation','id','title','type','season','episode'].includes(k)))return reply(400,{code:'unexpected-field'},origin);
  if((b.season!==undefined&&!/^[1-9]\d{0,2}$/.test(String(b.season)))||(b.episode!==undefined&&!/^[1-9]\d{0,2}$/.test(String(b.episode))))return reply(400,{code:'invalid-episode'},origin);
  let url,secret;
  if(b.provider==='vokino'&&b.operation==='online'&&/^[1-9]\d{0,9}$/.test(String(b.id))){
   secret=env.VOKINO_API_TOKEN;url=new URL('https://api.vokino.org/v2/online/vokino/'+b.id);
  }else if(b.provider==='kodik'&&b.operation==='search'&&typeof b.title==='string'&&b.title.length>0&&b.title.length<=120){
   secret=env.KODIK_API_KEY;url=new URL('https://kodik-api.com/search');url.searchParams.set('title',b.title);url.searchParams.set('with_episodes','true');url.searchParams.set('with_material_data','true');
  }else if(b.provider==='videoseed'&&b.operation==='catalog'&&/^[1-9]\d{0,9}$/.test(String(b.id))&&['movie','serial'].includes(b.type)){
   if(env.VIDEOSEED_CONTRACT_CONFIRMED!=='true')return reply(409,{code:'issued-contract-required'},origin);
   secret=env.VIDEOSEED_API_TOKEN;url=new URL('https://api.videoseed.tv/apiv2.php');url.searchParams.set('item',b.type);url.searchParams.set('kp',b.id);
  }else return reply(400,{code:'operation-denied'},origin);
  if(!secret)return reply(409,{code:'own-credential-missing',provider:b.provider},origin);
  url.searchParams.set('token',secret);daily++;minCount++;busy=true;
  try{
   const r=await fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'error',credentials:'omit',cache:'no-store'});
   if(!r.ok)return reply(r.status===401||r.status===403?403:502,{code:'upstream-http-error',upstreamStatus:r.status},origin);
   const reader=r.body.getReader();let size=0;const chunks=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw new Error('size');}chunks.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
   const body=JSON.parse(new TextDecoder().decode(bytes)),error=applicationError(body);
   if(error)return reply(error.code==='auth-required'?403:502,{code:error.code,appStatus:error.appStatus??null,upstreamStatus:200},origin);
   const result={provider:b.provider,operation:b.operation,upstreamStatus:200,receivedJSON:true,resultCount:Array.isArray(body.results)?body.results.length:Array.isArray(body)?body.length:null,mediaSessionConfirmed:false};
   if(b.provider==='kodik')result.choices=kodikChoices(body,b).filter(c=>!c.embedURL.includes(secret));
   else result.playbackBlocker='Successful authorized response schema has not been observed; no playback URL is invented.';
   // Upstream text can echo a credential. Redact every configured secret even
   // inside an otherwise allowed title; response schemas alone are insufficient.
   let output=JSON.stringify(result);for(const key of ['VOKINO_API_TOKEN','KODIK_API_KEY','VIDEOSEED_API_TOKEN','KADR_ADAPTER_ACCESS_TOKEN'])if(env[key])output=output.split(env[key]).join('[redacted]');
   return reply(200,JSON.parse(output),origin);
  }catch{return reply(502,{code:'upstream-unavailable'},origin);}finally{busy=false;}
 };
}
