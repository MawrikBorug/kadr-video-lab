import {ACTIVE_PROVIDERS,SELECTION_EDITION,archiveDiagnostic} from './active-set.js';
import {availableModes,previewQueue,createRun,QueueRunner,retryItems,queueSummary,PROFILES} from './queue.js';
import {BUILD} from './build.js';
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const names={ready:'Готова к явному запуску',running:'Выполняется',completed:'Диагностика завершена',paused:'Пауза',interrupted:'Прервана',cancelled:'Отменена','awaiting-user':'Нужно касание для звука','awaiting-manual':'Нужно ручное подтверждение',pending:'Ожидает',failed:'Ошибка',timeout:'Тайм-аут','auth-required':'Нужен доступ','rate-limited':'Лимит / Retry-After',skipped:'Пропущено'};
export function initBatchUI({registry,samples,records,runs,execute,persist,environment,notice,onRunChange}){
 const archival=archiveDiagnostic();const modes=availableModes(archival?registry:[]).filter(m=>archival||ACTIVE_PROVIDERS.includes(m.provider)&&m.mode==='embed');let selectedRun=runs.at(-1)||null;let preview=[];
 const runner=new QueueRunner({execute,onChange:()=>{persist();render();onRunChange?.();}});
 for(const m of modes){const label=node('label'),input=node('input');input.type='checkbox';input.value=m.key;input.name='batch-mode';label.className='check-line';label.append(input,document.createTextNode(m.label+(m.issue?` · ${m.issue.code}`:'')));$('batch-modes').append(label);}
 const blockers=modes.filter(m=>m.issue&&['auth-required','owner-access','manual-partner-approval'].includes(m.issue.code)).map(m=>`${m.refId} · ${m.label}: ${m.issue.reason}`);
 if(archival)for(const p of registry)for(const b of p.stageReview?.blockedModes||[])blockers.push(`${p.id} · ${p.name} · ${b.method}: ${b.reason}`);
 $('batch-access-blockers').replaceChildren(...blockers.map(text=>node('li',text)));
 for(const s of samples.filter(s=>archival||s.type!=='control')){const label=node('label'),input=node('input');input.type='checkbox';input.value=s.key;input.name='batch-subject';label.className='check-line';label.append(input,document.createTextNode(`${s.title}${s.year?` (${s.year})`:''}${s.type==='tv'?` · S${s.season}E${s.episode}`:''}`));$('batch-subjects').append(label);}
 const checked=name=>[...document.querySelectorAll(`input[name="${name}"]:checked`)].map(n=>n.value);
 function makePreview(){
  const selected=modes.filter(m=>checked('batch-mode').includes(m.key));
  const subjects=samples.filter(s=>checked('batch-subject').includes(s.key));
  if($('batch-custom').checked){const custom=environment('subject');if(custom)subjects.push(custom);}
  const season=$('batch-season').value,episode=$('batch-episode').value;
  const settings={accessAcknowledged:$('access-consent').checked};if(season)settings.season=season;if(episode)settings.episode=episode;
  try{preview=previewQueue(selected,subjects,settings);}catch(e){notice(e.message,true);return [];}
  const count=preview.filter(p=>p.status==='pending').length;
  $('batch-preview-summary').textContent=`Всего ${preview.length} сочетаний: применимо ${count}, пропусков ${preview.length-count}.`;
  $('batch-preview').replaceChildren(...preview.map(p=>node('li',`${p.refId} · ${p.config.mode} · ${p.config.title} · ${p.config.type==='tv'?`S${p.config.season}E${p.config.episode} · `:''}${p.reason?`${p.reason.code}: ${p.reason.reason}`:'допустимый запрос'}`)));
  return preview;
 }
 $('batch-preview-button').onclick=makePreview;
 $('batch-ready').onclick=()=>{for(const i of document.querySelectorAll('input[name="batch-mode"]'))i.checked=!modes.find(m=>m.key===i.value)?.issue;makePreview();};
 $('batch-all').onclick=()=>{for(const i of document.querySelectorAll('input[name="batch-mode"]'))i.checked=true;makePreview();};
 $('batch-none').onclick=()=>{for(const i of document.querySelectorAll('input[name="batch-mode"]'))i.checked=false;makePreview();};
 $('batch-subjects-all').onclick=()=>{for(const i of document.querySelectorAll('input[name="batch-subject"]'))i.checked=true;makePreview();};
 $('batch-profile').onchange=()=>{$('batch-limit').value=PROFILES[$('batch-profile').value].defaultSeconds;$('batch-limit').min=Math.max(1,PROFILES[$('batch-profile').value].minimumSeconds);};
 $('batch-create').onclick=()=>{
  if(runner.busy){notice('Сначала приостановите текущую очередь.',true);return;}
  const list=makePreview();if(!list.length){notice('Выберите режимы и произведения.',true);return;}
  try{selectedRun=createRun(list,{profile:$('batch-profile').value,maxSeconds:$('batch-limit').value,environment:environment(),build:BUILD});runs.push(selectedRun);persist();render();notice('Очередь сохранена. Нажмите «Запустить / возобновить».');}catch(e){notice(e.message,true);}
 };
 $('batch-run-select').onchange=()=>{if(runner.busy)return;selectedRun=runs.find(r=>r.runId===$('batch-run-select').value);render();};
 $('batch-start').onclick=()=>{
  if(!selectedRun)return;if(selectedRun.selectionEdition!==SELECTION_EDITION){notice('Старая очередь сохранена в архиве. Создайте новую очередь Videoseed.',true);return;}if(!$('access-consent').checked){notice('Подтвердите право доступа в параметрах сеанса.',true);return;}
  for(const item of selectedRun.queue)item.config.accessAcknowledged=true;
  runner.start(selectedRun,{environment:environment()}).catch(e=>notice(e.message,true));
 };
 $('batch-pause').onclick=()=>runner.stop('user-pause');
 $('batch-cancel').onclick=()=>{if(selectedRun){runner.run=selectedRun;runner.cancel();}};
 $('batch-skip').onclick=()=>{if(!$('batch-skip-reason').value.trim()){notice('Укажите причину пропуска.',true);return;}runner.skip($('batch-skip-reason').value);};
 $('batch-retry').onclick=()=>{if(!selectedRun||runner.busy||selectedRun.selectionEdition!==SELECTION_EDITION)return;retryItems(selectedRun,checked('batch-retry-item'));persist();render();notice('Выбранные ошибки подготовлены к новому запуску. Attempt ID будет новым.');};
 function render(){
  const id=selectedRun?.runId;
  $('batch-run-select').replaceChildren(...runs.map(r=>{const o=node('option',`${r.createdAt} · ${names[r.status]||r.status} · ${r.runId.slice(0,8)}`);o.value=r.runId;return o;}));
  $('batch-run-select').value=id||'';$('batch-run-select').disabled=runner.busy;
  const summary=queueSummary(selectedRun);$('batch-status').textContent=selectedRun?`${selectedRun.selectionEdition!==SELECTION_EDITION?'Архивная очередь: запуск отключён. ':''}${names[selectedRun.status]||selectedRun.status}. ${JSON.stringify(summary.counts)}. ${summary.notice}`:'Сохранённых очередей пока нет.';
  $('batch-start').disabled=!selectedRun||selectedRun.selectionEdition!==SELECTION_EDITION||runner.busy||['completed','cancelled'].includes(selectedRun.status);
  $('batch-pause').disabled=!runner.busy;$('batch-skip').disabled=!runner.busy;
  $('batch-cancel').disabled=!selectedRun||['completed','cancelled'].includes(selectedRun.status);
  $('batch-retry').disabled=!selectedRun||runner.busy||selectedRun.selectionEdition!==SELECTION_EDITION;
  $('batch-results').replaceChildren(...(selectedRun?.queue||[]).map(item=>{
   const div=node('details'),summary=node('summary',`${item.refId} · ${item.config.mode} · ${item.config.title} · ${names[item.status]||item.status} · попыток ${item.attempts.length}`);div.append(summary);
   if(['failed','timeout','auth-required','rate-limited','interrupted','cancelled','skipped'].includes(item.status)){const label=node('label','Повторить этот опыт '),input=node('input');input.type='checkbox';input.name='batch-retry-item';input.value=item.testId;label.append(input);div.append(label);}
   div.append(node('pre',JSON.stringify({testId:item.testId,reason:item.reason,attempts:item.attempts},null,2)));return div;
  }));
 }
 render();
 return {runner,get selectedRun(){return selectedRun;},render,pause:reason=>{if(runner.busy)runner.stop(reason,'interrupted');}};
}
