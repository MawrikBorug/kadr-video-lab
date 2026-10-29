import {Failure,demand,newId,sign,unseal} from './core.mjs';
import {Catalog} from './catalog.mjs';
import {Sources} from './sources.mjs';
import {Admission} from './admission.mjs';
import {Models,recognize,generateAnalysis} from './models.mjs';

export async function execute(body,{env,signal,session,progress=()=>{},factories={}}){
  const catalog=new (factories.Catalog||Catalog)(env,signal),sources=new (factories.Sources||Sources)(signal);
  const scoped=async()=>{
    const card=await catalog.detail(body.type,Number(body.id));
    const season=card.type==='tv'?await catalog.season(card.id,Number(body.season)):null;
    const finality=await sources.finality(card,season);
    return {card,season,finality};
  };
  if(body.op==='catalog')return {candidates:await catalog.search(body.query)};
  if(body.op==='prepare'){
    const card=await catalog.detail(body.type,Number(body.id));
    if(card.type==='tv'&&!body.season)return {card,seasons:card.seasons};
    const season=card.type==='tv'?await catalog.season(card.id,Number(body.season)):null;
    const finality=await sources.finality(card,season);
    return {card,season,finality:{state:finality.state,reason:finality.reason,basis:finality.basis,references:finality.references},
      proof:sign({kind:'selection',session,type:card.type,id:card.id,season:season?.number||null,revision:season?.revision||null,
        episodeIds:season?.episodes.map(e=>e.id)||[],exp:Date.now()+900000},env.KADR_SESSION_SECRET)};
  }
  if(body.op==='confirm'){
    const chosen=unseal(body.proof,env.KADR_SESSION_SECRET);demand(chosen.kind==='selection'&&chosen.session===session,'SCOPE_PROOF','Выберите карточку заново.',403);
    if(chosen.type==='movie')demand(body.watched===true,'WATCHED_REQUIRED','Подтвердите полный просмотр фильма.',403);
    else demand(Array.isArray(body.watchedIds)&&chosen.episodeIds.length>0&&chosen.episodeIds.every(id=>body.watchedIds.includes(id)),
      'EPISODES_NOT_WATCHED','Для разбора сезона нужно подтвердить просмотр всех основных серий.',403);
    return {proof:sign({...chosen,kind:'watched',exp:Date.now()+900000},env.KADR_SESSION_SECRET)};
  }
  if(body.op==='cancel'){
    const a=new (factories.Admission||Admission)({job:body.job,operation:'cancel',signal});
    demand(/^[a-f0-9-]{36}$/i.test(body.job),'JOB_ID','Неверный запрос.');await a.cancel();return {cancelled:true};
  }
  demand(['recognize','analysis'].includes(body.op),'OPERATION','Неизвестная операция.');
  const admission=new (factories.Admission||Admission)({job:body.job,operation:body.op,signal});
  let selection,scope;
  if(body.op==='analysis'){
    selection=unseal(body.proof,env.KADR_SESSION_SECRET);
    demand(selection.kind==='watched'&&selection.session===session,'WATCHED_REQUIRED','Подтвердите просмотр.',403);
    demand(selection.type===body.type&&selection.id===Number(body.id)&&selection.season===(body.season?Number(body.season):null),'SCOPE_MISMATCH','Подтверждение принадлежит другому фильму или сезону.',403);
    progress('Проверяем карточку, просмотр и завершённость сезона…');scope=await scoped();
    demand(scope.season?.revision===selection.revision||!scope.season&&selection.revision===null,'COMPOSITION_CHANGED','Состав сезона изменился. Подтвердите просмотр нового состава.',403);
    demand(scope.finality.state==='confirmed','FINALITY_UNKNOWN',scope.finality.reason||'Выпуск сезона не подтверждён.',403);
  }
  await admission.reserve();
  const models=new (factories.Models||Models)(env,admission,signal,progress);
  try{
    if(body.op==='recognize')return {...await recognize(models,catalog,body),usage:models.usage};
    progress('Автоматически получаем материалы по проверенной карточке…');
    const dossier=await sources.acquire(scope.card,scope.season,scope.finality);
    const result=await generateAnalysis(models,dossier);
    await admission.checkpoint();
    if(result.status==='verified'&&scope.season){
      const current=await catalog.season(scope.card.id,scope.season.number);
      demand(current.revision===selection.revision,'COMPOSITION_CHANGED','Состав сезона изменился за время проверки. Разбор не опубликован.',403);
      const released=await sources.finality(scope.card,current);demand(released.state==='confirmed','FINALITY_CHANGED','Подтверждение выпуска изменилось. Разбор не опубликован.',403);
    }
    return {...result,scope:dossier.scope,usage:models.usage};
  }catch(e){if(e instanceof Failure)e.details={...e.details,usage:models.usage};throw e;}
}

export function sessionCookie(cookie,env){
  const raw=String(cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('kadr_ai='))?.slice(8);
  try{const s=unseal(raw,env.KADR_SESSION_SECRET);if(s.kind==='session')return {id:s.id};}catch{}
  const id=newId(),value=sign({kind:'session',id,exp:Date.now()+21600000},env.KADR_SESSION_SECRET);
  return {id,set:`kadr_ai=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=21600`};
}
