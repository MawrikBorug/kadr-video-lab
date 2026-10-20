import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PROVIDERS} from '../web/providers.js';
// Raw owner exports remain outside the public repository. Re-run with the
// delivered source journal to reproduce this inventory without inventing trials.
const file=process.argv[2],sourceURL=process.argv[3];
if(!file||!sourceURL)throw new Error('Usage: node scripts/audit-phone.mjs <owner.json> <verified-drive-url>');
const raw=await readFile(file),journal=JSON.parse(raw),registry=JSON.parse(await readFile('web/data/registry.json'));
const source={name:'kadr-1.3-2026-10-20T02-45-36.502Z.json',sha256:createHash('sha256').update(raw).digest('hex'),url:sourceURL,recordCount:journal.records.length,runCount:journal.runs.length,build:journal.build,origin:'owner-physical-iPhone-export'};
const rows=[];
for(const p of registry){
 const records=journal.records.filter(r=>PROVIDERS[r.config.provider]?.refId===p.id||r.config.provider===p.providerKey);
 const manual=records.filter(r=>r.manualConfirmations?.some(c=>c.field==='mainVideo'&&c.value===true&&c.source==='manual'));
 const native=records.filter(r=>r.events.some(e=>e.channel==='native'&&e.type==='playing'));
 const catalog=records.filter(r=>r.layers?.catalog?.status==='observed'||r.technical.apiResponded);
 const skips=records.filter(r=>r.technical.interruptionReason?.code==='manual-skip');
 let state='no-phone-attempt',why='В исходном телефонном журнале нет опыта этого направления. '+p.stageReview.reason;
 if(records.length){state='preparatory-only';why='Сохранены предварительные записи/каталог или блокер контракта. Основное видео не подтверждено.';}
 if(records.some(r=>r.layers?.player||r.technical.iframeOrigin)){state='diagnostic-only';why='Загрузка iframe или диагностическое сообщение не подтверждает просмотр основного видео.';}
 if(skips.length){state='manual-skip';why='Пропущено владельцем: '+[...new Set(skips.map(r=>r.technical.interruptionReason.reason))].join('; ')+'. Это причина пропуска, а не подтверждение просмотра.';}
 if(native.length){state='native-transport-observed-main-unconfirmed';why='Старые native playing/timeupdate сохранены: транспорт воспроизводился. Граница основного видео, длительность без перемоток и русский звук не подтверждены. Каталог отдельно подтверждён. Это частичное испытание, не отсутствие всех технических наблюдений.';}
 if(manual.length){state='main-video-confirmed-manual';why='Основное видео вручную подтверждено для конкретного варианта. Вывод не распространяется на весь сервис.';}
 if(p.id==='X08'){state='own-access-blocked';why='Владелец сообщил ожидание модерации. Оба предоставленных значения ключа базы отклонены известным API (invalid token в HTTP 200). Шаблон embed и отдельный player token прочитаны со скриншотов. Актуальная документация кабинета недоступна; Vercel scope 403. Каталог/варианты/штатный iframe/видео собственным доступом не подтверждены.';}
 const queueItems=journal.runs.flatMap(run=>(run.queue||[]).filter(i=>i.refId===p.id).map(i=>({runId:run.runId,testId:i.testId,status:i.status,reason:i.reason,attempts:i.attempts.length})));
 const modes=(p.stageReview.modes||[]).map(m=>({provider:m.provider,mode:m.mode,kind:m.kind,source:m.source}));
 const row={researchId:p.id,name:p.name,role:p.role,entityType:p.stageReview.entityType,upstream:p.sharedUpstreams,relatedIds:p.relatedIds,adapters:p.adapters,implementedModes:modes,phoneState:state,mainVideoConfirmed:manual.length>0,whatChecked:{research:p.stageReview.checksPerformed,phoneRecords:records.map(r=>({recordId:r.id,attemptId:r.attemptId||r.id,testId:r.testId||r.id,runId:r.runId||null,provider:r.config.provider,mode:r.config.mode||'legacy',title:r.config.title,year:r.config.year||null,season:r.config.season,episode:r.config.episode,queueStatus:r.queueStatus||null,checks:r.checks,reason:r.technical.interruptionReason||null,catalogObserved:catalog.includes(r),nativePlaying:native.includes(r),maxNativePosition:Math.max(0,...r.events.filter(e=>e.channel==='native').map(e=>Number(e.currentTime)||0)),manualMainVideo:manual.includes(r)})),queueItems},whyVideoNotConfirmed:why,evidence:{phone:sourceURL,recordIds:records.map(r=>r.id),primaryLinks:p.sources,cloudChecks:(p.stageReview.checks||[]).map(c=>({url:c.url,status:c.status,utc:c.utc}))},scope:'this-direction-and-observed-attempts-only',outlook:'not-assessed'};
 rows.push(row);
 p.cleanup14={active:p.id==='X08',phoneState:state,reason:why,archiveDoesNotMeanPermanentFailure:true};
}
const inventory={version:'1.4',date:'2026-10-20',source,definition:'Перечень без подтверждённого просмотра. Предварительные проверки, native transport без границы main video, диагностика, ошибки и пропуски различаются. Пропуск не считается проведённым просмотром. Успех upstream не переносится на другие оболочки.',totalResearchDirections:registry.length,confirmedDirections:rows.filter(r=>r.mainVideoConfirmed).map(r=>({researchId:r.researchId,name:r.name,phoneState:r.phoneState,evidence:r.evidence})),directions:rows.filter(r=>!r.mainVideoConfirmed)};
const csvCell=v=>'"'+String(typeof v==='object'?JSON.stringify(v):v??'').replaceAll('"','""')+'"';
const columns=['researchId','name','entityType','upstream','relatedIds','implementedModes','phoneState','whatChecked','whyVideoNotConfirmed','evidence','outlook'];
await writeFile('web/data/untested-1.4.json',JSON.stringify(inventory,null,2)+'\n');
await writeFile('web/data/untested-1.4.csv','\uFEFF'+[columns,...inventory.directions.map(r=>columns.map(k=>r[k]))].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');
await writeFile('web/data/registry.json',JSON.stringify(registry,null,2)+'\n');
await writeFile('evidence/phone-audit-1.4.json',JSON.stringify({source,directions:rows},null,2)+'\n');
console.log(JSON.stringify({total:rows.length,withoutConfirmedVideo:inventory.directions.length,confirmed:inventory.confirmedDirections.map(r=>r.researchId)}));
