import {normalizeFrame} from './ai-images.mjs';
const $=id=>document.getElementById(id),api='/api/ai';
let frames=[],busy=false,processing=false,transformEpoch=0,controller=null,activeJob=null,selection=null,evidence=null,epoch=0;
const ready=()=>{$('ai-find').disabled=busy||processing||!serverReady;$('ai-analyze').disabled=busy||processing||!selection?.proof||selection.finality?.state!=='confirmed';$('ai-cancel').disabled=!busy&&!processing;$('ai-files').disabled=busy||processing;};
let serverReady=false;
const status=t=>$('ai-status').textContent=t;
function clearFrames(){++transformEpoch;for(const f of frames)URL.revokeObjectURL(f.url);frames=[];$('ai-files').value='';renderFrames();}
function element(tag,text,cls){const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;}
function renderFrames(){
  $('ai-description').maxLength=frames.length===3?120:frames.length===2?600:2000;
  $('ai-previews').replaceChildren();
  frames.forEach((frame,index)=>{
    const box=element('figure',null,'preview'),img=new Image();img.src=frame.url;img.alt=`Выбранный кадр ${index+1}`;
    box.append(img,element('p',`${frame.width}×${frame.height} · JPEG · ${Math.round(frame.bytes/1024)} КБ · без обрезки`));
    if(frame.warning)box.append(element('p',frame.warning,'warning'));
    if(index===0&&frames.length>1)box.append(element('p',`Описание: до ${$('ai-description').maxLength} символов для ${frames.length} кадров. Более подробное описание доступно с одним кадром.`));
    const remove=element('button','Удалить');remove.type='button';remove.onclick=()=>{if(busy)return;URL.revokeObjectURL(frame.url);frames.splice(index,1);renderFrames();};
    const replace=element('button','Заменить'),input=element('input');input.type='file';input.accept='image/*';input.hidden=true;
    replace.onclick=()=>{if(!busy&&!processing)input.click();};input.onchange=async()=>{if(!input.files[0]||busy||processing)return;processing=true;ready();const version=transformEpoch;try{const next=await normalizeFrame(input.files[0]);if(version!==transformEpoch||frames[index]!==frame){URL.revokeObjectURL(next.url);return;}URL.revokeObjectURL(frame.url);frames[index]=next;renderFrames();}catch(e){if(version===transformEpoch)status(e.message);}finally{if(version===transformEpoch){processing=false;ready();}}};
    box.append(remove,replace,input);$('ai-previews').append(box);
  });
}
$('ai-files').onchange=async event=>{
  if(busy||processing)return;processing=true;ready();const version=transformEpoch;
  try{for(const file of [...event.target.files]){if(frames.length>=3){status('Можно выбрать не более трёх кадров. Удалите или замените один.');break;}
    try{const next=await normalizeFrame(file);if(version!==transformEpoch){URL.revokeObjectURL(next.url);break;}frames.push(next);renderFrames();}catch(e){if(version===transformEpoch)status(e.message);}}}
  finally{if(version===transformEpoch){event.target.value='';processing=false;ready();}}
};
async function call(body,{long=false}={}){
  controller=new AbortController();const current=++epoch;busy=true;ready();
  try{
    const response=await fetch(api,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    if(!long){const value=await response.json();if(current!==epoch)throw new DOMException('Отменено','AbortError');if(value.error)throw Error(value.error.message);if(!response.ok)throw Error('Сервер отклонил запрос.');return value;}
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',result;
    while(true){const {value,done}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});
      let pos;while((pos=pending.indexOf('\n'))>=0){const line=pending.slice(0,pos);pending=pending.slice(pos+1);if(!line)continue;const event=JSON.parse(line);
        if(current!==epoch)throw new DOMException('Отменено','AbortError');
        if(event.type==='progress')status(event.message);if(event.type==='error'){const e=Error(event.error.message);e.evidence=event.error;throw e;}if(event.type==='result')result=event.result;
      }if(done)break;
    }
    if(current!==epoch)throw new DOMException('Отменено','AbortError');if(!result)throw Error('Ответ прерван. Автоматического повтора нет; исходные кадры нужно выбрать заново.');return result;
  }catch(e){if(current!==epoch)throw new DOMException('Отменено','AbortError');throw e;}
  finally{if(current===epoch){busy=false;controller=null;ready();}}
}
function showCandidates(result){
  $('ai-candidates').replaceChildren();status(result.message||'Выберите проверенную карточку. Совпадение с кадрами ещё требует вашего выбора.');
  for(const card of result.candidates||[]){
    const row=element('div',null,'candidate'),pic=element('div');
    if(card.poster){const img=new Image();img.src=card.poster;img.alt=`Постер: ${card.title}`;img.loading='lazy';pic.append(img);}
    const info=element('div');info.append(element('h3',card.title),element('p',`${card.year||'Год неизвестен'} · ${card.type==='movie'?'Фильм':'Сериал'} · ${card.original}`),element('span','Карточка TMDB подтверждена','badge'));
    info.append(element('p',card.explanation||'Прямой каталожный поиск; совпадение кадра не проверялось.'));
    if(card.assessment)info.append(element('p',card.assessment==='supported'?'Модель видит соответствие; это не независимое доказательство.':'Совпадение неоднозначно — можно уточнить поиск.','meta'));
    const choose=element('button','Выбрать эту карточку');choose.onclick=()=>prepare(card);
    const link=element('a','Открыть в TMDB');link.href=card.url;link.target='_blank';link.rel='noreferrer';
    info.append(choose,link);row.append(pic,info);$('ai-candidates').append(row);
  }
}
$('ai-find').onclick=async()=>{
  if(busy||processing)return;const job=crypto.randomUUID();activeJob=job;$('ai-analysis').hidden=true;$('ai-candidates').replaceChildren();$('ai-selection').hidden=true;selection=null;ready();
  const metadata=frames.map(({width,height,bytes,original})=>({width,height,bytes,original}));
  try{const result=await call({op:'recognize',job,frames:frames.map(f=>f.data),description:$('ai-description').value},{long:true});if(activeJob!==job)return;
    evidence={kind:'recognition',at:new Date().toISOString(),inputMetadata:metadata,result};$('ai-export').hidden=false;showCandidates(result);
  }catch(e){if(activeJob===job){status(e.name==='AbortError'?'Поиск отменён. Выберите кадры заново.':e.message);if(e.evidence)evidence={kind:'recognition-error',at:new Date().toISOString(),error:e.evidence};}}
  finally{if(activeJob===job){clearFrames();activeJob=null;}}
};
$('ai-catalog').onclick=async()=>{if(busy||processing)return;selection=null;$('ai-selection').hidden=true;$('ai-analysis').hidden=true;$('ai-candidates').replaceChildren();ready();try{showCandidates(await call({op:'catalog',query:$('ai-title-query').value}));}catch(e){if(e.name!=='AbortError')status(e.message);}};
async function prepare(card,number){
  if(busy)return;selection=null;$('ai-analysis').hidden=true;ready();
  try{
    const value=await call({op:'prepare',type:card.type,id:card.id,season:number});selection=value;
    $('ai-selection').hidden=false;$('ai-selected-card').textContent=`${value.card.title} · ${value.card.year} · выбрано вами из TMDB`;
    $('ai-seasons').replaceChildren();$('ai-watched').replaceChildren();
    if(value.seasons){
      const label=element('label','Выберите сезон'),select=element('select');select.id='ai-season';
      for(const s of value.seasons){const o=element('option',`${s.number}. ${s.title} · ${s.count} серий`);o.value=s.number;select.append(o);}
      const button=element('button','Проверить выпуск выбранного сезона');button.onclick=()=>prepare(card,Number(select.value));$('ai-seasons').append(label,select,button);
      $('ai-gate').textContent='Выпуск и просмотр проверяются отдельно для выбранного сезона.';
    }else{
      const entries=value.season?value.season.episodes:[{id:'film',title:'Я полностью посмотрел этот фильм и хочу открыть все спойлеры.'}];
      for(const e of entries){const label=element('label',null,'check'),check=element('input');check.type='checkbox';check.value=e.id;label.append(check,element('span',value.season?`Посмотрел серию ${e.number}: ${e.title}`:e.title));$('ai-watched').append(label);}
      $('ai-gate').textContent=value.finality.state==='confirmed'?(value.season?'Выпуск сезона подтверждён официальными источниками. Нужен просмотр всех перечисленных основных серий.':'Полный просмотр подтверждаете вы. Будут раскрыты все спойлеры фильма.'):(value.finality.reason||'Выпуск сезона не подтверждён.');
    }
    ready();$('ai-selection').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){if(e.name!=='AbortError')status(e.message);}
}
$('ai-analyze').onclick=async()=>{
  if(busy||!selection?.proof)return;const selected=selection,job=crypto.randomUUID();activeJob=job;
  try{
    const checked=[...$('ai-watched').querySelectorAll('input:checked')].map(x=>Number(x.value));
    const watched=await call({op:'confirm',proof:selected.proof,watched:!selected.season&&document.querySelector('#ai-watched input')?.checked===true,watchedIds:checked});
    if(activeJob!==job)return;$('ai-analysis').hidden=true;
    const result=await call({op:'analysis',job,type:selected.card.type,id:selected.card.id,season:selected.season?.number,proof:watched.proof},{long:true});if(activeJob!==job)return;
    evidence={kind:'analysis',at:new Date().toISOString(),card:selected.card,result};renderAnalysis(result);
  }catch(e){if(activeJob===job){status(e.name==='AbortError'?'Разбор отменён. Непринятый текст не показывается.':e.message);if(e.evidence){evidence={kind:'analysis-error',error:e.evidence};renderAnalysis({status:'error',reviewSummary:e.message,usage:e.evidence.usage});}}}
  finally{if(activeJob===job)activeJob=null;}
};
function renderAnalysis(result){
  $('ai-export').hidden=false;
  $('ai-analysis').hidden=false;$('ai-text').replaceChildren();$('ai-sources').replaceChildren();
  $('ai-verdict').textContent=result.status==='verified'?'Разбор допущен после отдельной проверки. '+result.verification:(result.reviewSummary||'Разбор не допущен.');
  if(result.status==='verified'&&result.text){
    // Plain generated text only. Never render model HTML or executable markdown.
    for(const line of result.text.split('\n')){const title=/^(?:#{1,4}\s*|\*\*)?([1-9][.)]\s+.*?)(?:\*\*)?\s*$/.exec(line);$('ai-text').append(element(title?'h3':'p',title?title[1]:line));}
  }
  if(result.sources?.length){$('ai-sources').append(element('h3','Проверенные источники'));for(const source of result.sources){
    const p=element('p'),a=element('a',`${source.id}: ${source.title}`);a.href=source.url;a.target='_blank';a.rel='noreferrer';p.append(a);$('ai-sources').append(p);
  }}
  const total=(result.usage||[]).reduce((sum,x)=>sum+(x.usage?.total_tokens||0),0);
  const unknown=(result.usage||[]).filter(x=>!Number.isFinite(x.usage?.total_tokens)).length;
  $('ai-usage').textContent=`Фактически: ${(result.usage||[]).length} обращений к модели. По полученным usage: ${total} токенов.${unknown?` Для ${unknown} обращения расход не раскрыт провайдером.`:''} ${result.limitations?.join(' ')||''}`;
  status(result.status==='verified'?'Разбор готов.':'Проверка завершена; готовый разбор не опубликован.');$('ai-analysis').scrollIntoView({behavior:'smooth'});
}
function cancel(reason='Операция отменена. Кадры очищены.'){
  ++epoch;controller?.abort();controller=null;busy=false;processing=false;clearFrames();
  if(activeJob)fetch(api,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'cancel',job:activeJob}),keepalive:true}).catch(()=>{});
  activeJob=null;status(reason);ready();
}
$('ai-cancel').onclick=()=>cancel();
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(busy||processing||frames.length))cancel('Страница скрыта: операция остановлена, кадры очищены. Для продолжения выберите их заново.');});
window.addEventListener('pagehide',()=>cancel('После возвращения выберите кадры заново.'));
$('ai-export').onclick=()=>{if(!evidence)return;const blob=new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=element('a');a.href=u;a.download='KADR_AI_RESULT.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
try{
  if(location.hostname.endsWith('github.io')){$('ai-health').replaceChildren(element('span','Серверная сборка: '));const a=element('a','открыть закрытый AI-стенд');a.href='https://kadr-video-lab-ai-korotkowwww-4729.vercel.app/ai.html';$('ai-health').append(a);}
  else{const h=await fetch(api,{credentials:'same-origin',cache:'no-store'}).then(r=>r.json());serverReady=h.ready===true&&h.budget?.remainingSlots!==0;$('ai-health').textContent=h.ready?(h.budget?.remainingSlots===0?'Сервер подключён. Дневной лимит исчерпан; AI будет доступен после 00:00 UTC.':`Сервер подключён. Ключи остаются на сервере.${h.budget?` На сегодня осталось до ${h.budget.remainingSlots} вызовов модели; поиск занимает до трёх, разбор — до четырёх.`:''}`):'Серверная конфигурация ещё не завершена. Запуск AI отключён; заглушка не используется.';$('ai-build').textContent=h.commit?`Версия ${h.commit.slice(0,12)}`:'';}
}catch{$('ai-health').textContent='Сервер недоступен. AI-запросы не отправлены.';}
ready();
