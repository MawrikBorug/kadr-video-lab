import Hls from './vendor/hls.mjs';
import { PROVIDERS, buildRequest, selectEpisode } from './providers.js';
import { CHECKS, ADS, DETAILS, RESULTS, AD_RESULTS, makeRecord, appendEvent, acceptPostMessage, loadJournal, saveJournal, exportJSON, exportCSV, resultIssues } from './core.js';

const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const message = (text, danger = false) => { $('message').textContent = text; $('message').classList.toggle('danger', danger); };
let storage;
try { storage = window.localStorage; } catch { /* loadJournal reports unavailable storage */ }
const loaded = loadJournal(storage);
const records = loaded.records;
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
  if (!loaded.error) storageWarning(saveJournal(storage, records));
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
const filename = extension => `kadr-3.3-${new Date().toISOString().replaceAll(':', '-')}.${extension}`;

for (const [key, provider] of Object.entries(PROVIDERS)) {
  const option = el('option', `${provider.name}${provider.enabled ? '' : ' · не подтверждён'}`);
  option.value = key; $('provider').append(option);
}

function providerInfo() {
  const provider = PROVIDERS[$('provider').value];
  const card = $('provider-info');
  card.replaceChildren(el('p', provider.gate, 'status'), el('p', provider.live), el('p', provider.description), el('p', provider.limitation));
  const link = el('a', 'Первичный источник ↗'); link.href = provider.source; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
  $('quality-label').hidden = provider.kind !== 'hls';
  $('sandbox-label').hidden = provider.kind !== 'iframe';
  $('sandbox-hint').hidden = provider.kind !== 'iframe';
  $('id-hint').textContent = provider.kind === 'hls' ? 'Для другого сезона нужен его ID релиза. Номер сезона не преобразуется в ID автоматически.' : provider.kind === 'iframe' ? 'Только TMDB. IMDb не конвертируется: проверенного бесключевого сопоставления нет.' : 'Можно сохранить попытку с результатом «источник не подтвердился».';
  $('content-id').required = provider.enabled;
  $('open-source').textContent = provider.enabled ? 'Открыть источник вручную' : 'Зафиксировать неподтверждённый источник';
  $('unrestricted-label').hidden = provider.kind !== 'iframe' || $('sandbox').value !== 'documented';
}

function applySample() {
  const sample = samples.find(item => item.key === $('sample').value);
  $('catalog-link').hidden = !sample;
  if (!sample) return;
  $('catalog-link').href = sample.source;
  $('title').value = sample.title;
  $('type').value = sample.type;
  $('season').value = sample.season || '1'; $('episode').value = sample.episode || '1';
  const anime = $('provider').value === 'aniliberty';
  $('namespace').value = anime ? 'aniliberty' : 'tmdb';
  $('content-id').value = (anime ? sample.aniliberty : sample.tmdb) || '';
  providerInfo();
}

$('provider').addEventListener('change', () => {
  $('namespace').value = $('provider').value === 'aniliberty' ? 'aniliberty' : 'tmdb';
  $('unrestricted-consent').checked = false;
  providerInfo(); applySample();
});
$('sample').addEventListener('change', applySample);
$('sandbox').addEventListener('change', () => { $('unrestricted-consent').checked = false; providerInfo(); });

const resultText = { NOT_RUN: 'NOT_RUN · не проверено', PASS: 'PASS · подтверждено', FAIL: 'FAIL · не прошло', INCONCLUSIVE: 'INCONCLUSIVE · недостаточно данных', OBSERVED: 'Наблюдалось', NOT_OBSERVED: 'Не наблюдалось в сеансе' };

function addObservation(parent, group, key, label, options) {
  const wrapper = el('label', label);
  const control = options ? el('select') : el(key.endsWith('Seconds') ? 'input' : 'textarea');
  control.id = `obs-${group}-${key}`;
  if (options) for (const optionValue of options) { const option = el('option', resultText[optionValue]); option.value = optionValue; control.append(option); }
  else {
    control.maxLength = 2000;
    if (key.endsWith('Seconds')) { control.type = 'number'; control.min = '0'; control.max = '86400'; control.step = '0.1'; control.inputMode = 'decimal'; }
  }
  wrapper.append(control); $(parent).append(wrapper); observations.set(`${group}.${key}`, control);
  control.addEventListener(options ? 'change' : 'input', () => {
    if (!current) return;
    if (group === 'tracking') current.tracking = control.value;
    else current[group][key] = control.value;
    current.updatedAt = new Date().toISOString();
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
  const issues = resultIssues(current);
  if (issues.length) {
    if (current.checks.fullNoAds === 'PASS' && (current.config.watchScope !== 'full' || current.checks.ended !== 'PASS' || Object.values(current.ads).some(value => value !== 'NOT_OBSERVED'))) {
      current.checks.fullNoAds = 'INCONCLUSIVE'; observations.get('checks.fullNoAds').value = 'INCONCLUSIVE';
    }
    if (current.status === 'PASS') { current.status = 'INCONCLUSIVE'; $('outcome').value = current.status; }
  }
  $('consistency').hidden = !issues.length;
  $('consistency').textContent = issues.length ? issues.join(' ') + ' Противоречащая отметка заменена на INCONCLUSIVE; измерения сохранены.' : '';
  if (priorStatus !== current.status) renderHistory();
}

$('outcome').addEventListener('change', () => {
  if (!current) return;
  current.status = $('outcome').value;
  current.updatedAt = new Date().toISOString();
  enforceConsistency(); persist(); renderHistory();
});
$('observations').addEventListener('submit', event => event.preventDefault());

function renderCurrent() {
  $('observation-fields').disabled = !current;
  $('config-fields').disabled = Boolean(current);
  $('open-source').disabled = Boolean(current);
  $('current-record').textContent = current ? `${current.config.stage} · ${current.config.title} · ${current.createdAt} · ${current.id}` : 'Сначала откройте источник. Каждая попытка создаёт отдельную запись.';
  for (const [path, control] of observations) {
    const [group, key] = path.split('.');
    control.value = current ? (group === 'tracking' ? current.tracking : current[group][key]) : group === 'details' ? '' : 'NOT_RUN';
  }
  $('outcome').value = current?.status || 'NOT_RUN';
  $('consistency').hidden = true;
  renderEvents(); renderHistory();
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
    item.append(el('summary', `${record.status} · ${PROVIDERS[record.config.provider]?.name || 'Источник'} · ${record.config.title} · ${record.createdAt}`));
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      item.querySelector('pre')?.remove(); item.querySelector('button')?.remove();
      const copy = el('button', 'Скачать эту запись'); copy.type = 'button'; copy.addEventListener('click', () => download(exportJSON([record]), `kadr-${record.id}.json`, 'application/json'));
      item.append(copy, el('pre', JSON.stringify(record, null, 2)));
    });
    return item;
  });
  $('history').replaceChildren(...(nodes.length ? nodes : [el('p', 'Записей пока нет.', 'hint')]));
}

function readConfig() {
  const sample = samples.find(item => item.key === $('sample').value);
  return { provider: $('provider').value, sampleKey: sample?.key || 'custom', category: sample?.category || 'custom',
    title: $('title').value.trim(), type: $('type').value, namespace: $('namespace').value, id: $('content-id').value.trim(),
    season: $('season').value, episode: $('episode').value, quality: $('quality').value,
    sandbox: $('sandbox').value, unrestrictedConsent: $('unrestricted-consent').checked,
    accessAcknowledged: $('access-consent').checked, stage: $('stage').value, watchScope: $('watch-scope').value };
}

function readEnvironment() {
  return { device: $('device').value, country: $('country').value, network: $('network').value, blocker: $('blocker').value,
    sessionId: visitId, userAgent: navigator.userAgent.slice(0, 400), displayMode: matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'standalone' : 'browser',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown' };
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
  if (current && runtime) { log(current, { type: 'source-closed', channel: 'lab' }); current.endedAt = new Date().toISOString(); }
  dispose(); persist(); renderHistory();
}
$('stop').addEventListener('click', () => { closeSource(); message('Источник закрыт. Ручные наблюдения можно дописать; новый запуск создаст другой сеанс.'); });
$('new-session').addEventListener('click', () => {
  closeSource(); current = null; renderCurrent();
  message('Укажите условия новой попытки. Предыдущая запись осталась в журнале.');
  $('provider').focus();
});

async function getRelease(url, signal) {
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin', cache: 'no-store', signal });
  if (!response.ok) throw new Error(`API ответил HTTP ${response.status}. Доступность фильма этим не установлена.`);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Источник не подтвердился: API вернул не JSON.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Ответ API превышает лимит 1 МиБ.'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new Error('Источник не подтвердился: некорректный JSON.'); }
}

function mountVideo(stream, record, token) {
  const video = el('video'); video.controls = true; video.playsInline = true; video.preload = 'none'; video.crossOrigin = 'anonymous'; video.setAttribute('aria-label', 'Прямой HLS AniLiberty');
  runtime.video = video; let lastTimeupdate = 0;
  const listeners = [];
  for (const type of ['loadedmetadata', 'play', 'playing', 'pause', 'timeupdate', 'seeking', 'seeked', 'ended', 'waiting', 'error']) {
    const listener = () => {
      if (generation !== token || current !== record) return;
      if (type === 'timeupdate') { if (performance.now() - lastTimeupdate < 30000) return; lastTimeupdate = performance.now(); }
      log(record, { type, channel: 'native', origin: stream.origin, currentTime: video.currentTime, duration: video.duration, elapsedSeconds: (performance.now() - runtime.openedAt) / 1000, code: video.error?.code });
      if (type === 'error') message(`Плеер сообщил ошибку ${video.error?.code || ''}. Запишите наблюдение; это не доказывает отсутствие произведения.`, true);
    };
    video.addEventListener(type, listener); listeners.push([type, listener]);
  }
  runtime.cleanup = () => { for (const [type, listener] of listeners) video.removeEventListener(type, listener); };
  $('player').replaceChildren(video);
  if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = stream.url; record.technical.playbackEngine = 'native-hls'; }
  else if (Hls.isSupported()) {
    const hls = new Hls({ maxBufferLength: 20, maxMaxBufferLength: 30, backBufferLength: 30 });
    runtime.hls = hls; record.technical.playbackEngine = 'hls.js';
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || generation !== token || current !== record) return;
      log(record, { type: 'hls-fatal-error', channel: 'hls' });
      message('HLS не удалось загрузить или декодировать. Возможны ограничения сети, CORS или кодеков. Зафиксируйте результат, не меняя рекламных параметров.', true);
      hls.destroy(); if (runtime?.hls === hls) runtime.hls = null;
    });
    hls.loadSource(stream.url); hls.attachMedia(video);
  } else {
    message('В этом браузере нет совместимого HLS-движка. Результат воспроизведения INCONCLUSIVE; попробуйте Safari на iPhone.', true);
    log(record, { type: 'hls-unsupported', channel: 'lab' }); return;
  }
  for (const id of ['play', 'pause', 'seek']) $(id).disabled = false;
  persist();
}

$('setup-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (current) return;
  if (records.length >= 240) { message('Достигнут лимит 240 записей. Экспортируйте журнал; новые попытки не перезаписывают старые.', true); return; }
  const config = readConfig();
  if (!config.accessAcknowledged) { message('Подтвердите право доступа к тестируемому контенту.', true); return; }
  let request;
  try { request = buildRequest(config); } catch (error) {
    if (PROVIDERS[config.provider]?.enabled) { message(error.message, true); return; }
    current = makeRecord(config, readEnvironment()); records.push(current); current.status = 'INCONCLUSIVE'; current.technical.blocked = 'unconfirmed-contract';
    log(current, { type: 'source-not-confirmed', channel: 'lab' }); renderCurrent(); message(error.message, true); return;
  }
  dispose();
  current = makeRecord(config, readEnvironment()); records.push(current);
  const record = current; const token = generation;
  runtime = { controller: new AbortController(), openedAt: performance.now(), iframe: null, video: null, hls: null };
  const controller = runtime.controller;
  log(record, { type: 'source-requested', channel: 'lab', origin: new URL(request.url).origin });
  renderCurrent(); $('stop').disabled = false;
  message('Запрос источника… Наличие произведения и старт видео проверяются отдельно.');
  if (request.kind === 'iframe') {
    const frame = el('iframe'); frame.title = `Внешний плеер YapGrid: ${config.title}`;
    if (request.sandbox !== null) frame.setAttribute('sandbox', request.sandbox);
    frame.allow = 'fullscreen; picture-in-picture'; frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin';
    runtime.iframe = frame; runtime.origin = request.origin;
    frame.addEventListener('load', () => {
      if (generation !== token || current !== record) return;
      log(record, { type: 'iframe-load-not-content-proof', channel: 'iframe', origin: request.origin });
      message('Получено событие загрузки iframe. Внутри может быть ошибка или блокировка: вручную проверьте страницу, точное произведение и старт.');
    });
    frame.src = request.url; $('player').replaceChildren(frame);
    record.technical.iframeOrigin = request.origin; record.technical.sandbox = request.sandbox; record.technical.postMessageContract = 'not-documented-all-rejected';
    $('provenance').textContent = `iframe: ${request.origin}. ${request.sandbox === null ? 'Без sandbox: возможны окна и навигация.' : `sandbox="${request.sandbox}".`} DOM и запросы чужого плеера стенду недоступны; postMessage отключён из-за отсутствия контракта.`;
    persist(); return;
  }
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const release = await getRelease(request.url, controller.signal);
    if (generation !== token || current !== record || controller.signal.aborted) return;
    const stream = selectEpisode(release, config.episode, config.quality);
    record.technical.apiResponded = true; record.technical.releaseTitle = stream.title; record.technical.episodeTitle = stream.episodeName; record.technical.mediaOrigin = stream.origin;
    // The original HLS URL exists only in memory; never write it to the journal.
    $('provenance').textContent = `API: https://anilibria.top · CDN: ${stream.origin}. Ответ: «${stream.title}», эпизод ${stream.ordinal} «${stream.episodeName}». Поток без изменений рекламных параметров; трафик идёт напрямую поставщику.`;
    message('API вернул эпизод и HLS. Нажмите Play в плеере; затем вручную подтвердите точное произведение, дорожку и воспроизведение.');
    log(record, { type: 'api-release-received', channel: 'lab', origin: 'https://anilibria.top' });
    mountVideo(stream, record, token);
  } catch (error) {
    if (generation !== token || current !== record) return;
    const reason = controller.signal.aborted ? 'Запрос API не завершился за 20 секунд. Возможна ошибка сети или CORS.' : error instanceof TypeError ? 'Источник не подтвердился: сетевая ошибка или CORS. В этой среде ответ API прочитать не удалось.' : error.message;
    record.technical.apiError = true; log(record, { type: 'api-error', channel: 'lab' });
    message(reason, true);
  } finally { clearTimeout(timeout); }
});

window.addEventListener('message', event => {
  if (!runtime?.iframe || !current) return;
  const result = acceptPostMessage(event, { expectedOrigin: runtime.origin, expectedSource: runtime.iframe.contentWindow, parse: null });
  // Deliberately no parser for YapGrid; adding one requires a verified contract.
  if (result) log(current, { ...result, channel: 'postMessage', origin: event.origin });
  else {
    current.rejectedMessages = Math.min(1000000, current.rejectedMessages + 1);
    if (!rejectedFlush) rejectedFlush = setTimeout(() => { rejectedFlush = null; persist(); renderEvents(); }, 1000);
  }
});

$('play').addEventListener('click', async () => {
  const video = runtime?.video; if (!video) return;
  log(current, { type: 'command-play', channel: 'lab' });
  try { await video.play(); } catch { message('Не удалось запустить видео командой. Попробуйте ручной Play в самом плеере и запишите результат.', true); }
});
$('pause').addEventListener('click', () => { if (runtime?.video) { log(current, { type: 'command-pause', channel: 'lab' }); runtime.video.pause(); } });
$('seek').addEventListener('click', () => {
  const video = runtime?.video; if (!video) return;
  if (!Number.isFinite(video.duration) || video.duration <= 0) { message('Длительность ещё неизвестна. Дождитесь начала видео перед seek.', true); return; }
  log(current, { type: 'command-seek50', channel: 'lab', currentTime: video.duration / 2 }); video.currentTime = video.duration / 2;
});

$('export-json').addEventListener('click', () => { persist(); download(exportJSON(records), filename('json'), 'application/json'); });
$('export-csv').addEventListener('click', () => { persist(); download(exportCSV(records), filename('csv'), 'text/csv;charset=utf-8'); });
$('export-recovery').addEventListener('click', () => download(loaded.raw || '', filename('recovery.txt'), 'text/plain;charset=utf-8'));
$('share-json').addEventListener('click', async () => {
  const file = new File([exportJSON(records)], filename('json'), { type: 'application/json' });
  if (!navigator.canShare?.({ files: [file] })) { download(exportJSON(records), file.name, 'application/json'); message('Файловый Share недоступен: JSON подготовлен как загрузка. Сохраните его в «Файлы».'); return; }
  try { await navigator.share({ files: [file], title: 'КАДР 3.3: журнал испытаний' }); }
  catch (error) { if (error.name !== 'AbortError') message('Не удалось передать файл. Используйте «Скачать JSON».', true); }
});

function onlineStatus() { $('offline').hidden = navigator.onLine; }
window.addEventListener('online', onlineStatus); window.addEventListener('offline', onlineStatus); onlineStatus();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
window.addEventListener('pagehide', persist);

async function boot() {
  try {
    const response = await fetch('./data/samples.json'); if (!response.ok) throw new Error(); samples = await response.json();
    for (const sample of samples) { const option = el('option', sample.title); option.value = sample.key; $('sample').append(option); }
  } catch { message('Выборка не загрузилась. Можно ввести документированный ID вручную.', true); }
  if (current) {
    const config = current.config; const env = current.environment;
    for (const [id, key] of [['provider','provider'], ['sample','sampleKey'], ['title','title'], ['type','type'], ['namespace','namespace'], ['content-id','id'], ['season','season'], ['episode','episode'], ['quality','quality'], ['sandbox','sandbox'], ['stage','stage'], ['watch-scope','watchScope']]) if (config[key] !== undefined) $(id).value = config[key];
    for (const key of ['device','country','network','blocker']) if (env[key] !== undefined) $(key).value = env[key];
    if (!PROVIDERS[$('provider').value]) $('provider').value = 'aniliberty';
    $('access-consent').checked = Boolean(config.accessAcknowledged);
    providerInfo(); renderCurrent();
    message('Журнал восстановлен. Источник автоматически не открывается. Допишите наблюдения или создайте новый сеанс для повторного запуска.');
  } else { $('sample').value = samples.some(item => item.key === 'dandadan') ? 'dandadan' : 'custom'; applySample(); providerInfo(); renderCurrent(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { $('offline').hidden = false; $('offline').textContent = 'Офлайн-оболочка не установилась. Онлайн-стенд доступен; экспортируйте журнал перед закрытием.'; });
}
boot();
