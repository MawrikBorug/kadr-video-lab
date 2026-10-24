import {WORKS,LIMITS,workQuery,streamId} from './search-config.mjs';
import {SearchSession,SEARCH_JOURNAL_KEY,safeSearchResult} from './search-session.mjs';
import {CandidateProbe,applyFile} from './source-probe.mjs';
import {TorrentSession} from './torrent.mjs';
import {checkSupplement,normalizeStream} from './source-search.mjs';
import {SourceError,failure,now,safeText} from './source-utils.mjs';
import {explicitFileAllowed,parseMetadata} from './torrent-metadata.mjs';
const $=id=>document.getElementById(id);
const CODE_LABELS={NETWORK_OR_CORS:'Сеть / CORS / отказ сетевой среды; браузер не раскрывает точную причину',HTTP_ERROR:'HTTP-отказ',
  TIMEOUT:'Сетевой тайм-аут',MANIFEST_INVALID:'Неверный манифест',JSON_PARSE:'Ошибка JSON',CONFIGURATION_REQUIRED:'Нужна настройка подключения',
  CONFIGURATION_NOTICE:'Уведомление о настройке',EMPTY_STREAMS:'Пустая выдача',NOTICE_OR_UNSUPPORTED:'Уведомление или неподдерживаемый результат',
  RATE_LIMIT:'429 · ограничение запросов',RATE_LIMIT_COOLDOWN:'Ожидание Retry-After',STREAMS_INVALID:'Неверный формат streams',
  FILE_UNRESOLVED:'Файл серии не определён',PAYLOAD_BUDGET:'Ограничение проверки: трафик / размер torrent piece',
  CANDIDATE_TIME_LIMIT:'Ограничение проверки: время',METADATA_SIZE_LIMIT:'Ограничение проверки: размер metadata',
  QUEUE_TIME_LIMIT:'Ограничение проверки: 60 секунд на очередь',DUPLICATE_RESOLVED_FILE:'Файл уже проверен в этом поиске; повторная доставка не запущена',
  METADATA_OR_SEARCH_BUDGET:'Ограничение проверки: metadata / поисковый трафик',SIZE_LIMIT:'Ограничение размера ответа',
  LOCAL_ICE_NO_CANDIDATES:'Локальная ICE-проба не получила кандидатов; WebRTC-данные не получены',
  NO_WEBRTC_BYTES_IN_WINDOW:'За время проверки WebRTC-данные не получены',
  'webseed-not-found':'Webseed не найден в доступных метаданных','metadata-unavailable':'Metadata не получены; наличие webseed неизвестно',
  HLS_REQUIRES_EXPLICIT_PLAY:'HLS: требуется явный запуск и проверка Safari',DIRECT_REQUIRES_HEADERS:'Прямая ссылка требует заголовков; браузерный путь не подтверждён',
  DASH_NATIVE_UNSUPPORTED:'Нет подтверждённого native DASH пути',CANCELLED:'Проверка отменена',PIECE_HASH_MISMATCH:'Байты не совпали с torrent piece hash'};
const label=code=>CODE_LABELS[code] || code;
function transportLabel(c){
  if(c.states.transport==='checking')return 'Проверяем доставку';
  if(c.states.A==='bytes-received')return 'Данные поступают через A';
  if(c.states.B==='bytes-received')return 'Данные поступают через B';
  if(c.states.direct==='bytes-received')return 'Данные поступают по прямой ссылке';
  return c.probeReason?label(c.probeReason):'Найдено — ещё не проверено';
}
function wrongEpisode(file,work){
  const m=[...file.path.matchAll(/S(\d{1,2})[ ._\-]*E(\d{1,3})(?!\d)/gi)];
  return work.type==='series' && m.length && !m.some(x=>+x[1]===work.season && +x[2]===work.episode);
}
export async function mountSearch({video,closeExisting,openLift,download,showFoundPlayer=()=>{},restoreContext=()=>{}}) {
  let config={mappings:[],packages:[]};
  const snapshots=await Promise.allSettled(['packages.json','metadata-sources.json'].map(async name=>{
    const r=await fetch('./search-fixtures/'+name);if(!r.ok)throw Error('metadata snapshot unavailable');return r.json();
  }));
  for(const snapshot of snapshots)if(snapshot.status==='fulfilled'){
    config.packages.push(...(snapshot.value.packages || []));config.mappings.push(...(snapshot.value.mappings || []));
  }
  const environment={mode:matchMedia('(display-mode: standalone)').matches || navigator.standalone===true?'standalone':'browser',
    onlineAtStart:navigator.onLine,secureContext:isSecureContext,deviceVerification:'Physical device is not inferred from viewport or UA'};
  let history={schema:1,runs:[],positions:{}},storageOK=true;
  try{const raw=localStorage.getItem(SEARCH_JOURNAL_KEY);if(raw){history=JSON.parse(raw);if(history.schema!==1 || !Array.isArray(history.runs) || !history.positions)throw Error();}}
  catch{storageOK=false;history={schema:1,runs:[],positions:{}};}
  let current=null,selected=null,player=null,manualAbort=null,supplementAbort=null,transition=false,renderTimer=null,shown=20,fileSignature='';
  let restoreBaseline=null,playerEpoch=0,videoHandlers=[];
  let metadataBusy=false,metadataEpoch=0;
  // A visible card can outlive its session (including an already queued click).
  // Check both the owner and candidate before every action and after awaits.
  const active=(session=current,candidate=null)=>!!session && current===session && !session.cancelled &&
    (!candidate || session.run.candidates.includes(candidate));
  const selectedWork=()=>workQuery(WORKS.find(w=>w.key===$('search-work').value),$('search-season').value,$('search-episode').value);
  function persist(run){
    if(run){const index=history.runs.findIndex(r=>r.searchId===run.searchId);const safe=safeSearchResult(run);if(index<0)history.runs.push(safe);else history.runs[index]=safe;}
    if(storageOK)try{localStorage.setItem(SEARCH_JOURNAL_KEY,JSON.stringify(history));$('search-storage-status').textContent=`Поисковый журнал сохранён · прогонов ${history.runs.length}. Прежние журналы сохранены отдельно.`;return;}catch{storageOK=false;}
    $('search-storage-status').textContent='Журнал поиска доступен в памяти. Ошибка доступа / места / формата; прежнее значение не перезаписано. Экспортируйте JSON.';
  }
  function schedule(){if(renderTimer)return;renderTimer=setTimeout(()=>{renderTimer=null;render();},180);}
  function options(){
    const w=WORKS.find(w=>w.key===$('search-work').value);$('search-episodes').hidden=w.type==='movie';
    const old=$('search-season').value;$('search-season').replaceChildren(...Array.from({length:w.seasons},(_,i)=>new Option(`Сезон ${i+1}`,String(i+1))));
    if([...$('search-season').options].some(o=>o.value===old))$('search-season').value=old;
    $('search-identity').textContent=`${w.imdb} · ${w.type} · ${w.year} · запрос ${streamId(selectedWork())}`;
  }
  const matches=c=>(!$('search-quality').value || (c.claims.resolution || 'unknown')===$('search-quality').value) &&
    (!$('search-language').value || [...c.claims.languages,...c.claims.voiceLabels,...(!c.claims.languages.length && !c.claims.voiceLabels.length?['unknown']:[])].includes($('search-language').value));
  function filters(){
    if(!current)return;
    for(const [id,values] of [['search-quality',current.run.candidates.map(c=>c.claims.resolution || 'unknown')],
      ['search-language',current.run.candidates.flatMap(c=>[...c.claims.languages,...c.claims.voiceLabels,...(!c.claims.languages.length && !c.claims.voiceLabels.length?['unknown']:[])])]]){
      const el=$(id),old=el.value;el.replaceChildren(new Option('Все, включая неизвестное',''),...[...new Set(values)].sort().map(v=>new Option(v==='unknown'?'Неизвестно':v,v)));
      if([...el.options].some(o=>o.value===old))el.value=old;
    }
  }
  function render(){
    if(!current)return;
    const session=current,r=session.run;filters();
    $('search-hosts').replaceChildren(...r.hostStates.map(s=>{const p=document.createElement('p');p.textContent=`${s.host} · ${s.phase} · ${label(s.code || s.state)}${s.httpStatus?' · HTTP '+s.httpStatus:''}${s.accepted!=null?' · кандидатов '+s.accepted:''}${s.retryAfter!=null?' · повтор не раньше '+s.retryAfter+' с':''} · ${s.elapsedMs} мс`;return p;}));
    $('search-status').textContent=`Поиск: ${r.searchState==='finished'?'завершён':r.searchState==='cancelled'?'отменён':'идёт'}. Проверка: ${{waiting:'ожидание',checking:'идёт',paused:'остановлена',stopped:'лимит времени / остановка','batch-complete':'первые кандидаты проверены','waiting-for-results':'ожидание выдачи','time-limit':'лимит времени'}[r.queueState] || r.queueState}.`;
    if(session.cancelled)$('search-status').textContent='Поиск закрыт. Результаты сохранены для просмотра; для запуска выполните новый поиск.';
    $('search-limits').textContent=`Лимиты: ${LIMITS.candidates} кандидата, ${LIMITS.concurrency} активная проба, ${LIMITS.candidateMs/1000} с / кандидат, ${LIMITS.queueMs/1000} с / очередь; payload 16 МиБ на поиск; metadata 1 МиБ / файл, 4 МиБ / поиск; поиск 12 МиБ / ответ, 24 МиБ суммарно. Получено: поиск ${r.counters.searchBytes || 0} Б, metadata ${r.counters.metadataBytes || 0} Б, payload ${r.counters.payloadBytes || 0} Б. Новая ручная очередь получает 60 с, общий бюджет байтов не сбрасывается.`;
    const candidates=r.candidates.filter(matches);$('search-count').textContent=`Найдено уникальных источников: ${r.candidates.length}; по фильтрам: ${candidates.length}. Live · ${r.work.ru}${r.work.season?' · S'+r.work.season+'E'+r.work.episode:''}.`;
    $('search-results').replaceChildren(...candidates.slice(0,shown).map(c=>{
      const article=document.createElement('article');article.className='source-result';article.dataset.selected=String(c===selected);
      const source=document.createElement('p');source.className='meta';source.textContent=`${c.dataMode==='live'?'LIVE':'OFFLINE FIXTURE'} · ${c.origins.join('; ')} · ${c.provenance.upstreamLabels.join(', ')}`;
      const title=document.createElement('p');title.className='release';title.textContent=c.identity.rawReleaseTitle;
      const status=document.createElement('p');status.className='source-states';status.textContent=transportLabel(c);
      const playback=document.createElement('p');playback.textContent=c.states.playback==='confirmed' || (c.states.playback==='ended' && c.playbackEvidence)?'Воспроизведение подтверждено на этом устройстве':'Воспроизведение не подтверждено';
      if(c.states.playback==='ended')playback.textContent+=' · получен настоящий ended';
      const file=document.createElement('p');file.textContent=c.torrent.infoHash?`infohash ${c.torrent.infoHash.slice(0,12)}… · ${c.torrent.metadataHashVerified?'metadata SHA-1 подтверждён':'metadata не подтверждены'} · ${c.states.file==='verified'?`fileIdx ${c.torrent.fileIdx} · ${c.torrent.filePath}`:'Файл серии не определён; fileIdx '+(c.torrent.fileIdx ?? '?')+' — заявление поставщика'}`:`Прямой ${c.delivery.kind}; совместимость не подтверждена`;
      const reason=document.createElement('p');reason.className='meta';reason.textContent=`A: ${label(c.states.A)}. B: ${label(c.states.B)}.${c.probe?` Metadata ${c.probe.metadataBytes} Б; подключено пиров ${c.probe.connectedWires}; WebRTC ${c.probe.webrtcBytes} Б; HTTP ${c.probe.httpBytes} Б; проверено hash ${c.probe.verifiedBytes} Б.`:''}`;
      if(c.identity.match==='rejected')reason.textContent+=' Отклонён: '+c.identity.reason;
      const b=document.createElement('button');b.disabled=!active(session,c);b.textContent=session.cancelled?'Поиск закрыт · найдите заново':c===selected?'Источник выбран':'Выбрать источник / файл';
      b.onclick=()=>{if(!active(session,c))return;selected=c;fileSignature='';render();};
      article.append(source,title,status,playback,file,reason,b);return article;
    }));$('search-more').hidden=candidates.length<=shown;
    $('search-stop').disabled=!current || current.cancelled || current.queuePaused;
    $('search-next').disabled=!current || current.cancelled || !!player || !!manualAbort;
    $('search-supplements').disabled=!active();
    $('search-log').textContent=JSON.stringify(r.events.slice(-10),null,2);renderSelected();
  }
  function renderSelected(){
    $('search-selected').hidden=!selected || !active(current,selected);if(!selected || !active(current,selected))return;
    const c=selected,locator=current.vault.get(c),meta=locator?.meta;
    const nativeNyaa=!!c.torrent.infoHash && c.provenance.upstreamLabels.some(s=>/^Nyaa$/i.test(s));
    $('search-metadata-origin').hidden=!nativeNyaa;
    if(nativeNyaa)$('search-metadata-origin').href='https://nyaa.si/?q='+c.torrent.infoHash;else $('search-metadata-origin').removeAttribute('href');
    $('search-metadata-file').hidden=!c.torrent.infoHash;$('search-metadata-file').disabled=metadataBusy || !!player || !!manualAbort;
    $('search-reprobe').disabled=metadataBusy || transition || !!player || !!manualAbort;
    $('search-metadata-status').textContent=c.metadataImportStatus || (meta?`Metadata SHA-1 совпал с magnet · файлов ${meta.files.length} · ${c.metadataProvenance?.dataMode || 'verified'}`:'Metadata пока не получены. Можно открыть .torrent из «Файлов»; совпадение с magnet проверится до выбора видео.');
    $('search-selected-title').textContent=c.identity.rawReleaseTitle.split('\n')[0];
    $('search-file-status').textContent=`${c.identity.reason || 'Выбор файла не проверен'}${c.metadataProvenance?' · '+c.metadataProvenance.dataMode+' · '+c.metadataProvenance.host:''}`;
    const sig=c.candidateId+':'+!!meta+':'+c.torrent.fileIdx;
    if(sig!==fileSignature){
      fileSignature=sig;$('search-file').replaceChildren(new Option(meta?'Выберите точный файл, если не определён':'Список появится после получения metadata',''));
      if(meta)for(const f of meta.files){const allowed=explicitFileAllowed(meta,f,c.work,config.mappings);const o=new Option(`${f.fileIdx} · ${f.path} · ${f.length} Б${!f.video?' · не видео / sample':''}${!allowed && f.video?' · не выбранная серия':''}`,String(f.fileIdx));o.disabled=!allowed;$('search-file').add(o);}
      $('search-file').value=meta && c.torrent.fileIdx!=null?String(c.torrent.fileIdx):'';
    }
    $('search-file').disabled=!meta || !!player || !!manualAbort || metadataBusy;
    $('search-play-a').hidden=!c.torrent.infoHash;$('search-play-b').hidden=!c.torrent.infoHash;$('search-play-direct').hidden=!!c.torrent.infoHash;
    $('search-play-b').disabled=!meta?.webseeds.length || c.states.file!=='verified' || transition || metadataBusy || !!manualAbort;
    $('search-play-a').disabled=transition || metadataBusy || !!manualAbort;$('search-play-direct').disabled=transition || metadataBusy || !!manualAbort;
    $('search-player-stop').disabled=!player && !manualAbort;
  }
  async function cancel(reason){
    const session=current;supplementAbort?.abort();manualAbort?.abort();
    metadataEpoch++;metadataBusy=false;
    // cancel() invalidates the session synchronously, before teardown awaits.
    const cancellation=session?.cancel(reason);
    selected=null;fileSignature='';$('search-selected').hidden=true;render();
    await stopPlayer();await cancellation;if(current===session)render();
  }
  async function begin(){
    if(transition)return;transition=true;$('search-start').disabled=true;
    try {
      await cancel('new-search');await closeExisting();shown=20;
      const session=current=new SearchSession({work:selectedWork(),environment,mappings:config.mappings,packages:config.packages,onChange:schedule,onSave:persist});
      session.filter=matches;selected=null;$('search-play-status').textContent='';render();
      session.start().catch(e=>{session.event('search_error',failure(e));});
    }finally{transition=false;$('search-start').disabled=false;}
  }
  async function changedSelection(){
    $('search-start').disabled=true;try{await cancel('work-or-episode-changed');current=null;$('search-results').replaceChildren();$('search-count').textContent='';$('search-status').textContent='Выбор изменён. Предыдущие запросы и пробы отменены.';options();}
    finally{$('search-start').disabled=false;}
  }
  const positionKey=c=>[c.work.imdb,c.work.season ?? '-',c.work.episode ?? '-',c.torrent.infoHash || c.provenance.instanceId,c.torrent.fileIdx ?? c.delivery.kind].join(':');
  function mediaEvent(c,data,session,epoch){
    if(!active(session,c) || playerEpoch!==epoch)return;
    session.event('player',{candidateId:c.candidateId,...data});
    if(data.event==='playing' && data.trusted){c.states.playback='playing-awaiting-time';c.playAnchor=data.time;}
    if(data.event==='seeking')c.playAnchor=null;
    if(data.event==='timeupdate' && data.trusted && !video.paused && !video.seeking && c.playAnchor!=null && data.time>c.playAnchor+.25){
      c.states.playback='confirmed';c.playbackEvidence={confirmedAt:now(),time:data.time,basis:'trusted playing + advancing trusted currentTime; not seeking'};$('search-play-status').textContent='Воспроизведение подтверждено на этом устройстве: настоящий playing и продвижение currentTime.';
    }
    if(['timeupdate','seeked'].includes(data.event) && data.trusted && Number.isFinite(data.duration) && data.duration>0 && Number.isFinite(data.time)){
      history.positions[positionKey(c)]={time:data.time,duration:data.duration,utc:now(),searchId:session.run.searchId};persist();
    }
    if(data.event==='error'){$('search-play-status').textContent=`MediaError ${data.mediaErrorCode || video.error?.code || 'unknown'} · кодеки / доставка не подтверждены`;c.states.playback='media-error';}
    if(data.event==='ended' && data.trusted){c.states.playback='ended';session.event('ended',{candidateId:c.candidateId,time:data.time});}
    schedule();
  }
  async function play(mode){
    if(!selected || !active(current,selected) || transition || metadataBusy || manualAbort)return;transition=true;manualAbort=new AbortController();const abort=manualAbort;
    const c=selected,session=current;let epoch;
    try{
      await session.stopQueue('player-priority');await stopPlayer(false);await closeExisting();epoch=++playerEpoch;
      if(!active(session,c) || abort.signal.aborted)return;
      c.states.playback='unverified';c.playbackEvidence=null;c.playAnchor=null;
      session.event('play_requested',{candidateId:c.candidateId,transport:mode});$('search-play-status').textContent='Подготовка выбранного файла. После подготовки нажмите Play в области видео ниже.';renderSelected();
      const locator=session.vault.get(c);if(!locator)throw new SourceError('SOURCE_EXPIRED_SEARCH_AGAIN');
      if(c.identity.match!=='exact-id')throw new SourceError('SOURCE_IDENTITY_UNRESOLVED');
      if(c.torrent.infoHash && !locator.meta){
        const probe=new CandidateProbe({candidate:c,vault:session.vault,budget:session.budget,limits:LIMITS,mappings:config.mappings,packages:config.packages,
          signal:abort.signal,onChange:schedule,onEvent:(kind,details)=>session.event(kind,{candidateId:c.candidateId,...details})});await probe.run();
      }
      if(abort.signal.aborted || !active(session,c))return;
      restoreBaseline=history.positions[positionKey(c)] || null;
      $('search-restore').disabled=!restoreBaseline;
      if(c.torrent.infoHash){
        if(!locator.meta)throw new SourceError('METADATA_UNAVAILABLE_RETRY_OR_LIFT');
        const file=applyFile(c,locator.meta,config.mappings,locator);
        if(wrongEpisode(file,c.work))throw new SourceError('WRONG_EPISODE');
        if(mode==='B' && !locator.meta.webseeds.length)throw new SourceError('webseed-not-found');
        const material={id:c.candidateId,infoHash:c.torrent.infoHash,metadataBuffer:locator.metadata,
          metadataSource:c.metadataProvenance?`Reused ${c.metadataProvenance.dataMode} · ${c.metadataProvenance.host}`:'Reused hash-verified metadata in this search',fileIdx:file.fileIdx,filePath:file.path,
          filename:file.path.split('/').at(-1),size:file.length,container:c.claims.container || 'unknown',codecs:c.claims.videoCodec || 'unknown'};
        const transport=new TorrentSession({video,material,mode:mode==='B'?'wt-http':'wt-webrtc',downloadLimit:file.length<1048576?32768:524288,
          onEvent:(kind,data)=>{if(!active(session,c) || playerEpoch!==epoch)return;session.event(kind,{candidateId:c.candidateId,...data});if(kind==='native_video')mediaEvent(c,data,session,epoch);},
          onStats:stats=>{if(!active(session,c) || playerEpoch!==epoch)return;c.playerTransport=stats;schedule();},
          onError:reason=>{if(!active(session,c) || playerEpoch!==epoch)return;$('search-play-status').textContent=safeText(reason);session.event('player_failure',{candidateId:c.candidateId,reason:safeText(reason)});}});
        player=transport;await transport.start();
      }else{
        if(new URL(locator.direct).protocol!=='https:')throw new SourceError('DIRECT_INSECURE_HTTP');
        if(c.delivery.requiresHeaders.length)throw new SourceError('DIRECT_REQUIRES_HEADERS');
        if(c.delivery.kind==='dash')throw new SourceError('DASH_NATIVE_UNSUPPORTED');
        if(c.delivery.kind==='hls' && !video.canPlayType('application/vnd.apple.mpegurl'))throw new SourceError('HLS_NATIVE_UNSUPPORTED_ON_THIS_DEVICE');
        for(const type of ['loadedmetadata','playing','timeupdate','seeking','seeked','ended','pause','waiting','error']){
          const handler=e=>mediaEvent(c,{event:type,trusted:e.isTrusted,time:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null},session,epoch);
          video.addEventListener(type,handler);videoHandlers.push([type,handler]);
        }
        player={stop:async()=>{video.pause();video.removeAttribute('src');video.load();},restore:time=>{video.currentTime=time;return true;}};video.src=locator.direct;
      }
      if(abort.signal.aborted || !active(session,c)){await stopPlayer();return;}
      video.hidden=false;$('placeholder').hidden=true;
      showFoundPlayer(c,mode);
      $('stop').disabled=false;
      session.run.playback={candidateId:c.candidateId,transport:mode,started:now(),positionIdentity:positionKey(c)};
      $('search-play-status').textContent='Выбранный файл готовится в HTML-плеере ниже. Нажмите Play; найденный magnet и байты не подтверждают декодирование.';
      $('player-container').scrollIntoView({behavior:'auto',block:'center'});
    }catch(e){if(current===session){c.states.playback='unverified';$('search-play-status').textContent=label(failure(e).code);session.event('play_failed',{candidateId:c.candidateId,...failure(e)});}await stopPlayer(false);}
    finally{if(manualAbort===abort)manualAbort=null;transition=false;schedule();}
  }
  async function stopPlayer(abortManual=true){
    if(abortManual)manualAbort?.abort();playerEpoch++;const old=player;player=null;
    for(const [type,handler] of videoHandlers)video.removeEventListener(type,handler);videoHandlers=[];
    if(old){await old.stop().catch(()=>{});video.hidden=true;$('placeholder').hidden=false;restoreContext();current?.event('source_closed',{candidateId:selected?.candidateId});}
    $('search-restore').disabled=true;$('search-player-stop').disabled=true;
  }
  $('search-work').replaceChildren(...WORKS.map(w=>new Option(`${w.ru} / ${w.title}`,w.key)));options();
  $('search-work').onchange=changedSelection;$('search-season').onchange=changedSelection;$('search-episode').onchange=changedSelection;
  $('search-start').onclick=begin;$('search-stop').onclick=()=>current?.stopQueue().then(schedule);
  $('search-next').onclick=()=>{if(active())current.nextBatch().then(schedule);};$('search-more').onclick=()=>{shown+=20;render();};
  for(const id of ['search-quality','search-language'])$(id).onchange=()=>{if(current){current.filter=matches;current.queue();render();}};
  $('search-file').onchange=async()=>{
    if(!selected || !active(current,selected) || $('search-file').value==='')return;
    const session=current,candidate=selected,index=Number($('search-file').value);await session.stopQueue('explicit-file-selection');
    if(!active(session,candidate) || selected!==candidate)return;
    const locator=session.vault.get(candidate),file=locator?.meta?.files[index];
    if(!file?.video || !explicitFileAllowed(locator.meta,file,selected.work,config.mappings))return;
    locator.explicitFileIdx=index;applyFile(selected,locator.meta,config.mappings,locator);selected.states.A='unverified';selected.states.B=locator.meta.webseeds.length?'unverified':'webseed-not-found';selected.states.playback='unverified';
    current.event('file_selected',{candidateId:selected.candidateId,infoHash:selected.torrent.infoHash,fileIdx:index,path:file.path,length:file.length,evidence:'explicit user path selection; audiovisual identity untested'});render();
  };
  $('search-metadata-file').onchange=async()=>{
    const session=current,c=selected,input=$('search-metadata-file'),file=input.files?.[0];input.value='';
    if(!file || !c || !active(session,c) || player || manualAbort || metadataBusy)return;
    const epoch=++metadataEpoch;metadataBusy=true;
    try{
      if(file.size>LIMITS.metadataBytes)throw new SourceError('METADATA_SIZE_LIMIT');
      await session.stopQueue('explicit-metadata-import');
      if(!active(session,c) || selected!==c || epoch!==metadataEpoch)return;
      session.budget.count('metadataBytes',file.size);
      const bytes=new Uint8Array(await file.arrayBuffer()),meta=await parseMetadata(bytes,c.torrent.infoHash,{maxBytes:LIMITS.metadataBytes,maxFiles:LIMITS.maxFiles});
      if(!active(session,c) || selected!==c || epoch!==metadataEpoch)return;
      const locator=session.vault.get(c);Object.assign(locator,{metadata:bytes,meta});
      c.metadataProvenance={host:'local .torrent import',dataMode:'user-imported-metadata',checkedAt:now(),infoHash:meta.infoHash,bytes:bytes.length};
      session.metadataCache.set(meta.infoHash,{metadata:bytes,meta,provenance:c.metadataProvenance});
      try{applyFile(c,meta,config.mappings,locator);}catch(e){if(e.code!=='FILE_UNRESOLVED')throw e;}
      c.metadataImportStatus=`Metadata SHA-1 совпал с magnet · файлов ${meta.files.length}. ${c.states.file==='verified'?'Файл определён.':'Выберите точный файл из полного списка.'} Доставка и воспроизведение ещё не подтверждены.`;
      c.states.A='unverified';c.states.B=meta.webseeds.length?'unverified':'webseed-not-found';c.states.playback='unverified';
      session.event('metadata_import_verified',{candidateId:c.candidateId,...c.metadataProvenance,fileCount:meta.files.length});
    }catch(e){if(active(session,c) && epoch===metadataEpoch){c.metadataImportStatus=`.torrent не принят: ${label(failure(e).code)}.`;session.event('metadata_import_failed',{candidateId:c.candidateId,...failure(e)});}}
    finally{if(epoch===metadataEpoch)metadataBusy=false;render();}
  };
  $('search-reprobe').onclick=async()=>{
    const session=current,c=selected;if(!c || !active(session,c) || player || manualAbort || transition || metadataBusy)return;
    const abort=manualAbort=new AbortController();
    try{
      await session.stopQueue('explicit-selected-probe');if(!active(session,c) || abort.signal.aborted)return;
      session.event('manual_probe_requested',{candidateId:c.candidateId});
      const probe=new CandidateProbe({candidate:c,vault:session.vault,budget:session.budget,limits:LIMITS,mappings:config.mappings,packages:config.packages,metadataCache:session.metadataCache,
        signal:abort.signal,onChange:schedule,onEvent:(kind,details)=>session.event(kind,{candidateId:c.candidateId,...details})});
      await probe.run();
    }finally{if(manualAbort===abort)manualAbort=null;render();}
  };
  $('search-play-a').onclick=()=>play('A');$('search-play-b').onclick=()=>play('B');$('search-play-direct').onclick=()=>play('direct');
  $('search-player-stop').onclick=async()=>{await stopPlayer();$('search-play-status').textContent='Источник закрыт; журнал и позиция сохранены.';schedule();};
  $('search-restore').onclick=()=>{if(player && restoreBaseline && Number.isFinite(video.duration) && restoreBaseline.time<video.duration){current?.event('seek_restore_requested',{candidateId:selected?.candidateId,time:restoreBaseline.time});player.restore(restoreBaseline.time);}};
  $('search-lift').onclick=async()=>{if(!selected || !active(current,selected))return;const work=selected.work;await cancel('explicit-Lift-fallback');await openLift(work);};
  $('search-work-lift').onclick=async()=>{const work=selectedWork();await cancel('explicit-Lift-fallback');await openLift(work);};
  $('search-export').onclick=()=>download({kind:'KADR_SEARCH_PROBE',exported:now(),...history},`KADR_SEARCH_PROBE_${current?.run.searchId || 'history'}.json`);
  $('search-supplements').onclick=async()=>{
    if(!active()){$('search-supplement-status').textContent='Выполните новый основной поиск.';return;}
    supplementAbort?.abort();supplementAbort=new AbortController();const session=current,signal=supplementAbort.signal,results=[];
    for(const id of ['rutor','nyaa']){
      try{
        const result=await checkSupplement(id,{signal,work:session.run.work,onBytes:n=>session.budget.count('searchBytes',n)});
        if(!active(session) || signal.aborted)return;
        const candidates=result.matches.map(item=>normalizeStream({name:item.title,infoHash:item.hash},session.run.work,{id,label:id,adapter:id},session.vault)).filter(Boolean);
        // Title-based index matches are ambiguous until the user examines identity.
        for(const c of candidates){c.identity.match='ambiguous';c.identity.reason='Title-based supplement; work/year/type not yet independently verified';}
        results.push(`${id}: ответ читается; ${candidates.length} кандидатов, идентичность требует проверки`);session.add(candidates);
        session.event('supplement',{adapter:id,state:'readable',count:candidates.length});
      }catch(e){if(signal.aborted)return;results.push(`${id}: ${label(failure(e).code)}`);session.event('supplement',{adapter:id,...failure(e)});}
      $('search-supplement-status').textContent=results.join('. ');
    }
  };
  window.addEventListener('pagehide',()=>{manualAbort?.abort();supplementAbort?.abort();current?.searchAbort.abort();current?.queueAbort?.abort();stopPlayer();persist();});
  $('search-work').disabled=false;$('search-start').disabled=false;$('search-status').textContent='Выберите произведение и нажмите «Найти и проверить». Живой поиск не подменяется снимками исследования.';
  persist();
  return {stopPlayer,async suspendForExternalPlayer(){manualAbort?.abort();await current?.stopQueue('external-player');await stopPlayer();},
    async selectionChanged(){await cancel('legacy-selection-changed');schedule();},export:()=>history};
}
