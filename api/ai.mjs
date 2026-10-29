import {execute,sessionCookie} from '../server/app.mjs';
import {Failure,demand} from '../server/core.mjs';
import {budgetSummary,DAILY_RESERVED_CAP} from '../server/admission.mjs';

export const config={maxDuration:300};
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const controller=new AbortController();
  req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  let streaming=false,heartbeat;
  const send=value=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n');};
  try{
    demand(process.env.KADR_SESSION_SECRET,'NOT_CONFIGURED','Серверная конфигурация ещё не завершена.',503);
    const session=sessionCookie(req.headers.cookie,process.env);if(session.set)res.setHeader('Set-Cookie',session.set);
    if(req.method==='GET'){
      let budget;try{budget=process.env.BLOB_READ_WRITE_TOKEN?await budgetSummary():null;}catch{budget=null;}
      res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({ready:Boolean(process.env.GROQ_API_KEY&&(process.env.TMDB_READ_ACCESS_TOKEN||process.env.TMDB_API_KEY)&&process.env.BLOB_READ_WRITE_TOKEN),
        models:{recognition:process.env.KADR_RECOGNITION_MODEL||'openai/gpt-oss-20b',vision:process.env.KADR_VISION_MODEL||'qwen/qwen3.8-27b',text:process.env.KADR_TEXT_MODEL||'openai/gpt-oss-120b'},
        implementation:'direct-ai-v1',maxFrames:3,privacy:'RAM/foreground',dailyReservedCap:DAILY_RESERVED_CAP,budget,commit:process.env.VERCEL_GIT_COMMIT_SHA||process.env.KADR_BUILD_SHA||null}));return;
    }
    demand(req.method==='POST','METHOD','Метод не поддерживается.',405);
    const origin=req.headers.origin;
    demand(!origin||new URL(origin).host===req.headers.host,'ORIGIN','Запрос с другого сайта отклонён.',403);
    let body=req.body;
    if(!body){const parts=[];let size=0;for await(const p of req){size+=p.length;demand(size<=4200000,'PAYLOAD','Суммарный объём кадров слишком большой.',413);parts.push(p);}body=JSON.parse(Buffer.concat(parts).toString());}
    if(typeof body==='string')body=JSON.parse(body);
    demand(body&&typeof body==='object','BODY','Некорректный запрос.');
    streaming=['recognize','analysis'].includes(body.op);
    res.setHeader('Content-Type',streaming?'application/x-ndjson; charset=utf-8':'application/json; charset=utf-8');
    if(streaming){send({type:'progress',message:'Запрос принят. Держите страницу открытой…'});heartbeat=setInterval(()=>send({type:'heartbeat'}),15000);}
    const result=await execute(body,{env:process.env,signal:controller.signal,session:session.id,progress:message=>send({type:'progress',message})});
    if(streaming)send({type:'result',result});else res.write(JSON.stringify(result));
  }catch(error){
    const safe=error instanceof Failure?{code:error.code,message:error.message,...error.details}:{code:'UNAVAILABLE',message:'Операция прервана или сервер временно недоступен. Автоматического повтора нет.'};
    if(streaming)send({type:'error',error:safe});else{res.statusCode=error instanceof Failure?error.status:503;res.write(JSON.stringify({error:safe}));}
  }finally{if(heartbeat)clearInterval(heartbeat);res.end();}
}
