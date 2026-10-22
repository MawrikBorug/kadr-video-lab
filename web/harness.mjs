// Based on the supplied Lift harness; native messages never become completion scores.
import {sanitize, accept, progress, safeDiagnostic, rejectionReason} from './collector.mjs';
import {CONFIG} from './config.js';
import {getFreshEmbed, LiftError} from './lift-api.mjs';
import {JOURNAL_KEY, OLD_LIFT_KEY, LEGACY_KEY, makeRun, append, readJournal, positionFor, previousLift, scopeKey, exportResult, utc} from './journal.mjs';
import {redactLegacy} from './legacy.mjs';
import {BUILD} from './build.js';
import {TORRENT_MATERIALS} from './torrent-materials.js';
import {TorrentSession} from './torrent.mjs';

const $ = id => document.getElementById(id);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const mode = standalone ? 'standalone' : 'browser';
const visitId = crypto.randomUUID();
let catalog;
try {
  const catalogResponse = await fetch('./catalog.json', {cache:'no-store'});
  if (!catalogResponse.ok) throw Error('catalog_config_unavailable');
  catalog = await catalogResponse.json();
  if (!Array.isArray(catalog) || !catalog.some(item=>item.id===3637)) throw Error('catalog_config_invalid');
} catch(error) {
  $('status').textContent='Не удалось загрузить список материалов. Обновите страницу после проверки сети.';
  $('start').disabled=true;throw error;
}
let material = catalog.find(item => item.id === 3637), connection = 'lift';
let subject = {connection, materialId:material.id, season:material.plannedSeason, episode:material.plannedEpisode};
let torrentSession = null, switching = false, oldLift = null, diagnosticPhase=null, episodeHookTimer=null, episodeSelectionTimer=null;
const observations = {
  video_audio: 'Видео и звук есть', original_track: 'Выбрана оригинальная английская дорожка',
  track_unavailable: 'Разрешённая оригинальная дорожка недоступна — опыт остановлен',
  paused: 'Пауза внутри плеера', seek: 'Перемотка внутри плеера',
  fullscreen_ok: 'Fullscreen работает', fullscreen_fail: 'Fullscreen не работает',
  pip_ok: 'PiP работает', pip_fail: 'PiP не работает / недоступен',
  background: 'Уход в фон / блокировка экрана', return_ok: 'Возврат: видео продолжилось', return_fail: 'Возврат: видео не продолжилось',
  network_lost: 'Обрыв сети', network_restored: 'Сеть восстановлена', playback_recovered: 'После обрыва видео восстановилось',
  playback_not_recovered: 'После обрыва видео не восстановилось',
  restored_same: 'После перезагрузки позиция совпала с сохранённой', restored_different: 'После перезагрузки позиция отличается',
  ad_seen: 'Появилась реклама', navigation_seen: 'Посторонний переход / новое окно',
  region_denied: 'Региональный отказ', domain_denied: 'Доменный отказ', signature_denied: 'Отказ подписи', auth_denied: 'Отказ авторизации',
  other_error: 'Другая ошибка плеера', full_start: 'Начало полного просмотра с начала без перемоток',
  actual_end: 'Ролик фактически закончился', full_no_ads: 'Полный сеанс: рекламы и переходов не замечено',
  episode_selected: 'Нужный сезон и эпизод выбраны внутри плеера', episode_unconfirmed: 'Фактическая серия не подтверждена',
};
for (const [value, label] of Object.entries(observations)) $('note').add(new Option(label, value));

let storage, journal, persistent = true, recoveryRaw = null, saved = null;
try {
  storage = window.localStorage;
  journal = readJournal(storage);
  if (journal.selection && ['lift','wt-webrtc','wt-http'].includes(journal.selection.connection)) {
    const candidate = findMaterial(journal.selection.connection, journal.selection.materialId);
    if (candidate) {connection=journal.selection.connection;material=candidate;subject=makeSubject(journal.selection.season,journal.selection.episodeProviderId);}
  }
  oldLift = previousLift(storage);
  saved = positionFor(journal, subject, storage);
} catch {
  persistent = false;
  try { recoveryRaw = storage?.getItem(JOURNAL_KEY); } catch { /* unavailable */ }
  journal = {schema: 3, runs: [], currentByMode: {}, positions: {}};
  $('storage-warning').hidden = false;
  $('storage-warning').textContent = 'Локальный журнал недоступен или повреждён. Он не перезаписывается. Новые события остаются в памяти — экспортируйте JSON до закрытия.';
  $('recovery').hidden = recoveryRaw === null;
}
const currentKey = () => mode + '|' + scopeKey(subject);
let run = journal.runs.find(r => r.runId === journal.currentByMode[currentKey()] && r.mode === mode && !r.ended && r.build?.commit===BUILD.commit && r.build?.version===BUILD.version);
if (!run) { run = makeRun(mode, BUILD, subject); journal.runs.push(run); journal.currentByMode[currentKey()] = run.runId; }
run.environment ||= {mode,standalone,onlineAtStart:navigator.onLine,secureContext:isSecureContext};
let frame = null, origin = '', request = null, epoch = 0, frameTimer, pingTimer, closing = null;
let runtime = {}, rejectedPending = 0, rejectedTimer = null;
resetRuntime();

function persist() {
  if (!persistent) return;
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify(journal));
    $('storage-status').textContent = `Журнал сохранён на устройстве · ${new Date().toLocaleTimeString('ru-RU')}`;
  } catch {
    $('storage-warning').hidden = false;
    $('storage-warning').textContent = 'Не удалось сохранить журнал (доступ или место). События есть в памяти. Экспортируйте JSON перед закрытием.';
  }
}
function log(kind, details = {}) {
  append(run, {utc: utc(), visitId, elapsedMs: Math.round(performance.now()), generation: run.generation, kind, ...details});
  persist(); renderLog();
}
function renderLog() {
  $('run-info').textContent = `Прогон ${run.runId} · ${mode === 'standalone' ? 'Экран «Домой»' : 'Вкладка браузера'} · сохранено прогонов: ${journal.runs.length}`;
  $('event-count').textContent = `${run.events.length} событий в прогоне · отброшено старых: ${run.droppedEvents} · отклонено сообщений: ${run.rejectedMessages}`;
  $('log').textContent = JSON.stringify(run.events.slice(-16), null, 2);
  const gaps=run.diagnostics.arrivalGapsMs;
  $('collector-state').textContent = `Доверенных: ${run.diagnostics.trusted}; принято: ${run.diagnostics.accepted}; viewProgress: вход ${run.diagnostics.progressReceived} / принято ${run.diagnostics.progressAccepted}. Отклонения: ${JSON.stringify(run.diagnostics.rejected)}. ${gaps.length?'Интервалы по приходу: '+gaps.map(ms=>(ms/1000).toFixed(1)+' с').join(', '):'Для измерения частоты нужны хотя бы два viewProgress в одной загрузке.'}`;
}
function resetRuntime() {
  runtime = {loaded: false, ready: false, started: false, last: null, lastAt:null, endedSoon: false, ended: false, restoreBaseline: saved,
    episodeConfirmed:!material.series,episodeHooked:false,episodeCommandSent:false};
  $('frame-state').textContent = 'Не запущен'; $('ready-state').textContent = connection==='lift'?'Нет playerReady':'Нативные метаданные ещё не получены';
  $('play-state').textContent = 'Нет реальных событий'; $('end-state').textContent = 'Нет ended';
  $('position').textContent = 'Текущая позиция неизвестна: в этой загрузке новых событий ещё нет.';
  $('restore').textContent = '';$('native-audio').disabled=true;$('native-audio').replaceChildren(new Option('Сначала loadedmetadata',''));$('phase-status').textContent='';
}
function showSaved() {
  $('saved').textContent = saved ? `История этого подключения и материала: ${saved.time.toFixed(1)} / ${saved.duration.toFixed(1)} с · последнее обновление ${saved.utc}. Это прежняя позиция, не актуальный прогресс новой загрузки.` : 'Сохранённой позиции для этого подключения и материала нет.';
  $('restore-position').disabled = !torrentSession || !runtime.restoreBaseline;
  $('restore-position').textContent = runtime.restoreBaseline ? `Передать HTML-плееру позицию до запуска: ${runtime.restoreBaseline.time.toFixed(1)} с` : 'Позиции до запуска для восстановления нет';
}
async function detach() {
  clearInterval(episodeHookTimer);episodeHookTimer=null;
  clearTimeout(episodeSelectionTimer);episodeSelectionTimer=null;
  if(diagnosticPhase){capturePhase('interrupted_by_source_change');diagnosticPhase=null;}
  clearTimeout(rejectedTimer);rejectedTimer=null;
  if(rejectedPending){const count=rejectedPending;rejectedPending=0;log('rejected_messages',{count});}
  request?.abort(); request = null; epoch++;
  clearTimeout(frameTimer); clearTimeout(pingTimer);
  frame?.remove(); frame = null; origin = '';
  if (torrentSession) {
    const old = torrentSession; torrentSession = null;
    closing = old.stop();
  }
  if (closing) {await closing; closing=null; log('torrent_connections_closed');}
  $('native-video').hidden = true; $('restore-position').disabled = true;
  $('placeholder').hidden = false;
  $('start').disabled = false;
  $('reload').disabled = true; $('stop').disabled = true; $('ping').disabled = true; $('apply-episode').disabled=true;
  $('bridge').textContent = 'Мост ещё не проверен. Pong подтверждает связь, но не воспроизведение.';
}
const errorLabels = {
  api_network_or_cors: 'API недоступен: сеть, CORS или отказ перенаправления. Точную причину браузер странице не раскрывает.',
  api_timeout_or_cancel: 'API не ответил за 25 секунд. Повторите после проверки сети.',
  api_http_error: 'API вернул HTTP-отказ.', api_non_json: 'API вернул ответ другого формата.',
  api_provider_error: 'API сообщил об отказе.', api_too_large: 'Ответ API превышает допустимый размер.',
  identity_mismatch: 'Ответ не соответствует выбранному названию, году, ID или типу. Опыт остановлен.',
  embed_missing: 'В ответе нет штатного iframe.', embed_invalid: 'Штатная ссылка iframe имеет неверный формат.',
  embed_origin_or_path: 'Изменился origin или путь штатного iframe. Опыт остановлен до проверки разработчиком.',
};
async function load(reload = false, catalogOnly = false) {
  if (connection !== 'lift') return loadTorrent();
  const baseline = saved;
  await detach(); resetRuntime(); runtime.restoreBaseline = baseline;
  run.generation++; const generation = run.generation, thisEpoch = epoch;
  $('status').textContent = 'Получаем свежий iframe из API Lift…'; $('frame-state').textContent = 'Запрос API';
  $('start').disabled = true;
  log(catalogOnly ? 'catalog_requested' : reload ? 'iframe_reload_requested' : 'iframe_start_requested', {savedBefore: baseline});
  const controller = new AbortController(); request = controller;
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const result = await getFreshEmbed(controller.signal, material);
    if (thisEpoch !== epoch) return;
    log('api_success', {httpStatus: result.httpStatus, browserCors: 'response-readable'});
    run.catalog = {...result.catalog, plannedSeason:subject.season, plannedEpisode:subject.episode,
      episodeProviderId:subject.episodeProviderId,episodeFoundInSnapshot:!!selectedEpisode(), episodeSnapshotAt:material.snapshot.checkedAt};
    $('catalog-state').textContent = `Найдено: ${material.title} (${material.year}), Lift ${material.id}, тип ${material.nativeType}. Штатный iframe получен. Метка качества API: ${result.catalog.catalogQuality}. Видео этим не проверялось.`;
    if (catalogOnly) {
      $('status').textContent = 'Каталожная проверка завершена. Iframe получен, но не открыт. Медиапроверка — отдельный этап.';
      $('frame-state').textContent = 'Получен URL; iframe не открывался';
      log('catalog_result', run.catalog); return;
    }
    // Fresh contentWindow on every attempt prevents messages from the old generation.
    frame = document.createElement('iframe'); frame.id = 'frame'; frame.title = material.title + ' — штатный плеер Lift';
    frame.allow = 'autoplay; fullscreen; picture-in-picture'; frame.allowFullscreen = true;
    const mounted = frame; origin = CONFIG.expectedOrigin;
    mounted.addEventListener('load', () => {
      if (frame !== mounted || generation !== run.generation) return;
      clearTimeout(frameTimer); runtime.loaded = true;
      $('frame-state').textContent = 'Событие load (не доказательство видео)';
      $('status').textContent = 'Iframe загружен. Проверьте содержимое и нажмите Play внутри плеера. HTTP 200 и load не подтверждают просмотр.';
      log('iframe_load');
    });
    mounted.addEventListener('error', () => {
      if (frame !== mounted) return;
      $('status').textContent = 'Ошибка загрузки iframe. Причину внутри чужого окна стенд прочитать не может. Запишите видимый отказ.';
      log('iframe_error');
    });
    mounted.src = result.embedUrl; // Never persisted, exported or passed to an analytics service.
    $('placeholder').hidden = true; $('player-container').append(mounted);
    $('reload').disabled = false; $('stop').disabled = false; $('ping').disabled = false;
    $('apply-episode').disabled = false;
    if(material.series) beginEpisodeHandshake();
    $('frame-state').textContent = 'Навигация iframe';
    $('status').textContent = 'Получен штатный iframe; ожидаем загрузку. Если виден отказ, запишите его текст вручную.';
    log('iframe_navigation', {origin});
    frameTimer = setTimeout(() => {
      if (frame !== mounted) return;
      $('status').textContent = 'За 20 секунд load не получен. Проверьте видимый плеер; сеть или встраивание могут быть заблокированы.';
      log('iframe_load_timeout');
    }, 20000);
  } catch (error) {
    if (thisEpoch !== epoch) return;
    const known = error instanceof LiftError;
    const code = known ? error.code : 'api_network_or_cors';
    const details = known ? error.details : {};
    $('status').textContent = `${errorLabels[code] || 'Не удалось получить iframe.'}${details.httpStatus ? ` HTTP ${details.httpStatus}.` : ''}${details.reason ? ` ${details.reason}` : ''}`;
    $('frame-state').textContent = 'Отказ получения iframe';
    log('api_error', {code, ...details});
  } finally {
    clearTimeout(timer);
    if (thisEpoch === epoch) { $('start').disabled = false; request = null; }
  }
}
$('start').onclick = () => load(false).catch(showFailure);
$('catalog-test').onclick = () => load(false, true).catch(showFailure);
$('reload').onclick = () => load(true).catch(showFailure);
$('stop').onclick = async () => { try {await detach(); $('status').textContent = 'Источник закрыт. Позиция и журнал сохранены.'; $('frame-state').textContent = 'Закрыт'; log('source_closed');} catch(e){showFailure(e);} };

$('ping').onclick = () => {
  if (!frame || !origin) return;
  clearTimeout(pingTimer); runtime.pingAt = performance.now();
  frame.contentWindow.postMessage('ping', origin); log('command', {event: 'ping'});
  $('bridge').textContent = 'Ping отправлен; ждём pong из этого iframe…';
  pingTimer = setTimeout(() => { runtime.pingAt = null; $('bridge').textContent = 'Pong за 5 секунд не получен. Поддержка моста в этой загрузке не подтверждена.'; log('ping_timeout'); }, 5000);
};
function reject(reason) {
  run.rejectedMessages++; rejectedPending++;
  run.diagnostics.rejected[reason] = (run.diagnostics.rejected[reason] || 0) + 1;
  if (rejectedTimer) return;
  rejectedTimer = setTimeout(() => { rejectedTimer = null; const count = rejectedPending; rejectedPending = 0; log('rejected_messages', {count}); }, 1000);
}
window.addEventListener('message', e => {
  if (!frame || connection !== 'lift') return;
  if (!accept(e, frame.contentWindow, origin)) { reject(e.origin === origin ? 'source_mismatch' : 'origin_mismatch'); return; }
  run.diagnostics.trusted++;
  if (e.data?.event === 'viewProgress') run.diagnostics.progressReceived++;
  const data = sanitize(e.data);
  if (!data) { reject(rejectionReason(e.data)); return; }
  run.diagnostics.accepted++;
  if(data.event==='playlist hooked') {
    runtime.episodeHooked=true;clearInterval(episodeHookTimer);episodeHookTimer=null;
    log('iframe_message',data);sendEpisodeSelection();return;
  }
  if(data.event==='lastEpisode') {log('iframe_message',{...data,evidence:'provider historical selection, not current episode'});return;}
  if(data.event==='changeEpisode') {
    clearTimeout(episodeSelectionTimer);episodeSelectionTimer=null;
    const ep=selectedEpisode();runtime.episodeConfirmed=data.season===subject.season && data.episode===subject.episode;
    run.episodeEvidence={...data,confirmed:runtime.episodeConfirmed,metadataProviderId:ep?.providerId ?? null,
      numericIdMatchesSnapshot:data.id?data.id===ep?.providerId:null,utc:utc()};
    $('episode-status').textContent=runtime.episodeConfirmed?`Lift подтвердил changeEpisode: S${data.season}E${data.episode}, ID ${data.id ?? 'не передан'}.`:`Lift выбрал S${data.season}E${data.episode}. Это другой элемент; позиция выбранного эпизода не обновляется.`;
    runtime.last=null;runtime.lastAt=null;$('position').textContent='После смены эпизода новая подтверждённая позиция ещё не получена.';
    log('iframe_message',{...data,matchesSelectedEpisode:runtime.episodeConfirmed});return;
  }
  if (data.event === 'pong') {
    const matched = Number.isFinite(runtime.pingAt);
    const elapsedMs = matched ? Math.round(performance.now() - runtime.pingAt) : null;
    clearTimeout(pingTimer); runtime.pingAt = null;
    $('bridge').textContent = matched ? `Получен настоящий pong (${elapsedMs} мс). Связь подтверждена; видео этим не проверяется.` : 'Получен pong без ожидающего ping; воспроизведение этим не подтверждено.';
    log('iframe_message', {...data, matchedPing: matched, roundTripMs: elapsedMs}); return;
  }
  if (data.event === 'playerReady') { runtime.ready = true; $('ready-state').textContent = 'Получен playerReady';if(material.series && !runtime.episodeHooked)beginEpisodeHandshake(); }
  if (data.event === 'startWatching') {
    runtime.started = true; $('play-state').textContent = 'Получен startWatching (сигнал старта)';
  }
  const p = progress(data);
  if (p) {
    run.diagnostics.progressAccepted++;
    if (runtime.lastAt) {
      run.diagnostics.arrivalGapsMs.push(Date.now() - Date.parse(runtime.lastAt));
      if (run.diagnostics.arrivalGapsMs.length > 16) run.diagnostics.arrivalGapsMs.shift();
    }
    $('play-state').textContent = 'Получен реальный viewProgress; это редкое измерение, не непрерывный таймер.';
    // Progress id may denote a voice/media object. Use the explicit changeEpisode
    // season/episode pair; never assume it equals the catalogue episode id.
    if(!material.series || runtime.episodeConfirmed)recordPosition(p, 'Lift viewProgress');
    else {run.unattributedProgress={...p,utc:utc(),id:data.id ?? null};$('position').textContent=`Lift прислал ${p.time.toFixed(1)} / ${p.duration.toFixed(1)} с, но выбранный эпизод не подтверждён. Позиция эпизода не перезаписывается.`;}
  }
  if (data.event === 'endedSoon') { runtime.endedSoon = true; if (!runtime.ended) $('end-state').textContent = 'Получен endedSoon; ended ещё не подтверждён'; }
  if (data.event === 'ended') { runtime.ended = true; $('end-state').textContent = 'Получен настоящий ended. «Просмотрено» не выставляется.'; }
  if (data.event === 'adStart' || data.event === 'click overlay') $('status').textContent = 'Получен рекламный сигнал Lift. Отметьте, что было видно; это отдельно от фактического показа.';
  log('iframe_message', data);renderOwnerMatrix();
});

function recordPosition(p, source) {
  const first = !runtime.last;
  runtime.last = p; runtime.lastAt = utc(); runtime.positionSource = source;
  if (first && runtime.restoreBaseline) {
    const before = runtime.restoreBaseline;
    $('restore').textContent = `До загрузки сохранено ${before.time.toFixed(1)} с; первое новое событие — ${p.time.toFixed(1)} с. Разница ${(p.time - before.time).toFixed(1)} с. Команды восстановления при запуске не отправлялись.`;
    log('restore_comparison', {savedTime:before.time, firstRealTime:p.time, automaticSeekAttempted:false});
  }
  saved = {...p, utc:runtime.lastAt, materialId:material.id, runId:run.runId};
  journal.positions[scopeKey(subject)] = saved; run.lastPosition = saved;
  showSaved(); refreshPosition();
}
function refreshPosition() {
  if (!runtime.last || !runtime.lastAt) return;
  const age = Math.max(0, Math.floor((Date.now()-Date.parse(runtime.lastAt))/1000));
  $('position').textContent = `Последнее измерение (${runtime.positionSource}): ${runtime.last.time.toFixed(1)} / ${runtime.last.duration.toFixed(1)} с. Обновлено ${runtime.lastAt}, ${age} с назад. Нового значения пока нет.`;
}
// This updates the age of the measurement only. The playback position never advances by a timer.
setInterval(refreshPosition, 1000);

function capturePhase(reason='manual') {
  if(connection!=='lift')return;
  const n=$('visible-time').value,manualTime=n===''?null:Number(n);
  const visibleTime=Number.isFinite(manualTime)&&manualTime>=0&&manualTime<=86400?manualTime:null;
  log('progress_observation',{source:'manual phase; not player telemetry',phase:diagnosticPhase?.phase || $('progress-phase').value,reason,
    visibleTime,wallElapsedMs:diagnosticPhase?Date.now()-diagnosticPhase.startedAt:null,
    progressReceived:run.diagnostics.progressReceived,progressAccepted:run.diagnostics.progressAccepted,
    receivedInPhase:diagnosticPhase?run.diagnostics.progressReceived-diagnosticPhase.received:0,
    acceptedInPhase:diagnosticPhase?run.diagnostics.progressAccepted-diagnosticPhase.accepted:0,
    rejected:{...run.diagnostics.rejected},lastReal:runtime.last?{...runtime.last,utc:runtime.lastAt}:null,
    savedBefore:saved,restorationCommandSent:false,episodeConfirmed:runtime.episodeConfirmed});
}
$('phase-mark').onclick=()=>{
  if(connection!=='lift')return;
  if(diagnosticPhase)capturePhase('phase_finished');diagnosticPhase=null;
  if($('progress-phase').value==='continuous')diagnosticPhase={phase:'continuous',startedAt:Date.now(),received:run.diagnostics.progressReceived,accepted:run.diagnostics.progressAccepted,generation:run.generation};
  capturePhase('phase_marked');$('phase-status').textContent='Фаза записана отдельно от событий Lift.';$('visible-time').value='';
};
setInterval(()=>{
  if(!diagnosticPhase)return;
  const elapsed=Math.floor((Date.now()-diagnosticPhase.startedAt)/1000);
  $('phase-status').textContent=`Наблюдение: ${elapsed} / 150 с; входящих progress ${run.diagnostics.progressReceived-diagnosticPhase.received}, принятых ${run.diagnostics.progressAccepted-diagnosticPhase.accepted}. Это время наблюдения, не позиция видео.`;
  if(elapsed>=150){capturePhase('continuous_window_finished');diagnosticPhase=null;}
},1000);
function showFailure(error) {
  const reason = safeDiagnostic(error?.message || String(error));
  $('status').textContent = 'Ошибка: '+reason;
  log('source_error', {reason});
}
async function loadTorrent() {
  await detach(); resetRuntime(); run.generation++;
  $('placeholder').hidden = true; $('native-video').hidden = false;
  $('status').textContent = 'WebTorrent: готовим metadata и браузерный Range-поток…';
  $('start').disabled = true; const ownEpoch = epoch, ownRun = run.runId;
  const session = new TorrentSession({video:$('native-video'), material, mode:connection,
    downloadLimit:material.id==='kadr-control'?32768:524288,
    onEvent:(kind, data) => {
      if (epoch!==ownEpoch || run.runId!==ownRun || torrentSession!==session) return;
      if (kind === 'torrent_metadata_ready') { $('frame-state').textContent='Metadata получены по HTTPS'; $('ready-state').textContent='Файл найден; видео ещё не проверено'; $('status').textContent='Metadata готовы. Нажмите Play в собственном HTML-плеере.'; }
      if (kind === 'torrent_no_media_yet') $('status').textContent='Медиабайты WebRTC не пришли за 25 секунд. Нужен активный совместимый пир; HTTP fallback выключен.';
      if (kind === 'native_video') {
        const p=progress({event:'viewProgress',time:data.time,duration:data.duration});
        if (p && ['timeupdate','seeked','playing'].includes(data.event)) recordPosition(p,'HTMLVideoElement');
        if (data.event==='loadedmetadata') {$('ready-state').textContent='HTMLVideoElement: получен loadedmetadata';renderNativeAudio();}
        if (data.event==='playing') {run.mediaSignals={...run.mediaSignals,mainVideo:'native-playing'};$('play-state').textContent='Реальный playing собственного HTML-плеера';$('status').textContent='HTML-плеер воспроизводит разрешённый тестовый файл (событие playing).';}
        if (data.event==='ended') {$('end-state').textContent='Реальный ended собственного HTML-плеера. «Просмотрено» не выставляется.';run.mediaSignals={...run.mediaSignals,ended:'native-ended'};}
        if (data.event==='error') $('status').textContent=`HTML-плеер сообщил MediaError ${data.mediaErrorCode}.`;
      }
      log(kind, data);
    },
    onStats:stats => { if(epoch===ownEpoch && run.runId===ownRun && torrentSession===session){run.transport=stats; renderTransport(stats);persist();} },
    onError:reason => { if(epoch===ownEpoch && run.runId===ownRun && torrentSession===session){$('status').textContent='Ошибка WebTorrent: '+reason;log('torrent_error',{reason});} },
  });
  torrentSession = session;
  try { await session.start(); }
  catch(error) { if(epoch===ownEpoch) {showFailure(error);await session.stop().catch(()=>{});} }
  finally { if(epoch===ownEpoch){$('start').disabled=false;$('reload').disabled=false;$('stop').disabled=false;showSaved();} }
}
function renderTransport(stats) {
  $('transport-state').textContent = `Этапы: ${Object.entries(stats.steps || {}).map(([k,v])=>k+'='+v).join('; ')}.\nЛокальная ICE-проба: кандидатов ${stats.nativeIceCandidates ?? 'нет данных'}, завершена ${stats.nativeIceComplete?'да':'нет'}; это не число сидеров. Ошибок ICE/RTC ${stats.iceFailures || 0}. ${stats.timedOut?'ТАЙМ-АУТ '+stats.failureCode+'; соединения закрыты, доступен повтор.':''}\nMetadata: ${stats.metadataReady?'готовы':'ожидание'} · WebRTC-пиров: ${stats.peersWebRTC} · HTTP-webseed соединений: ${stats.webSeedConnections}\nОтветов трекера: ${stats.trackerAnnounces}; обнаружено кандидатов: ${stats.peersDiscovered}. Кандидат не равен соединению.\nБайты payload: WebRTC ${stats.webRTCBytes}; HTTP ${stats.httpBytes}; неизвестный транспорт ${stats.unknownBytes}. Повторы включены.\nУникальных байтов файла: ${stats.uniqueFileBytes} / ${stats.fileSize}. Фактический транспорт: ${stats.actualTransport}.\nХранилище: ${stats.storageMode || 'ожидание'}; байтов из прошлого запуска: ${stats.preexistingBytesAtReady ?? 'не проверено'}.\nHTMLVideoElement: ${stats.videoWidth || 0}×${stats.videoHeight || 0}; audioTracks API: ${stats.audioTracksExposed ?? 'не предоставлен'}.\nПервый playing: ${stats.firstPlayingMs===null?'не получен':stats.firstPlayingMs+' мс от запуска'}; до полной загрузки: ${stats.playbackBeforeFull===null?'не проверено':stats.playbackBeforeFull?'да':'нет'}.`;
}
function renderNativeAudio(){
  const list=$('native-video').audioTracks,select=$('native-audio');
  select.replaceChildren();
  if(!list || !list.length){select.add(new Option('Браузер не открыл audioTracks API',''));select.disabled=true;$('native-audio-state').textContent='Дорожки файла указаны как metadata. Услышанный звук отмечается вручную; переключение через этот API не подтверждено.';return;}
  select.replaceChildren(...Array.from(list,(t,i)=>new Option(`${i+1}: ${t.language || 'язык не указан'} ${t.label || ''}`,String(i))));
  select.value=String(Array.from(list).findIndex(t=>t.enabled));select.disabled=false;
  $('native-audio-state').textContent=`Браузер предоставил ${list.length} дорожек. Выбор и слышимый результат — разные факты.`;
}
$('native-audio').onchange=()=>{const list=$('native-video').audioTracks,index=Number($('native-audio').value);if(!list || !Number.isInteger(index)||!list[index])return;for(let i=0;i<list.length;i++)list[i].enabled=i===index;log('native_audio_selection',{index,language:safeDiagnostic(list[index].language || ''),evidence:'audioTracks.enabled request; audible result requires observation'});};
$('restore-position').onclick = () => {
  if(torrentSession && runtime.restoreBaseline && !torrentSession.restore(runtime.restoreBaseline.time)) showFailure(Error('native_restore_not_ready'));
};

$('mark').onclick = () => {
  const code = $('note').value;
  if (!Object.hasOwn(observations, code)) return;
  const reason = safeDiagnostic($('diagnostic').value);
  run.observations[code] = (run.observations[code] || 0) + 1;
  log('manual_observation', {code, label: observations[code], ...(reason ? {reason} : {})});
  $('manual-status').textContent = `Записано: ${observations[code]}`; $('diagnostic').value = '';
};
async function download(value, filename) {
  const file = new File([JSON.stringify(redactLegacy(value), null, 2)], filename, {type: 'application/json'});
  try {
    if (navigator.canShare?.({files: [file]})) {
      await navigator.share({files: [file], title: 'КАДР Lift — результат'});
      $('export-status').textContent = 'Результат передан в меню «Поделиться».'; return;
    }
  } catch (error) {
    if (error.name === 'AbortError') { $('export-status').textContent = 'Экспорт отменён. Журнал остаётся на устройстве.'; return; }
  }
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  $('export-status').textContent = 'JSON подготовлен. В Safari сохраните его в «Файлы».';
}
$('export').onclick = () => {
  log('export_requested');
  const environment = {mode, standalone, online: navigator.onLine, secureContext: isSecureContext,
    userAgentIncluded: $('include-ua').checked, ...($('include-ua').checked ? {userAgent: navigator.userAgent} : {})};
  download(exportResult(journal, run, environment, saved, oldLift), `KADR_LIFT_STAND_${connection}_${mode}_${run.runId}.json`);
};
$('new-run').onclick = async () => {
  try {
    await detach(); log('run_closed'); run.ended = utc();
    run = makeRun(mode, BUILD, subject); journal.runs.push(run); journal.currentByMode[currentKey()] = run.runId;
    run.environment={mode,standalone,onlineAtStart:navigator.onLine,secureContext:isSecureContext};
    resetRuntime(); renderContext(); $('status').textContent = 'Новый прогон готов. Источник автоматически не запускается.';
    log('run_created', {mode,subject}); showSaved();
  } catch(error){showFailure(error);}
};
$('recovery').onclick = () => {
  let data; try { data = JSON.parse(recoveryRaw); } catch { data = recoveryRaw; }
  download({kind: 'KADR_LIFT_STAND_RECOVERY', exported: utc(), data}, 'KADR_LIFT_STAND_RECOVERY.json');
};
try {
  const old = storage?.getItem(LEGACY_KEY);
  $('legacy-status').textContent = old === null || old === undefined ? 'Прежний журнал в этом браузере не найден.' : `Прежний журнал найден (${old.length} символов). Он сохранён без изменений.`;
  $('legacy-export').disabled = old === null || old === undefined;
  $('legacy-export').onclick = () => {
    let data; try { data = JSON.parse(old); } catch { data = old; }
    download({kind: 'KADR_LIFT_STAND_LEGACY_BACKUP', exported: utc(), sourceKey: LEGACY_KEY, data}, 'KADR_LIFT_STAND_LEGACY_BACKUP.json');
  };
} catch { $('legacy-status').textContent = 'Нет доступа к прежнему журналу. Данные не изменялись.'; }

try {
  const raw = storage?.getItem(OLD_LIFT_KEY);
  $('old-lift-status').textContent = raw ? 'Журнал первого Lift-стенда сохранён без изменения. Он включён в общий экспорт и доступен отдельно.' : 'Журнал первого Lift-стенда в этом браузере не найден.';
  $('old-lift-export').disabled = !raw;
  $('old-lift-export').onclick = () => {
    let data; try {data=JSON.parse(raw);} catch {data=raw;}
    download({kind:'KADR_LIFT_STAND_PRE_EXPANSION_BACKUP',exported:utc(),sourceKey:OLD_LIFT_KEY,data},'KADR_LIFT_STAND_PRE_EXPANSION_BACKUP.json');
  };
} catch { $('old-lift-status').textContent='Нет доступа к прежнему журналу Lift; значение не менялось.'; }

function findMaterial(conn, id) {
  return (conn==='lift'?catalog:TORRENT_MATERIALS.filter(item=>item.allowed.includes(conn))).find(item=>String(item.id)===String(id));
}
function makeSubject(season, episodeProviderId) {
  const seasons=material.snapshot?.seasons || [];
  const s=seasons.find(s=>s.season===Number(season)) || seasons[0];
  const ep=s?.episodes.find(ep=>ep.providerId===Number(episodeProviderId)) || s?.episodes[0];
  return {connection,materialId:material.id,season:s?.season ?? null,episode:ep?.episode ?? null,episodeProviderId:ep?.providerId ?? null};
}
function selectedEpisode() {return material.snapshot?.seasons?.find(s=>s.season===subject.season)?.episodes.find(e=>e.providerId===subject.episodeProviderId);}
function renderEpisodeOptions() {
  const serial=connection==='lift' && material.series;$('episode-controls').hidden=!serial;$('apply-episode').hidden=!serial;
  if(!serial)return;
  const seasons=material.snapshot.seasons;
  $('season').replaceChildren(...seasons.map(s=>new Option('Сезон '+s.season,String(s.season))));$('season').value=String(subject.season);
  const eps=seasons.find(s=>s.season===subject.season)?.episodes || [];
  $('episode').replaceChildren(...eps.map(e=>new Option(`Эпизод ${e.episode}${e.title?' · '+e.title:''} · ID ${e.providerId}`,String(e.providerId))));$('episode').value=String(subject.episodeProviderId);
}
$('season').onchange=()=>changeSelection(connection,material.id,Number($('season').value));
$('episode').onchange=()=>changeSelection(connection,material.id,subject.season,Number($('episode').value));
function sendEpisodeSelection(){
  if(!frame || !material.series || !runtime.episodeHooked || runtime.episodeCommandSent || !selectedEpisode())return;
  runtime.episodeCommandSent=true;
  runtime.episodeConfirmed=false;
  const command={event:'playlist go',season:subject.season,episode:subject.episode};frame.contentWindow.postMessage(command,origin);
  log('command',{...command,episodeProviderId:subject.episodeProviderId,contract:'Observed native embed playlist handler; await changeEpisode'});
  $('episode-status').textContent=`Запрошен S${subject.season}E${subject.episode}; ждём реальный changeEpisode. Отправка команды не подтверждает выбор.`;
  clearTimeout(episodeSelectionTimer);const mounted=frame;
  episodeSelectionTimer=setTimeout(()=>{if(frame!==mounted || runtime.episodeConfirmed)return;
    $('episode-status').textContent='За 15 с changeEpisode не получен. Выбор не подтверждён; проверьте серию средствами Lift или повторите передачу.';
    log('episode_selection_timeout',{season:subject.season,episode:subject.episode,episodeProviderId:subject.episodeProviderId});
  },15000);
}
function beginEpisodeHandshake(){
  if(!frame || !material.series)return;
  clearInterval(episodeHookTimer);runtime.episodeCommandSent=false;let attempts=0;const mounted=frame;
  const send=()=>{if(frame!==mounted)return;attempts++;frame.contentWindow.postMessage('playlist hook',origin);
    if(attempts===1)log('command',{event:'playlist hook'});
    if(attempts>=12){clearInterval(episodeHookTimer);episodeHookTimer=null;$('episode-status').textContent='Playlist hook не подтверждён. Выберите серию средствами Lift или повторите передачу; фактический эпизод пока неизвестен.';log('playlist_hook_timeout');}};
  send();episodeHookTimer=setInterval(send,1000);
}
$('apply-episode').onclick=()=>{if(runtime.episodeHooked){runtime.episodeCommandSent=false;sendEpisodeSelection();}else beginEpisodeHandshake();};
function renderOwnerMatrix(){
  $('owner-matrix').replaceChildren(...catalog.filter(m=>m.ownerSample).map(m=>{
    const tested=journal.runs.filter(r=>r.subject.materialId===m.id && r.subject.connection==='lift');
    const media=tested.some(r=>r.events.some(e=>e.kind==='iframe_message' && ['startWatching','viewProgress'].includes(e.event)));
    const tr=document.createElement('tr');for(const text of [m.title,`ID ${m.id}; найден / iframe получен (снимок). Видео: ${media?'есть сигнал, детали в прогоне':'не подтверждено'}`, 'Нет квалифицированной разрешённой раздачи','Квалифицированный webseed не найден']){const td=document.createElement('td');td.textContent=text;tr.append(td);}return tr;
  }));
}
function renderMaterialOptions() {
  const items=connection==='lift'?catalog:TORRENT_MATERIALS.filter(item=>item.allowed.includes(connection));
  $('material').replaceChildren(...items.map(item=>new Option(`${item.title}${item.year?' ('+item.year+')':''}${item.group==='control'?' · контроль':item.group?' · '+({anime:'аниме',series:'сериал',film:'фильм'}[item.group]):''}`,String(item.id))));
  $('material').value=String(material.id); $('connection').value=connection;
}
function renderContext() {
  const lift=connection==='lift';
  $('material-title').textContent=material.title;
  $('material-meta').textContent=lift?`${material.original || material.providerTitle} · ${material.year} · Lift ${material.id} · тип ${material.nativeType}`:`${material.source} · ${material.size.toLocaleString('ru-RU')} байт · ${material.container} · ${material.codecs}`;
  $('episode-summary').textContent=material.series?`Выбран элемент S${subject.season}E${subject.episode}, provider ID ${subject.episodeProviderId ?? 'не установлен'}. Фактический выбор требует changeEpisode из Lift.`:'Одиночный ролик / фильм; сезон и эпизод не применяются.';
  $('rights-note').textContent=lift?(material.group==='control'?'Открытый контроль Sintel: выбирайте оригинальную английскую дорожку.':'Выборка владельца: запуск штатного плеера разрешён интерфейсом. Доступность определяет Lift; ограничения поставщика не обходятся.'):material.license+'. '+material.dependency+' Это транспортная проба, не наличие десяти желаемых произведений.';
  $('start').disabled=false; $('start').textContent=lift?'Получить и открыть Lift':'Подготовить торрентный плеер';
  $('catalog-test').hidden=!lift; $('catalog-data').hidden=!lift; $('cadence-info').hidden=!lift;
  $('collector-state').hidden=!lift;
  $('torrent-data').hidden=lift; $('restore-position').hidden=lift;
  $('torrent-declared').textContent=lift?'':`Файл ${material.filename}. Данные файла: ${material.declaredQuality || material.codecs}; дорожки: ${(material.audioLabels || []).join('; ') || 'не описаны'}. Это metadata, не испытанное качество или услышанный звук.`;
  $('progress-diagnostic').hidden=!lift;renderEpisodeOptions();
  $('transport-state').textContent='Транспорт ещё не запускался. Metadata и HTTP-медиабайты учитываются раздельно.';
  if(lift) {
    run.catalogSnapshot=material.snapshot;
    $('catalog-state').textContent=`Снимок исследования ${material.snapshot.checkedAt}: найдено, штатный iframe получен. Это не новый запрос текущего прогона.`;
    $('catalog-labels').textContent=`Метка качества API: ${material.snapshot.catalogQuality}; аудиодорожки в конфигурации: ${(selectedEpisode()?.audioLabels || material.snapshot.audioLabels).join(', ') || 'не установлены'}. Эти названия не подтверждают фактический русский звук. Субтитры: ${(selectedEpisode()?.subtitleLabels || material.snapshot.subtitleLabels).join(', ') || 'не найдены в конфигурации'}.`;
  }
  for(const key of Object.keys(assessmentFields)) $('assessment-'+key).value=run.media[key] || 'NOT_RUN';
  $('manual-status').textContent='';$('episode-status').textContent='';$('native-audio-state').textContent='';showSaved();renderOwnerMatrix();
}
async function changeSelection(conn, id, season, episodeProviderId) {
  if(switching)return;
  switching=true; $('connection').disabled=true; $('material').disabled=true;
  try {
    await detach();

    clearTimeout(rejectedTimer);rejectedTimer=null;rejectedPending=0;
    log('subject_closed');run.ended=utc();
    connection=conn;material=findMaterial(conn,id) || (conn==='lift'?catalog[0]:TORRENT_MATERIALS.find(item=>item.allowed.includes(conn)));
    subject=makeSubject(season,episodeProviderId);saved=positionFor(journal,subject,storage);
    run=makeRun(mode,BUILD,subject);journal.runs.push(run);journal.currentByMode[currentKey()]=run.runId;
    run.environment={mode,standalone,onlineAtStart:navigator.onLine,secureContext:isSecureContext};
    journal.selection={connection,materialId:material.id,season:subject.season,episodeProviderId:subject.episodeProviderId};resetRuntime();renderMaterialOptions();renderContext();
    $('status').textContent='Выбран новый источник/материал. Предыдущий остановлен. Запуск — отдельной кнопкой.';
    log('subject_selected',{subject});
  }catch(error){showFailure(error);}finally{switching=false;$('connection').disabled=false;$('material').disabled=false;}
}
$('connection').onchange=()=>changeSelection($('connection').value,null);
$('material').onchange=()=>changeSelection(connection,$('material').value);

const assessmentFields={mainVideo:'Основное видео',ruAudio:'Русский звук',quality:'Качество',subtitles:'Субтитры',ads:'Реклама',navigation:'Посторонние переходы',seek:'Перемотка',restore:'Восстановление',episodeSelection:'Выбор эпизода',episodeEnded:'Окончание выбранного эпизода'};
for(const [key,label] of Object.entries(assessmentFields)) {
  const wrapper=document.createElement('label');wrapper.textContent=label;
  const select=document.createElement('select');select.id='assessment-'+key;
  const values=key==='quality'?['NOT_RUN','480p','720p','1080p','2160p','OTHER']:['NOT_RUN','OBSERVED_YES','OBSERVED_NO','INCONCLUSIVE','NOT_APPLICABLE'];
  for(const value of values)select.add(new Option(({NOT_RUN:'Не проверено',OBSERVED_YES:'Да — ручное наблюдение',OBSERVED_NO:'Нет — ручное наблюдение',INCONCLUSIVE:'Не удалось установить',NOT_APPLICABLE:'Не применимо',OTHER:'Другое'}[value])||value,value));
  wrapper.append(select);$('assessments').append(wrapper);
}
$('save-assessment').onclick=()=>{
  const values={};for(const key of Object.keys(assessmentFields))values[key]=$('assessment-'+key).value;
  Object.assign(run.media,values);log('manual_media_assessment',{values,source:'manual; not player telemetry'});
  $('manual-status').textContent='Ручные результаты записаны отдельно от событий плеера.';
};
$('compare').onclick=()=>{
  const rows=[...(oldLift?.runs || []).map(r=>({...r,subject:{connection:'lift',materialId:3637},legacy:true})),...journal.runs];
  $('comparison-body').replaceChildren(...rows.map(r=>{
    const tr=document.createElement('tr'),s=r.subject,p=r.lastPosition;
    const values=[`${s.connection} / ${s.materialId}${s.season!==null && s.season!==undefined?' S'+s.season+'E'+s.episode:''}${r.legacy?' (архив)':''}`,r.runId,r.mode,p?p.time.toFixed(1)+' / '+p.duration.toFixed(1):'нет',p?.utc || 'нет',r.transport?.actualTransport || 'нет данных',r.events.filter(e=>(e.kind==='iframe_message' && e.event==='ended') || (e.kind==='native_video' && e.event==='ended')).length];
    for(const value of values){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}return tr;
  }));$('comparison').hidden=false;
};
renderMaterialOptions();renderContext();$('connection').disabled=false;$('material').disabled=false;

document.addEventListener('visibilitychange', () => log('visibility', {state: document.visibilityState}));
window.addEventListener('pagehide', e => log('pagehide', {persisted: e.persisted}));
window.addEventListener('pageshow', e => { if (e.persisted) log('pageshow', {persisted: true}); });
function updateEnvironment(){ $('environment').textContent = `${standalone ? 'Экран «Домой» · standalone' : 'Вкладка браузера · не standalone'} · сеть ${navigator.onLine ? 'доступна' : 'отключена'}`; }
window.addEventListener('online', () => {updateEnvironment();log('network', {online: true});});
window.addEventListener('offline', () => {updateEnvironment();log('network', {online: false});});
document.addEventListener('fullscreenchange', () => log('parent_fullscreen', {active: !!document.fullscreenElement}));
window.addEventListener('error', () => log('parent_js_error'));
window.addEventListener('unhandledrejection', () => log('parent_promise_error'));
updateEnvironment();
$('build-info').textContent = `Lift ${BUILD.version} · commit ${BUILD.commit.slice(0, 12)}`;
log('harness_ready', {mode, standalone, secureContext: isSecureContext, build: BUILD}); showSaved();

if ('serviceWorker' in navigator) {
  const recheckRetiredCache=()=>{
    // The retired network-first worker may finish a fetch after activation and
    // recreate its cache. Recheck after the new document/controller has settled.
    for(const delay of [0,3000,10000])setTimeout(()=>{
      const controller=navigator.serviceWorker.controller;if(!controller)return;
      const channel=new MessageChannel();const timer=setTimeout(()=>channel.port1.close(),1500);
      channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();if(e.data?.type==='KADR_SHELL_CLEANED')log('shell_cache_rechecked',{deleted:Number.isInteger(e.data.deleted)?e.data.deleted:0});};
      controller.postMessage({type:'KADR_SHELL_CLEANUP'},[channel.port2]);
    },delay);
  };
  navigator.serviceWorker.addEventListener('controllerchange',recheckRetiredCache);
  // Same script URL and scope as the old lab; no broad unregistration or storage.clear().
  navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'})
    .then(async registration => { await registration.update(); log('shell_migration_checked');recheckRetiredCache(); })
    .catch(() => log('shell_migration_unavailable'));
}
