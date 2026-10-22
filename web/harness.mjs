// Based on the supplied Lift harness; native messages never become completion scores.
import {sanitize, accept, progress, safeDiagnostic} from './collector.mjs';
import {CONFIG} from './config.js';
import {getFreshEmbed, LiftError} from './lift-api.mjs';
import {JOURNAL_KEY, POSITION_KEY, LEGACY_KEY, makeRun, append, readJournal, readPosition, exportResult, utc} from './journal.mjs';
import {redactLegacy} from './legacy.mjs';
import {BUILD} from './build.js';

const $ = id => document.getElementById(id);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const mode = standalone ? 'standalone' : 'browser';
const visitId = crypto.randomUUID();
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
};
for (const [value, label] of Object.entries(observations)) $('note').add(new Option(label, value));

let storage, journal, persistent = true, recoveryRaw = null, saved = null;
try {
  storage = window.localStorage;
  journal = readJournal(storage);
  saved = readPosition(storage);
} catch {
  persistent = false;
  try { recoveryRaw = storage?.getItem(JOURNAL_KEY); } catch { /* unavailable */ }
  journal = {schema: 2, runs: [], currentByMode: {}};
  $('storage-warning').hidden = false;
  $('storage-warning').textContent = 'Локальный журнал недоступен или повреждён. Он не перезаписывается. Новые события остаются в памяти — экспортируйте JSON до закрытия.';
  $('recovery').hidden = recoveryRaw === null;
}
let run = journal.runs.find(r => r.runId === journal.currentByMode[mode] && r.mode === mode && !r.ended);
if (!run) { run = makeRun(mode, BUILD); journal.runs.push(run); journal.currentByMode[mode] = run.runId; }
let frame = null, origin = '', request = null, epoch = 0, frameTimer, pingTimer;
let runtime = {}, rejectedPending = 0, rejectedTimer = null, lastMessageSecond = 0, messageCount = 0;
resetRuntime();

function persist() {
  if (!persistent) return;
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify(journal));
    if (saved) storage.setItem(POSITION_KEY, JSON.stringify(saved));
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
}
function resetRuntime() {
  runtime = {loaded: false, ready: false, started: false, progressed: false, last: null, endedSoon: false, ended: false, restoreBaseline: saved};
  $('frame-state').textContent = 'Не запущен'; $('ready-state').textContent = 'Нет playerReady';
  $('play-state').textContent = 'Нет реальных событий'; $('end-state').textContent = 'Нет ended';
  $('position').textContent = 'Позиция и длительность в этой загрузке ещё не получены.';
  $('restore').textContent = '';
}
function showSaved() {
  $('saved').textContent = saved ? `Сохранённая позиция: ${saved.time.toFixed(1)} / ${saved.duration.toFixed(1)} с · ${saved.utc}. Автоматический seek не выполняется.` : 'Сохранённой позиции нет.';
}
function detach() {
  request?.abort(); request = null; epoch++;
  clearTimeout(frameTimer); clearTimeout(pingTimer);
  frame?.remove(); frame = null; origin = '';
  $('placeholder').hidden = false;
  $('start').disabled = false;
  $('reload').disabled = true; $('stop').disabled = true; $('ping').disabled = true;
  $('bridge').textContent = 'Мост ещё не проверен. Pong подтверждает связь, но не воспроизведение.';
}
const errorLabels = {
  api_network_or_cors: 'API недоступен: сеть, CORS или отказ перенаправления. Точную причину браузер странице не раскрывает.',
  api_timeout_or_cancel: 'API не ответил за 25 секунд. Повторите после проверки сети.',
  api_http_error: 'API вернул HTTP-отказ.', api_non_json: 'API вернул ответ другого формата.',
  api_provider_error: 'API сообщил об отказе.', api_too_large: 'Ответ API превышает допустимый размер.',
  identity_mismatch: 'Ответ не соответствует Sintel (2010), ID 3637. Опыт остановлен.',
  embed_missing: 'В ответе нет штатного iframe.', embed_invalid: 'Штатная ссылка iframe имеет неверный формат.',
  embed_origin_or_path: 'Изменился origin или путь штатного iframe. Опыт остановлен до проверки разработчиком.',
};
async function load(reload = false) {
  const baseline = saved;
  detach(); resetRuntime(); runtime.restoreBaseline = baseline;
  run.generation++; const generation = run.generation, thisEpoch = epoch;
  $('status').textContent = 'Получаем свежий iframe из API Lift…'; $('frame-state').textContent = 'Запрос API';
  $('start').disabled = true;
  log(reload ? 'iframe_reload_requested' : 'iframe_start_requested', {savedBefore: baseline});
  const controller = new AbortController(); request = controller;
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const result = await getFreshEmbed(controller.signal);
    if (thisEpoch !== epoch) return;
    log('api_success', {httpStatus: result.httpStatus, browserCors: 'response-readable'});
    // Fresh contentWindow on every attempt prevents messages from the old generation.
    frame = document.createElement('iframe'); frame.id = 'frame'; frame.title = 'Sintel — штатный плеер Lift';
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
$('start').onclick = () => load(false);
$('reload').onclick = () => load(true);
$('stop').onclick = () => { detach(); $('status').textContent = 'Iframe закрыт. Позиция и журнал сохранены.'; $('frame-state').textContent = 'Закрыт'; log('iframe_closed'); };

$('ping').onclick = () => {
  if (!frame || !origin) return;
  clearTimeout(pingTimer); runtime.pingAt = performance.now();
  frame.contentWindow.postMessage('ping', origin); log('command', {event: 'ping'});
  $('bridge').textContent = 'Ping отправлен; ждём pong из этого iframe…';
  pingTimer = setTimeout(() => { runtime.pingAt = null; $('bridge').textContent = 'Pong за 5 секунд не получен. Поддержка моста в этой загрузке не подтверждена.'; log('ping_timeout'); }, 5000);
};
function reject() {
  run.rejectedMessages++; rejectedPending++;
  if (rejectedTimer) return;
  rejectedTimer = setTimeout(() => { rejectedTimer = null; const count = rejectedPending; rejectedPending = 0; log('rejected_messages', {count}); }, 1000);
}
window.addEventListener('message', e => {
  if (!accept(e, frame?.contentWindow, origin)) { reject(); return; }
  const second = Math.floor(performance.now() / 1000);
  if (second !== lastMessageSecond) { lastMessageSecond = second; messageCount = 0; }
  if (++messageCount > 30) { reject(); return; }
  const data = sanitize(e.data);
  if (!data) { reject(); return; }
  if (data.event === 'pong') {
    const matched = Number.isFinite(runtime.pingAt);
    const elapsedMs = matched ? Math.round(performance.now() - runtime.pingAt) : null;
    clearTimeout(pingTimer); runtime.pingAt = null;
    $('bridge').textContent = matched ? `Получен настоящий pong (${elapsedMs} мс). Связь подтверждена; видео этим не проверяется.` : 'Получен pong без ожидающего ping; воспроизведение этим не подтверждено.';
    log('iframe_message', {...data, matchedPing: matched, roundTripMs: elapsedMs}); return;
  }
  if (data.event === 'playerReady') { runtime.ready = true; $('ready-state').textContent = 'Получен playerReady'; }
  if (data.event === 'startWatching') {
    runtime.started = true; $('play-state').textContent = 'Получен startWatching (сигнал старта)';
  }
  const p = progress(data);
  if (p) {
    const first = !runtime.last;
    const advance = runtime.last && p.time > runtime.last.time && p.time - runtime.last.time <= 5;
    runtime.last = p; runtime.progressed ||= !!advance;
    $('play-state').textContent = runtime.progressed ? 'Позиция менялась по реальным viewProgress; пауза / seek извне неизвестны' : 'Получен viewProgress; одного значения недостаточно для вывода о воспроизведении';
    $('position').textContent = `Последнее реальное viewProgress: ${p.time.toFixed(1)} / ${p.duration.toFixed(1)} с · ${utc()}`;
    if (first && runtime.restoreBaseline) {
      const before = runtime.restoreBaseline;
      $('restore').textContent = `До загрузки сохранено ${before.time.toFixed(1)} с; первое новое событие — ${p.time.toFixed(1)} с. Разница ${(p.time - before.time).toFixed(1)} с. Восстановление вручную оцените отдельно.`;
      log('restore_comparison', {savedTime: before.time, firstRealTime: p.time, automaticSeekAttempted: false});
    }
    saved = {...p, utc: utc(), materialId: CONFIG.materialId, runId: run.runId}; run.lastPosition = saved; showSaved();
  }
  if (data.event === 'endedSoon') { runtime.endedSoon = true; if (!runtime.ended) $('end-state').textContent = 'Получен endedSoon; ended ещё не подтверждён'; }
  if (data.event === 'ended') { runtime.ended = true; $('end-state').textContent = 'Получен настоящий ended. «Просмотрено» не выставляется.'; }
  if (data.event === 'adStart' || data.event === 'click overlay') $('status').textContent = 'Получен рекламный сигнал Lift. Отметьте, что было видно; это отдельно от фактического показа.';
  log('iframe_message', data);
});

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
  download(exportResult(journal, run, environment, saved), `KADR_LIFT_STAND_${mode}_${run.runId}.json`);
};
$('new-run').onclick = () => {
  log('run_closed'); run.ended = utc(); detach();
  run = makeRun(mode, BUILD); journal.runs.push(run); journal.currentByMode[mode] = run.runId;
  resetRuntime(); $('status').textContent = 'Новый прогон готов. Получите iframe кнопкой выше.';
  log('run_created', {mode}); showSaved();
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

document.addEventListener('visibilitychange', () => log('visibility', {state: document.visibilityState}));
window.addEventListener('pagehide', e => log('pagehide', {persisted: e.persisted}));
window.addEventListener('pageshow', e => { if (e.persisted) log('pageshow', {persisted: true}); });
window.addEventListener('online', () => log('network', {online: true}));
window.addEventListener('offline', () => log('network', {online: false}));
document.addEventListener('fullscreenchange', () => log('parent_fullscreen', {active: !!document.fullscreenElement}));
window.addEventListener('error', () => log('parent_js_error'));
window.addEventListener('unhandledrejection', () => log('parent_promise_error'));
$('environment').textContent = `${standalone ? 'Экран «Домой» · standalone' : 'Вкладка браузера · не standalone'} · сеть ${navigator.onLine ? 'доступна' : 'отключена'}`;
$('build-info').textContent = `Lift ${BUILD.version} · commit ${BUILD.commit.slice(0, 12)}`;
log('harness_ready', {mode, standalone, secureContext: isSecureContext, build: BUILD}); showSaved();

if ('serviceWorker' in navigator) {
  // Same script URL and scope as the old lab; no broad unregistration or storage.clear().
  navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'})
    .then(async registration => { await registration.update(); log('shell_migration_checked'); })
    .catch(() => log('shell_migration_unavailable'));
}
