import Hls from './vendor/hls.mjs';
import { PROVIDERS, MODE_NAMES, buildRequest, selectEpisode, configForSample, modeIssue, LabError } from './providers.js';
import { CHECKS, ADS, DETAILS, RESULTS, AD_RESULTS, makeRecord, appendEvent, acceptPostMessage, loadJournal, saveJournal, exportJSON, exportCSV, e1Candidates, reconcileRecord, assessRecord, mergeExports } from './core.js';

import {fetchJSON,parseCatalog} from './catalog.js';
import {sanitize} from './security.js';
import {BUILD} from './build.js';
import {newMeasurement,sampleMeasurement,evidenceLevel,excludeUncertainAdWindow} from './measurement.js';
import {recoverRuns} from './queue.js';
import {initBatchUI} from './batch-ui.js';

const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const message = (text, danger = false) => { $('message').textContent = text; $('message').classList.toggle('danger', danger); };
let storage;
try { storage = window.localStorage; } catch { /* loadJournal reports unavailable storage */ }
const loaded = loadJournal(storage);
const records = loaded.records;
const runs = recoverRuns(loaded.runs || []);
for(const r of records)if(r.runId&&!r.endedAt&&['running','awaiting-user','awaiting-manual'].includes(r.queueStatus)){r.queueStatus='interrupted';r.technical.interrupted='reload-or-unload';r.endedAt=new Date().toISOString();if(r.measurement)r.measurement.last=null;}
let batchUI=null;
let registry=[];
let current = records.at(-1) || null;
let runtime = null;
let generation = 0;
let rejectedFlush = null;
const visitId = crypto.randomUUID();
const observations = new Map();
let samples = [];

function storageWarning(text) {
  $('storage-warning').hidden = !text;
  $('storage-warning').textContent = text || '';
}
storageWarning(loaded.error);
if (loaded.raw && loaded.error) $('export-recovery').hidden = false;

function persist() {
  if (!loaded.error) storageWarning(saveJournal(storage, records, runs));
  $('record-count').textContent = String(records.length);
}

function log(record, data) {
  appendEvent(record, data);
  persist();
  if (record === current) renderEvents();
}

function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = el('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const filename = extension => `kadr-1.2-${new Date().toISOString().replaceAll(':', '-')}.${extension}`;

for (const [key, provider] of Object.entries(PROVIDERS)) {
  const option = el('option', `${provider.name}${provider.enabled ? '' : ' · не подтверждён'}`);
  option.value = key; $('provider').append(option);
}

function refreshModes() {
  const p=PROVIDERS[$('provider').value];
  $('provider-mode').replaceChildren(...p.modes.map(key=>{const o=el('option',MODE_NAMES[key]||key);o.value=key;return o;}));
}
function providerInfo() {
  const p=PROVIDERS[$('provider').value];if(!p)return;
  const issue=modeIssue(p,$('provider-mode').value);
  $('provider-info').replaceChildren(el('p',`${p.refId} · ${p.gate}`,'status'),el('p',p.live),el('p',p.description),el('p',issue?.reason||p.limitation));
  const link=el('a','Первичный источник ↗');link.href=p.source;link.target='_blank';link.rel='noopener noreferrer';$('provider-info').append(link);
  const isFrame=$('provider-mode').value==='embed';
  $('quality-label').hidden=p.kind!=='hls';$('sandbox-label').hidden=!isFrame;$('sandbox-hint').hidden=!isFrame;
  $('id-hint').textContent=p.namespace==='aniliberty'?'Другой сезон требует ID отдельного релиза. Ordinal не округляется.':`Точная система ID: ${p.namespace}. Неизвестный ID не заменяется другим фильмом.`;
  $('content-id').required=p.enabled&&!['control','filmix'].includes(p.namespace);
  $('open-source').textContent=issue?'Зафиксировать блокер режима':'Открыть источник вручную';
  const unsafe=isFrame&&$('sandbox').value==='documented';for(const id of ['unrestricted-label','clean-session-label','sandbox-warning'])$(id).hidden=!unsafe;
}
function applySample() {
  const sample=samples.find(s=>s.key===$('sample').value);$('catalog-link').hidden=!sample?.source;
  if(!sample){providerInfo();updateE1Options();return;}
  if(sample.source)$('catalog-link').href=sample.source;
  const p=PROVIDERS[$('provider').value],control=p.namespace==='control';
  const chosen=control?samples.find(s=>s.key===$('provider').value):sample;
  const config=configForSample($('provider').value,$('provider-mode').value,chosen||sample);
  $('title').value=config.title;$('release-year').value=config.year||'';$('type').value=config.type;$('namespace').value=config.namespace;$('content-id').value=config.id;
  $('season').value=config.season;$('episode').value=config.episode;
  providerInfo();updateE1Options();
}
$('provider').value='aniliberty';refreshModes();
$('provider').addEventListener('change',()=>{
  refreshModes();$('namespace').value=PROVIDERS[$('provider').value].namespace;
  $('unrestricted-consent').checked=false;$('clean-session-consent').checked=false;$('sandbox').value='strict';
  if(PROVIDERS[$('provider').value].namespace==='control')$('sample').value=$('provider').value;if($('provider').value==='archive')$('sample').value='archive-sintel';
  applySample();providerInfo();
});
$('provider-mode').addEventListener('change',providerInfo);
$('sample').addEventListener('change',applySample);
$('sandbox').addEventListener('change',()=>{$('unrestricted-consent').checked=false;$('clean-session-consent').checked=false;providerInfo();});

function updateE1Options() {
  const config = current?.config || readConfig();
  const e2 = config.stage === 'E2';
  $('e1-label').hidden = !e2; $('e1-warning').hidden = !e2;
  const prior = current ? config.e1RecordId : $('e1-record').value;
  const candidates = e1Candidates(config, records, current ? Date.parse(current.createdAt) : Date.now());
  const empty = el('option', 'Нет подтверждённого E1 — только предварительная проба'); empty.value = '';
  $('e1-record').replaceChildren(empty, ...candidates.map(record => { const option = el('option', `${record.id} · ${record.createdAt} · ${record.environment.network}`); option.value = record.id; return option; }));
  if (current && prior && !candidates.some(item => item.id === prior)) { const invalid = el('option', `Недействительная ссылка E1: ${prior}`); invalid.value = prior; $('e1-record').append(invalid); }
  $('e1-record').value = current ? prior || '' : candidates.some(item => item.id === prior) ? prior : candidates.at(-1)?.id || '';
  const linked = candidates.some(item => item.id === $('e1-record').value);
  $('e1-warning').classList.toggle('danger', !linked);
  $('e1-warning').textContent = linked ? `Основание E1: ${$('e1-record').value}. Смена сети не требует нового E1; результат E2 относится только к своей среде.` : 'E1 не подтверждён. Можно записать предварительные наблюдения, но принимать E2 как итог и подтверждать полный сеанс без рекламы нельзя. Причина сохранится в журнале и экспорте.';
}
for (const id of ['stage', 'type', 'namespace', 'content-id', 'season', 'episode']) $(id).addEventListener('input', updateE1Options);
$('e1-record').addEventListener('change', () => {
  const linked = Boolean($('e1-record').value);
  $('e1-warning').classList.toggle('danger', !linked);
  $('e1-warning').textContent = linked ? `Основание E1: ${$('e1-record').value}. Смена сети не требует нового E1.` : 'E1 не подтверждён. E2 остаётся предварительной пробой; итоговый PASS недопустим.';
});

const resultText = { NOT_RUN: 'NOT_RUN · не проверено', PASS: 'PASS · подтверждено', FAIL: 'FAIL · не прошло', INCONCLUSIVE: 'INCONCLUSIVE · недостаточно данных', OBSERVED: 'Наблюдалось', NOT_OBSERVED: 'Не наблюдалось в сеансе' };

function addObservation(parent, group, key, label, options) {
  const wrapper = el('label', label);
  const numeric = key.endsWith('Seconds') || key.endsWith('Minutes');
  const control = options ? el('select') : el(numeric ? 'input' : 'textarea');
  control.id = `obs-${group}-${key}`;
  if (options) for (const optionValue of options) { const option = el('option', resultText[optionValue]); option.value = optionValue; control.append(option); }
  else {
    control.maxLength = 2000;
    if (numeric) { control.type = 'number'; control.min = '0'; control.max = key.endsWith('Minutes') ? '1440' : '86400'; control.step = '0.1'; control.inputMode = 'decimal'; }
  }
  wrapper.append(control); $(parent).append(wrapper); observations.set(`${group}.${key}`, control);
  control.addEventListener(options ? 'change' : 'input', () => {
    if (!current) return;
    if (group === 'tracking') current.tracking = control.value;
    else current[group][key] = control.value;
    current.updatedAt = new Date().toISOString();
    current.manualConfirmations ||= []; current.manualConfirmations.push({field:`${group}.${key}`,value:control.value,source:'manual',at:current.updatedAt,sessionId:visitId});
    enforceConsistency(); persist();
  });
}
for (const [key, label] of Object.entries(CHECKS)) addObservation('checks', 'checks', key, label, RESULTS);
for (const [key, label] of Object.entries(ADS)) addObservation('ads', 'ads', key, label, AD_RESULTS);
addObservation('ads', 'tracking', 'value', 'Сторонний трекинг (отдельно)', AD_RESULTS);
for (const [key, label] of Object.entries(DETAILS)) addObservation('details', 'details', key, label);

function enforceConsistency() {
  if (!current) return;
  const priorStatus = current.status;
  const issues = reconcileRecord(current, records);
  observations.get('checks.fullNoAds').value = current.checks.fullNoAds;
  $('outcome').value = current.status;
  $('consistency').hidden = !issues.length;
  $('consistency').textContent = issues.length ? issues.join(' ') + ' Противоречащая отметка заменена на INCONCLUSIVE; измерения сохранены.' : '';
  if (priorStatus !== current.status) renderHistory();
  renderAssessment();
}

function renderAssessment() {
  const e2 = current?.config.stage === 'E2';
  $('outcome-label').textContent = e2 ? 'Итог E2: полный сеанс без рекламы и базовый контроль' : 'Итог E1: наличие и запуск';
  $('e2-assessment').hidden = !e2;
  if (!e2) return;
  const assessment = assessRecord(current, records);
  $('e2-assessment').textContent = `Проба наблюдений: ${assessment.probeStatus}. Полный сеанс без рекламы: ${assessment.adFreeSessionStatus}. Успешная фиксация рекламы/управления не означает отсутствие рекламы. Вердикт основан на ручных отметках одного сеанса; для вывода по выборке нужны полный фильм, эпизод и повтор в новой сессии.`;
}

$('outcome').addEventListener('change', () => {
  if (!current) return;
  current.status = $('outcome').value;
  current.updatedAt = new Date().toISOString();
  enforceConsistency(); persist(); renderHistory();
});
$('observations').addEventListener('submit', event => event.preventDefault());

function renderCurrent() {
  if (current) reconcileRecord(current, records);
  $('observation-fields').disabled = !current;
  $('config-fields').disabled = Boolean(current);
  $('open-source').disabled = Boolean(current);
  $('stop').disabled = !current || Boolean(current.endedAt);
  $('current-record').textContent = current ? `${current.config.stage} · ${current.config.title} · ${current.createdAt} · ${current.id}` : 'Сначала откройте источник. Каждая попытка создаёт отдельную запись.';
  for (const [path, control] of observations) {
    const [group, key] = path.split('.');
    control.value = current ? (group === 'tracking' ? current.tracking : current[group][key]) : group === 'details' ? '' : 'NOT_RUN';
  }
  $('outcome').value = current?.status || 'NOT_RUN';
  $('consistency').hidden = true;
  updateE1Options(); renderAssessment(); renderEvents(); renderHistory();
}

function renderEvents() {
  $('event-count').textContent = String(current?.events.length || 0);
  $('events').textContent = current?.events.length ? current.events.slice(-25).map(item => JSON.stringify(item)).join('\n') : 'Событий пока нет.';
  if (current) $('event-note').textContent = `Только допустимые поля, без исходных URL и payload. Отклонено postMessage: ${current.rejectedMessages}; не сохранено из-за лимита 400 событий: ${current.droppedEvents}. Native-события не доказывают точность произведения и отсутствие рекламы.`;
}

function renderHistory() {
  $('record-count').textContent = String(records.length);
  const nodes = records.slice().reverse().map(record => {
    const item = el('details');
    const assessment = assessRecord(record, records);
    const verdict = record.config.stage === 'E2' ? `E2 итог ${record.status} · наблюдения ${assessment.probeStatus} · без рекламы ${assessment.adFreeSessionStatus}` : `E1 ${record.status}`;
    item.append(el('summary', `${verdict} · ${PROVIDERS[record.config.provider]?.name || 'Источник'} · ${record.config.title} · ${record.createdAt}`));
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      item.querySelector('pre')?.remove(); item.querySelector('button')?.remove();
      const copy = el('button', 'Скачать запись с основанием E1'); copy.type = 'button'; copy.addEventListener('click', () => download(exportJSON(records.filter(item => item.id === record.id || item.id === record.config.e1RecordId)), `kadr-${record.id}.json`, 'application/json'));
      item.append(copy, el('pre', JSON.stringify(record, null, 2)));
    });
    return item;
  });
  $('history').replaceChildren(...(nodes.length ? nodes : [el('p', 'Записей пока нет.', 'hint')]));
}

function readConfig() {
  const sample=samples.find(s=>s.key===$('sample').value),provider=$('provider').value;
  const base=sample?configForSample(provider,$('provider-mode').value,sample):{};
  const config={...base,provider,mode:$('provider-mode').value,refId:PROVIDERS[provider]?.refId,sampleKey:sample?.key||'custom',category:sample?.category||'custom',title:$('title').value.trim(),searchTitle:sample?.title||$('title').value.trim(),year:Number($('release-year').value)||null,type:$('type').value,namespace:$('namespace').value,id:$('content-id').value.trim(),season:$('season').value,episode:$('episode').value,quality:$('quality').value,sandbox:$('sandbox').value,unrestrictedConsent:$('unrestricted-consent').checked,cleanSessionConsent:$('clean-session-consent').checked,accessAcknowledged:$('access-consent').checked,stage:$('stage').value,watchScope:$('watch-scope').value,e1RecordId:$('stage').value==='E2'?$('e1-record').value||null:null,translationId:$('translation-id').value,playerId:$('upstream-player-id').value};
  if(base.id!==config.id||base.namespace!==config.namespace){config.canonicalId=null;config.canonical={year:config.year};config.sampleKey='custom';config.searchTitle=config.title;}
  return config;
}
function readEnvironment(kind) {
  if(kind==='subject'){
    const c=readConfig();return {key:'custom-'+c.namespace+'-'+c.id,canonicalId:c.canonicalId,title:c.title,year:c.year,type:c.type,category:'custom',season:c.season,episode:c.episode,[c.namespace]:c.id,...c.canonical};
  }
  return {device:$('device').value,country:$('country').value,network:$('network').value,blocker:$('blocker').value,vpn:$('vpn').value,notes:$('environment-notes').value,confirmationSource:'manual-form',sessionId:visitId,userAgent:navigator.userAgent.slice(0,400),displayMode:matchMedia('(display-mode: standalone)').matches||navigator.standalone?'standalone':'browser',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'unknown',physicalDeviceConfirmed:['iphone-safari','iphone-pwa'].includes($('device').value)};
}

function dispose() {
  generation += 1;
  const old = runtime; runtime = null;
  if (old) {
    old.controller.abort();
    old.cleanup?.();
    old.hls?.destroy();
    if (old.video) { old.video.pause(); old.video.removeAttribute('src'); old.video.load(); }
  }
  $('player').replaceChildren(el('p', 'Источник закрыт. Журнал сохранён на устройстве.'));
  for (const id of ['play', 'pause', 'seek', 'stop']) $(id).disabled = true;
  if (rejectedFlush) { clearTimeout(rejectedFlush); rejectedFlush = null; persist(); }
}

function closeSource() {
  if (current && !current.endedAt) { log(current, { type: 'source-closed', channel: 'lab' }); current.endedAt = new Date().toISOString(); }
  dispose(); if (current) enforceConsistency(); persist(); renderHistory();
}
$('stop').addEventListener('click', () => { batchUI?.pause('source-closed'); closeSource(); message('Источник закрыт. Ручные наблюдения можно дописать; новый запуск создаст другой сеанс.'); });
$('new-session').addEventListener('click', () => {
  batchUI?.pause('manual-new-session');
  closeSource(); current = null; $('sandbox').value = 'strict'; $('unrestricted-consent').checked = false; $('clean-session-consent').checked = false; providerInfo(); renderCurrent();
  message('Укажите условия новой попытки. Предыдущая запись осталась в журнале.');
  $('provider').focus();
});

function confirm(field,value) {
  if(!current)return;
  current.manualConfirmations||=[];current.manualConfirmations.push({field,value,source:'manual',at:new Date().toISOString(),sessionId:visitId});persist();
}
function step(record,name,status,extra={}) {
  const entry={name,status,at:new Date().toISOString(),...sanitize(extra)};record.steps||=[];record.steps.push(entry);
  if(runtime?.attempt)runtime.attempt.steps.push(entry);persist();
}
function mountVideo(stream,record,token,kind='hls',knownMain=false) {
  const video=el('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.setAttribute('aria-label','Наблюдаемый видеоплеер');
  const rt=runtime;rt.video=video;rt.mainVideo=knownMain;record.measurement=newMeasurement();record.measurement.mainVideo=knownMain;let lastLog=0,lastSave=0;
  const listeners=[];
  const tick=()=>{
    if(generation!==token||current!==record)return;
    sampleMeasurement(record.measurement,{position:video.currentTime,duration:video.duration,now:performance.now(),visible:document.visibilityState==='visible',playing:!video.paused&&!video.ended&&video.readyState>=3,seeking:video.seeking,mainVideo:rt.mainVideo});
    if(Number.isFinite(video.currentTime))record.technical.position=video.currentTime;
    if(Number.isFinite(video.duration))record.technical.duration=video.duration;
    $('measurement-summary').textContent=`Main video: ${rt.mainVideo?'граница подтверждена':'нужно подтверждение'}. Фактически ${record.measurement.watchSeconds.toFixed(1)} с; уникально ${record.measurement.uniqueSeconds.toFixed(1)} с (${(record.measurement.coverage*100).toFixed(1)}%). Конец + ≥90%: ${record.measurement.completed?'да':'не подтверждено'}.`;
    if(performance.now()-lastSave>=1000){lastSave=performance.now();persist();}
  };
  for(const type of ['loadedmetadata','play','playing','pause','timeupdate','seeking','seeked','ended','waiting','error']){
    const fn=()=>{
      if(generation!==token||current!==record)return;
      if(['pause','seeking','waiting'].includes(type))record.measurement.last=null;
      if(type==='loadedmetadata'&&Number.isFinite(record.technical.resumePosition)&&record.technical.resumePosition>0&&record.technical.resumePosition<video.duration){video.currentTime=record.technical.resumePosition;record.measurement.commands.restore={status:'requested',position:record.technical.resumePosition,source:'saved-native-position',completed:false};}
      if(type==='playing'){
        rt.started=true;record.layers.player={status:'observed',source:'native-events'};
        if(rt.mainVideo)record.layers.mainVideo={status:'observed',source:'native-events',boundary:knownMain?'permitted-control':'manual-confirmed'};
        rt.setState?.(rt.mainVideo?'running':'awaiting-manual');
      }
      if(type==='ended'){tick();record.measurement.ended=true;record.measurement.completed=Boolean(record.measurement.coverage>=.9&&rt.mainVideo);record.layers.ended={status:'observed',source:'native-events',completed:record.measurement.completed};}
      if(type==='error'){record.layers.mainVideo={status:'error',code:video.error?.code};message(`Плеер сообщил ошибку ${video.error?.code||''}. Это не отсутствие произведения.`,true);rt.failure=new LabError('media-error','Native video не загрузил или не декодировал медиа.',{mediaCode:video.error?.code});}
      if(type!=='timeupdate'||performance.now()-lastLog>30000){lastLog=performance.now();log(record,{type,channel:'native',origin:stream.origin,currentTime:video.currentTime,duration:video.duration,elapsedSeconds:(performance.now()-rt.openedAt)/1000,code:video.error?.code});}
    };video.addEventListener(type,fn);listeners.push([type,fn]);
  }
  const timer=setInterval(tick,500);rt.cleanup=()=>{clearInterval(timer);clearTimeout(rt.sleepTimer);for(const [type,fn] of listeners)video.removeEventListener(type,fn);record.measurement.last=null;};
  $('player').replaceChildren(video);
  if(kind==='mp4'){video.src=stream.url;record.technical.playbackEngine='native-mp4';}
  else if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=stream.url;record.technical.playbackEngine='native-hls';}
  else if(Hls.isSupported()){
    const hls=new Hls({maxBufferLength:20,maxMaxBufferLength:30,backBufferLength:30});rt.hls=hls;record.technical.playbackEngine='hls.js';
    hls.on(Hls.Events.ERROR,(_event,data)=>{if(!data.fatal||generation!==token)return;record.technical.hlsError=data.details;rt.failure=new LabError('media-error','HLS: ошибка загрузки, CORS или кодека.');log(record,{type:'hls-fatal-error',channel:'hls'});message(rt.failure.message,true);});
    hls.loadSource(stream.url);hls.attachMedia(video);
  }else rt.failure=new LabError('unsupported-codec','Нет совместимого HLS-движка.');
  for(const id of ['play','pause','seek'])$(id).disabled=false;
  record.technical.controls={pause:'native-observable',seek:'native-observable',sleepTimer:'native-observable',nextEpisode:'не установлен контракт следующего эпизода; автопереход стенда отключён'};
  persist();
}
function waitForManual(record,ctx){
  runtime.setState=ctx.setState;ctx.setState('awaiting-manual');$('complete-current').disabled=false;
  message('Нужно ручное подтверждение: проверьте точное произведение, основной старт, звук и рекламу. Заполните наблюдения и продолжите очередь.');
  return new Promise((resolve,reject)=>{
    const abort=()=>{record.queueStatus=ctx.run.status==='cancelled'?'cancelled':ctx.item.status==='skipped'?'skipped':'interrupted';record.technical.interrupted=record.queueStatus;record.technical.interruptionReason=ctx.item.reason||ctx.run.interruption;record.endedAt=new Date().toISOString();dispose();persist();reject(new LabError('interrupted','Опыт прерван.'));};
    ctx.signal.addEventListener('abort',abort,{once:true});
    runtime.manualResolve=()=>{ctx.signal.removeEventListener('abort',abort);$('complete-current').disabled=true;resolve({manualConfirmationRequired:true,evidenceLevel:evidenceLevel(record)});};
  });
}
async function waitForNative(record,ctx){
  const rt=runtime;rt.setState=ctx.setState;let began=performance.now();let lastProgress=performance.now(),lastWatch=0;
  try{await rt.video.play();}catch{ctx.setState('awaiting-user');message('Нужно касание для запуска со звуком. Нажмите Play. Звук автоматически не отключается.');}
  return new Promise((resolve,reject)=>{
    const finish=(error)=>{clearInterval(timer);ctx.signal.removeEventListener('abort',abort);if(error)reject(error);else resolve({watchSeconds:record.measurement.watchSeconds,coverage:record.measurement.coverage,completed:record.measurement.completed,evidenceLevel:evidenceLevel(record)});};
    const abort=()=>{record.queueStatus=ctx.run.status==='cancelled'?'cancelled':ctx.item.status==='skipped'?'skipped':'interrupted';record.technical.interrupted=record.queueStatus;record.technical.interruptionReason=ctx.item.reason||ctx.run.interruption;record.endedAt=new Date().toISOString();dispose();persist();finish(new LabError('interrupted','Опыт прерван.'));};
    ctx.signal.addEventListener('abort',abort,{once:true});
    const timer=setInterval(()=>{
      if(rt!==runtime){finish(new LabError('interrupted','Источник закрыт.'));return;}
      if(rt.failure){finish(rt.failure);return;}
      const m=record.measurement;
      if(ctx.run.status==='awaiting-user'||ctx.run.status==='awaiting-manual'){began=performance.now();lastProgress=performance.now();return;}
      if(m.watchSeconds>lastWatch){lastProgress=performance.now();lastWatch=m.watchSeconds;}
      const limit=ctx.run.profile.maxSeconds;
      if(rt.video.ended||m.watchSeconds>=limit||rt.started&&(performance.now()-began)/1000>=limit){
        record.layers.profile={status:ctx.run.profile.id==='five'&&m.watchSeconds<300?'insufficient-duration':ctx.run.profile.id==='full'&&!m.completed?'incomplete-session':'measured',source:'native-events',watchSeconds:m.watchSeconds};finish();return;
      }
      if(performance.now()-lastProgress>30000)finish(new LabError('timeout','Нет наблюдаемого прогресса main video в течение 30 секунд.'));
    },250);
  });
}
function renderCatalog(summary,record,config,token){
  $('api-results').replaceChildren(el('pre',JSON.stringify(sanitize(summary),null,2)));
  if(summary.candidates)for(const candidate of summary.candidates){
    const button=el('button',`Подтвердить: ${candidate.title} (${candidate.year}), Filmix ${candidate.id}; запросить варианты`);button.type='button';
    button.onclick=async()=>{
      if(current!==record||generation!==token)return;confirm('identity.filmix',{id:candidate.id,title:candidate.title,year:candidate.year});record.layers.identity={status:'matched-manual',source:'manual',upstreamId:candidate.id};record.config.upstreamId=candidate.id;
      await followup({...config,mode:'variants',namespace:'filmix',id:candidate.id},record,token);
    };$('api-results').append(button);
  }
  if(config.provider==='animeon'&&config.mode==='catalog')for(const v of summary.variants||[]){
    const button=el('button',`${v.translation||v.translationId} · ${v.player} · запросить эпизод ${config.episode}`);button.type='button';button.onclick=()=>{if(current===record&&generation===token){confirm('variant.animeon',v);record.config.upstreamId=String(v.playerId);followup({...config,mode:'episodes',translationId:String(v.translationId),playerId:String(v.playerId)},record,token);}};$('api-results').append(button);
  }
}
async function followup(config,record,token){
  const rt=runtime;try{const request=buildRequest(config);step(record,config.mode,'requested');const {data,http}=await fetchJSON(request.url,{signal:rt.controller.signal});if(generation!==token||current!==record)return;const summary=parseCatalog(config.provider,data,config);record.technical.followup=sanitize(summary);step(record,config.mode,'observed',{http});$('api-results').append(el('pre',JSON.stringify(sanitize(summary),null,2)));message('Ответ выбранного варианта сохранён отдельно от основного видео.');}catch(error){if(generation!==token)return;record.technical.followupError={code:error.code,httpStatus:error.httpStatus};step(record,config.mode,'error',{code:error.code,httpStatus:error.httpStatus});message(error.message,true);}
}
async function openConfig(config,ctx=null){
  if(!config.accessAcknowledged)throw new LabError('needs-action','Подтвердите право доступа к тестируемому контенту.');
  if(records.length>=5000)throw new LabError('storage-limit','Лимит 5000 записей: экспортируйте журнал. Старые записи не перезаписываются.');
  // Correctable form validation must not lock the form in an incomplete session.
  if(PROVIDERS[config.provider]?.enabled&&!modeIssue(PROVIDERS[config.provider],config.mode))buildRequest(config);
  if(runtime)closeSource();
  dispose();current=makeRecord({...config,refId:PROVIDERS[config.provider]?.refId||ctx?.item?.refId,upstream:ctx?.item?.upstream||PROVIDERS[config.provider]?.origin||PROVIDERS[config.provider]?.source,upstreamId:config.id},ctx?.run.environment||readEnvironment());
  const record=current;if(ctx){record.runId=ctx.run.runId;record.testId=ctx.item.testId;record.attemptId=ctx.attempt.attemptId;record.previousAttemptId=ctx.attempt.previousAttemptId;record.queueStatus='running';const previous=records.find(r=>r.attemptId===record.previousAttemptId);if(previous&&ctx.item.attempts.length<=3)record.technical.resumePosition=previous.technical.restorePosition??previous.technical.position??0;ctx.attempt.recordId=record.id;}
  records.push(record);const token=generation;
  runtime={controller:new AbortController(),openedAt:performance.now(),iframe:null,video:null,hls:null,attempt:ctx?.attempt,setState:ctx?.setState};
  const rt=runtime;
  $('api-results').replaceChildren();$('main-video-confirmed').checked=false;$('ru-audio').value='unknown';$('measurement-summary').textContent='';
  for(const [id,key] of [['provider','provider'],['title','title'],['type','type'],['namespace','namespace'],['content-id','id'],['season','season'],['episode','episode'],['quality','quality'],['sandbox','sandbox'],['sample','sampleKey']])if(config[key]!==undefined)$(id).value=config[key];
  refreshModes();$('provider-mode').value=config.mode||PROVIDERS[config.provider]?.modes[0];providerInfo();renderCurrent();$('stop').disabled=false;
  if(ctx){ctx.signal.addEventListener('abort',()=>rt.controller.abort(),{once:true});if(ctx.signal.aborted)rt.controller.abort();}
  let request;
  try{
    request=buildRequest(config);step(record,'request','requested',{origin:new URL(request.url).origin,mode:request.mode});
    message('Запрос источника… Каталог, точность ID и основной старт проверяются отдельно.');
    if(request.kind==='iframe'){
      const frame=el('iframe');frame.title=`Внешний плеер ${PROVIDERS[config.provider].name}: ${config.title}`;if(request.sandbox!==null)frame.setAttribute('sandbox',request.sandbox);
      frame.allow='autoplay; fullscreen; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';rt.iframe=frame;rt.origin=request.origin;
      frame.addEventListener('load',()=>{if(generation!==token)return;if(config.provider==='stellar'){frame.contentWindow.postMessage({type:'STELLAR_EMBED_INIT'},request.origin);record.technical.handshake={...(record.technical.handshake||{}),initSent:true};log(record,{type:'handshake-init-sent-not-playback-proof',channel:'lab',origin:request.origin});}log(record,{type:'iframe-load-not-content-proof',channel:'iframe',origin:request.origin});record.layers.player={status:'load-event-only',source:'iframe'};message('Получено событие загрузки iframe. Оно не подтверждает фильм, основной старт или звук.');});
      frame.src=request.url;$('player').replaceChildren(frame);record.technical.iframeOrigin=request.origin;record.technical.sandbox=request.sandbox;record.technical.postMessageContract=['vidapi','vidlink','vidzee','mapple','stellar'].includes(config.provider)?'conservative-documented-events-unverified-main':'not-documented-all-rejected';
      record.technical.controls={pause:'unavailable',seek:'unavailable',sleepTimer:'unavailable',nextEpisode:'не подтверждён; самовольный переход отмечать вручную'};
      $('provenance').textContent=`iframe ${request.origin}; sandbox ${request.sandbox===null?'без изоляции':request.sandbox}. DOM закрыт. Реклама/главное видео требуют наблюдателя.`;
      for(const id of ['play','pause','seek'])$(id).disabled=true;
      persist();if(ctx)await waitForManual(record,ctx);
    }else{
      let stream;
      if(request.kind==='catalog'){
        const {data,http}=await fetchJSON(request.url,{signal:rt.controller.signal});if(generation!==token||rt.controller.signal.aborted)throw new LabError('interrupted','Опыт прерван.');
        const summary=parseCatalog(config.provider,data,config);record.technical.http=http;record.technical.catalogResult=sanitize(summary);record.layers.catalog={status:'observed',source:'api',httpStatus:http.status};record.layers.identity={status:summary.identity,source:'api'};record.layers.variants={status:Array.isArray(summary.variants)?summary.variants.length?'observed':'empty':'unknown',source:'api'};
        step(record,'catalog','observed',{http,identity:summary.identity});renderCatalog(summary,record,config,token);
        $('provenance').textContent=`${http.origin}: ${typeof summary.title==='string'?summary.title:config.title}. ${summary.limit||''}`;
        if(config.provider==='aniliberty'&&config.mode==='media'){
          stream=selectEpisode(data,config.episode,config.quality);record.technical.mediaOrigin=stream.origin;record.technical.releaseTitle=stream.title;record.technical.episodeTitle=stream.episodeName;
          message('Свежий HLS получен. Подтвердите границу основного видео; рекламное время не засчитывается.');mountVideo(stream,record,token,'hls',false);
        }else{
          $('player').replaceChildren(el('p','Каталожный ответ получен. Воспроизведение не заявлено.'));message('Данные API сохранены. Точное совпадение и медиа оцениваются отдельно.');
          if(ctx&&summary.identity==='needs-confirmation')await waitForManual(record,ctx);
        }
      }else{
        stream={url:request.url,origin:new URL(request.url).origin};record.technical.mediaOrigin=stream.origin;
        $('provenance').textContent=config.provider==='blender'?'Sintel © Blender Foundation · sintel.org · CC BY 3.0. Контроль транспорта.':'Apple BipBop HLS: контроль транспорта; не N14 и не RU.';
        mountVideo(stream,record,token,request.kind,true);message('Разрешённый контроль готов. Нажмите Play; звук подтверждается на слух.');
      }
      if(stream&&ctx)await waitForNative(record,ctx);
    }
    if(ctx){record.queueStatus='completed';record.endedAt=new Date().toISOString();step(record,'attempt','completed',{level:evidenceLevel(record)});dispose();renderCurrent();}
    persist();renderHistory();return {recordId:record.id,evidenceLevel:evidenceLevel(record)};
  }catch(error){
    if(generation!==token){if(ctx)throw error;return {recordId:record.id,error:'interrupted'};}
    record.queueStatus=error.code||'app-error';record.status='INCONCLUSIVE';record.technical.apiError=request?.kind==='catalog';record.technical.error={code:error.code||'app-error',httpStatus:error.httpStatus??null,appStatus:error.appStatus??null};
    if(!request)record.technical.blocked=error.code||'unconfirmed-contract';step(record,'attempt','error',{code:error.code,httpStatus:error.httpStatus,appStatus:error.appStatus});record.endedAt=new Date().toISOString();message(error.message,true);persist();renderCurrent();
    if(ctx)throw error;return {recordId:record.id,error:error.code};
  }
}
$('setup-form').addEventListener('submit',async event=>{event.preventDefault();if(current)return;try{await openConfig(readConfig());}catch(error){message(error.message,true);}});
window.addEventListener('message', event => {
  if (!runtime?.iframe || !current) return;
  const result = acceptPostMessage(event, { expectedOrigin: runtime.origin, expectedSource: runtime.iframe.contentWindow, parse: data => parseFrameEvent(data,current.config) });
  // Deliberately no parser for YapGrid; adding one requires a verified contract.
  if(result?.type==='ready'&&current.config.provider==='stellar'){runtime.iframe.contentWindow.postMessage({type:'STELLAR_EMBED_INIT'},runtime.origin);current.technical.handshake={readyObserved:true,initSent:true};log(current,{type:'handshake-ready-init',channel:'postMessage',origin:event.origin});return;}
  if (result) { log(current, { ...result, channel: 'postMessage', origin: event.origin }); current.layers.events={status:'observed-unverified-main',source:'postMessage'}; }
  else {
    current.rejectedMessages = Math.min(1000000, current.rejectedMessages + 1);
    if (!rejectedFlush) rejectedFlush = setTimeout(() => { rejectedFlush = null; persist(); renderEvents(); }, 1000);
  }
});

function parseFrameEvent(data,config){
  if(config.provider==='stellar'&&data.type==='STELLAR_EMBED_READY')return {type:'ready'};
  if(!['vidapi','vidlink','vidzee','mapple','stellar'].includes(config.provider)||data.type!=='PLAYER_EVENT')return null;
  const d=data.data&&typeof data.data==='object'?data.data:data;
  if(d.tmdbId!==undefined&&String(d.tmdbId)!==config.id)return null;
  if(config.type==='tv'&&(d.season!==undefined&&Number(d.season)!==Number(config.season)||d.episode!==undefined&&Number(d.episode)!==Number(config.episode)))return null;
  const type={playing:'playing',play:'play',pause:'pause',paused:'pause',completed:'ended',ended:'ended',seeked:'seeked',timeupdate:'timeupdate',error:'error'}[d.player_status||d.event];if(!type)return null;
  const result={type};if(d.currentTime!==undefined)result.currentTime=d.currentTime;if(d.duration!==undefined)result.duration=d.duration;return result;
}
$('play').addEventListener('click',async()=>{const rt=runtime;if(!rt?.video)return;log(current,{type:'command-play',channel:'lab'});try{await rt.video.play();rt.setState?.(rt.mainVideo?'running':'awaiting-manual');}catch{rt.setState?.('awaiting-user');message('Браузер требует касание. Используйте Play в самом плеере; звук не отключается.',true);}});
$('pause').addEventListener('click',()=>{
  if(!runtime?.video)return;const rt=runtime,record=current;log(record,{type:'command-pause',channel:'lab'});rt.video.pause();const position=rt.video.currentTime;
  setTimeout(()=>{if(rt!==runtime)return;const observed=rt.video.paused&&Math.abs(rt.video.currentTime-position)<.2;record.measurement.commands.pause={status:observed?'observed':'unconfirmed',source:'native-events',position};persist();},450);
});
$('seek').addEventListener('click',()=>{const rt=runtime,record=current,v=rt?.video;if(!v)return;if(!Number.isFinite(v.duration)||v.duration<=0){message('Длительность ещё неизвестна.',true);return;}log(current,{type:'command-seek50',channel:'lab',currentTime:v.duration/2});current.measurement.last=null;v.currentTime=v.duration/2;current.measurement.commands.seek={status:'requested',target:v.duration/2,source:'native-command'};v.addEventListener('seeked',()=>{if(runtime===rt&&current===record&&record.measurement?.commands.seek){record.measurement.commands.seek.status='observed';persist();}},{once:true});});
$('restore-position').onclick=()=>{const v=runtime?.video;if(!v){message('Восстановление недоступно для этого iframe: команды не подтверждены.');return;}const saved=current.technical.restorePosition??current.technical.position??0;current.measurement.last=null;v.currentTime=saved;current.measurement.commands.restore={status:'requested',position:saved,completionUnchanged:true};persist();};
$('sleep-timer').onclick=()=>{if(!runtime?.video){message('Таймер сна недоступен: для iframe нет подтверждённой команды pause.');return;}const rt=runtime,record=current;clearTimeout(rt.sleepTimer);record.technical.restorePosition=rt.video.currentTime;record.measurement.commands.sleepTimer={status:'scheduled',seconds:10};rt.sleepTimer=setTimeout(()=>{if(rt!==runtime)return;rt.video.pause();record.measurement.commands.sleepTimer={status:rt.video.paused?'pause-observed':'unconfirmed',position:rt.video.currentTime,source:'native-events'};record.technical.restorePosition=rt.video.currentTime;persist();message('Таймер: native video поставлен на паузу, позиция сохранена; автопереход отключён.');},10000);persist();message('Через 10 секунд плеер будет поставлен на паузу.');};
$('cancel-timer').onclick=()=>{if(runtime){clearTimeout(runtime.sleepTimer);if(current.measurement?.commands)current.measurement.commands.sleepTimer={status:'cancelled',source:'manual'};persist();}};
$('main-video-confirmed').onchange=()=>{if(!current)return;confirm('mainVideo',$('main-video-confirmed').checked);if(runtime?.video){runtime.mainVideo=$('main-video-confirmed').checked;current.measurement.last=null;if(runtime.mainVideo&&!runtime.video.paused){current.layers.mainVideo={status:'observed',source:'native-events',boundary:'manual-confirmed'};runtime.setState?.('running');}}else current.layers.mainVideo={status:$('main-video-confirmed').checked?'observed-manual':'unknown',source:'manual'};persist();};
$('ru-audio').onchange=()=>{if(current){confirm('ruAudio',$('ru-audio').value);current.layers.audio={status:$('ru-audio').value,source:'manual-listening'};persist();}};
$('confirm-identity').onclick=()=>{if(current){confirm('identity.exact',true);current.layers.identity={status:'matched-manual',source:'manual'};current.checks.exactTitle='PASS';observations.get('checks.exactTitle').value='PASS';persist();message('Точное совпадение сохранено как ручное подтверждение.');}};
$('complete-current').onclick=()=>{runtime?.manualResolve?.();};
$('add-ad').onclick=()=>{if(!current)return;const raw=$('ad-duration').value,duration=raw===''?null:Number(raw);if(duration!==null&&(!Number.isFinite(duration)||duration<0||duration>14400)){message('Некорректная длительность рекламы.',true);return;}current.adBreaks||=[];current.adBreaks.push({type:$('ad-type').value,durationSeconds:duration,count:1,skippable:$('ad-skippable').value,at:new Date().toISOString(),position:runtime?.video?.currentTime??null,source:'manual'});$('ad-count').textContent=`Зафиксировано вставок/наблюдений: ${current.adBreaks.length}. Неизвестное не означает ноль.`;confirm('advertising',current.adBreaks.at(-1));if(runtime?.video&&runtime.mainVideo&&['pre-roll','mid-roll','post-roll'].includes($('ad-type').value)){excludeUncertainAdWindow(current.measurement);runtime.mainVideo=false;$('main-video-confirmed').checked=false;current.layers.mainVideo={status:'needs-boundary-confirmation',source:'manual-ad-report'};message('Граница рекламы не установлена. Предыдущее окно сохранено отдельно как неопределённое; подтвердите основной материал после вставки.');}persist();};
function exportSelection(){
  const scope=$('export-scope').value;if(scope==='all')return {records,runs};
  const selected=scope==='run'?records.filter(r=>r.runId===batchUI?.selectedRun?.runId):records.filter(r=>r.id===current?.id);
  const ids=new Set(selected.map(r=>r.config.e1RecordId).filter(Boolean));return {records:[...selected,...records.filter(r=>ids.has(r.id)&&!selected.includes(r))],runs:scope==='run'&&batchUI?.selectedRun?[batchUI.selectedRun]:[]};
}
const jsonExport=()=>{const s=exportSelection();return exportJSON(s.records,undefined,s.runs);};
const csvExport=()=>{const s=exportSelection();return exportCSV(s.records,s.runs);};
$('export-json').addEventListener('click', () => { persist(); download(jsonExport(), filename('json'), 'application/json'); });
$('export-csv').addEventListener('click', () => { persist(); download(csvExport(), filename('csv'), 'text/csv;charset=utf-8'); });
$('export-recovery').addEventListener('click', () => download(loaded.raw || '', filename('recovery.txt'), 'text/plain;charset=utf-8'));
$('share-json').addEventListener('click', async () => {
  const file = new File([jsonExport()], filename('json'), { type: 'application/json' });
  if (!navigator.canShare?.({ files: [file] })) { download(jsonExport(), file.name, 'application/json'); message('Файловый Share недоступен: JSON подготовлен как загрузка. Сохраните его в «Файлы».'); return; }
  try { await navigator.share({ files: [file], title: 'КАДР 1.2: журнал испытаний' }); }
  catch (error) { if (error.name !== 'AbortError') message('Не удалось передать файл. Используйте «Скачать JSON».', true); }
});

$('import-json').onchange=async()=>{
  if(runtime||batchUI?.runner.busy){message('Перед импортом закройте источник и приостановите очередь.',true);return;}
  const file=$('import-json').files[0];if(!file)return;if(file.size>20*1024*1024){message('JSON больше 20 МиБ.',true);return;}
  try{const merged=mergeExports({records,runs},JSON.parse(await file.text()));records.splice(0,records.length,...merged.records);runs.splice(0,runs.length,...recoverRuns(merged.runs));persist();renderHistory();batchUI?.render();message('Журналы объединены по устойчивым ID без повторного добавления тех же попыток.');}catch(e){message(e.message,true);}
};
function interrupt(reason){
  batchUI?.pause(reason);
  if(runtime?.video){current.technical.restorePosition=runtime.video.currentTime;runtime.video.pause();if(current.measurement)current.measurement.last=null;log(current,{type:reason,channel:'lab'});}
  if(runtime?.iframe&&!batchUI?.runner.busy){current.technical.interruption=reason;closeSource();}
  persist();
}
function onlineStatus(){ $('offline').hidden=navigator.onLine;if(!navigator.onLine)interrupt('network-offline'); }
window.addEventListener('online',onlineStatus);window.addEventListener('offline',onlineStatus);onlineStatus();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')interrupt('page-hidden');});
window.addEventListener('pagehide',()=>interrupt('page-unload'));
function renderRegistry(){
  const query=$('registry-search').value.trim().toLowerCase(),items=registry.filter(r=>`${r.id} ${r.name} ${r.adapters.join(' ')}`.toLowerCase().includes(query));
  $('registry-count').textContent=`Показано ${items.length} из ${registry.length}. Статусы исследования не являются новыми опытами.`;
  $('registry').replaceChildren(...items.map(r=>{const d=el('details');d.append(el('summary',`${r.id} · ${r.name} · ${r.status}`));d.addEventListener('toggle',()=>{if(!d.open||d.querySelector('pre'))return;d.append(el('pre',JSON.stringify(r,null,2)));});return d;}));
}
$('registry-search').oninput=renderRegistry;

async function boot() {
  try {
    const response = await fetch('./data/samples.json'); if (!response.ok) throw new Error(); samples = await response.json(); samples.push({key:'apple',title:'Apple BipBop HLS',type:'control',category:'control'},{key:'blender',title:'Sintel trailer © Blender Foundation · CC BY 3.0',type:'control',category:'control'},{key:'archive-sintel',title:'Sintel (2010) · метаданные Internet Archive',type:'control',category:'control-data',year:2010,archive:'Sintel'});
    for (const sample of samples) { const option = el('option', `${sample.title}${sample.year?` (${sample.year})`:''}`); option.value = sample.key; $('sample').append(option); }
  } catch { message('Выборка не загрузилась. Можно ввести документированный ID вручную.', true); }
  try {const r=await fetch('./data/registry.json');if(!r.ok)throw new Error();registry=await r.json();renderRegistry();}catch{message('Реестр не загрузился. Готовые режимы и ручной ID доступны.',true);}
  batchUI=initBatchUI({registry,samples,records,runs,execute:(item,attempt,ctx)=>openConfig(item.config,{...ctx,item,attempt}),persist,environment:readEnvironment,notice:message});
  $('build-info').textContent=`Стенд ${BUILD.version} · commit ${BUILD.commit} · сборка ${BUILD.builtAt}. Физический iPhone/РФ не проверены исполнителем.`;
  if (current) {
    const config = current.config; const env = current.environment;
    for (const [id, key] of [['provider','provider'], ['sample','sampleKey'], ['title','title'], ['type','type'], ['namespace','namespace'], ['content-id','id'], ['season','season'], ['episode','episode'], ['quality','quality'], ['sandbox','sandbox'], ['stage','stage'], ['watch-scope','watchScope']]) if (config[key] !== undefined) $(id).value = config[key];
    for (const key of ['device','country','network','blocker']) if (env[key] !== undefined) $(key).value = env[key];
    if (!PROVIDERS[$('provider').value]) $('provider').value = 'aniliberty';
    refreshModes();$('provider-mode').value=config.mode||PROVIDERS[$('provider').value].modes[0];$('release-year').value=config.year||'';
    $('access-consent').checked = Boolean(config.accessAcknowledged);
    providerInfo(); renderCurrent();
    message('Журнал восстановлен. Источник автоматически не открывается. Допишите наблюдения или создайте новый сеанс для повторного запуска.');
  } else { $('sample').value = samples.some(item => item.key === 'dandadan') ? 'dandadan' : 'custom'; applySample(); providerInfo(); renderCurrent(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then(reg=>{const show=()=>{if(reg.waiting)$('update-app').hidden=false;};show();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',show));$('update-app').onclick=()=>{interrupt('app-update');reg.waiting?.postMessage({type:'SKIP_WAITING'});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});};}).catch(() => { $('offline').hidden = false; $('offline').textContent = 'Офлайн-оболочка не установилась. Онлайн-стенд доступен; экспортируйте журнал перед закрытием.'; });
}
boot();
