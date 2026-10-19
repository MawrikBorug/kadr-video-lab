import {sanitize} from './security.js';
import {BUILD} from './build.js';
import {evidenceLevel} from './measurement.js';
export const VERSION = 2;
export const STORAGE_KEY = 'kadr.videoLab.v1';
export const RESULTS = ['NOT_RUN', 'PASS', 'FAIL', 'INCONCLUSIVE'];
export const AD_RESULTS = ['NOT_RUN', 'OBSERVED', 'NOT_OBSERVED', 'INCONCLUSIVE'];
export const CHECKS = {
  pageOpened: 'Страница / данные источника открылись', exactTitle: 'Найдено точное полное произведение',
  videoStarted: 'Видео действительно запустилось', fiveMinutes: '5 минут воспроизведения',
  seek50: 'Seek к 50% и возобновление', pause: 'Пауза сработала', ended: 'Достигнут конец основного видео',
  fullNoAds: 'Полный просмотр без рекламы', eventsReceived: 'Получены допустимые события',
};
export const ADS = { preRoll: 'Pre-roll', midRoll: 'Mid-roll', postRoll: 'Post-roll', overlay: 'Overlay / баннер', popup: 'Pop-up / новое окно', navigation: 'Изменение навигации' };
export const DETAILS = { voice: 'Язык и студия озвучки', subtitles: 'Язык и вид субтитров', observedQuality: 'Фактическое качество', startSeconds: 'Старт, секунд', seekRecoverySeconds: 'Возобновление после seek, секунд', watchMinutes: 'Фактически наблюдали, минут (E2 smoke ≥30)', payment: 'Оплата / ключ / сервер / другое приложение', mediaHost: 'Конечный медиахост (если наблюдаем)', trackingEvidence: 'Наблюдение трекинга: домены и метод', controlNotes: 'Управление, PiP, обрыв, таймер, смена серии', notes: 'Наблюдения / ошибки / точная версия произведения' };

export function makeRecord(config, environment, now = new Date().toISOString(), id = crypto.randomUUID()) {
  return { id, observationSchemaVersion:2, testId:id, attemptId:id, previousAttemptId:null, runId:null, build:BUILD, createdAt: now, createdAtMsk:new Date(Date.parse(now)+10800000).toISOString().replace('Z','+03:00'), updatedAt: now, endedAt: null, status: 'NOT_RUN',
    config: { ...config, e1RecordId: config.e1RecordId || null }, environment: { ...environment },
    checks: Object.fromEntries(Object.keys(CHECKS).map(key => [key, 'NOT_RUN'])),
    ads: Object.fromEntries(Object.keys(ADS).map(key => [key, 'NOT_RUN'])), tracking: 'NOT_RUN',
    details: Object.fromEntries(Object.keys(DETAILS).map(key => [key, ''])),
    events: [], droppedEvents: 0, rejectedMessages: 0, technical: {}, layers:{}, steps:[], manualConfirmations:[], adBreaks:[],
  };
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// No provider schema is invented here. The caller must supply a parser grounded
// in current documentation. YapGrid has none, so its parse argument is null.
export function acceptPostMessage(event, { expectedOrigin, expectedSource, parse } = {}) {
  if (typeof expectedOrigin !== 'string' || expectedOrigin === 'null' || !expectedSource || typeof parse !== 'function') return null;
  try { if (new URL(expectedOrigin).origin !== expectedOrigin || !expectedOrigin.startsWith('https://')) return null; } catch { return null; }
  if (event.origin !== expectedOrigin || event.source !== expectedSource || !isObject(event.data)) return null;
  try {
    const encoded = JSON.stringify(event.data);
    if (encoded.length > 4096) return null;
    const normalized = parse(event.data);
    if (!isObject(normalized) || !['ready', 'play', 'playing', 'pause', 'timeupdate', 'seeked', 'ended', 'error'].includes(normalized.type)) return null;
    const result = { type: normalized.type };
    for (const key of ['currentTime', 'duration']) {
      if (normalized[key] !== undefined) {
        if (typeof normalized[key] !== 'number' || !Number.isFinite(normalized[key]) || normalized[key] < 0 || normalized[key] > 1e7) return null;
        result[key] = normalized[key];
      }
    }
    if (result.currentTime !== undefined && result.duration !== undefined && result.currentTime > result.duration + 1) return null;
    return result;
  } catch { return null; }
}

export function appendEvent(record, data, at = new Date().toISOString()) {
  if (record.events.length >= 400) { record.droppedEvents += 1; return; }
  const event = { at, type: String(data.type).slice(0, 64), channel: String(data.channel || 'lab').slice(0, 20) };
  for (const key of ['currentTime', 'duration', 'elapsedSeconds', 'code']) {
    if (typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0) event[key] = Math.round(data[key] * 1000) / 1000;
  }
  if (typeof data.origin === 'string' && /^https:\/\/[^/?#]+$/.test(data.origin)) event.origin = data.origin.slice(0, 160);
  record.events.push(event);
  record.updatedAt = at;
}

const finished = record => Number.isFinite(Date.parse(record.endedAt)) && Date.parse(record.endedAt) >= Date.parse(record.createdAt);
const adKeys = record => record.observationSchemaVersion === 2 ? Object.keys(ADS) : Object.keys(ADS).filter(k => k !== 'postRoll');
const decisiveAds = record => adKeys(record).every(key => ['OBSERVED', 'NOT_OBSERVED'].includes(record.ads[key]));
const E2_CHECKS = ['pageOpened', 'exactTitle', 'videoStarted', 'pause'];

export function sameSubject(a, b) {
  if (!a.id || !a.namespace || !['movie', 'tv'].includes(a.type)) return false;
  if (!['provider', 'namespace', 'type', 'id'].every(key => String(a[key]).trim() === String(b[key] ?? '').trim())) return false;
  return a.type === 'movie' || ['season', 'episode'].every(key => Number.isFinite(Number(a[key])) && Number(a[key]) > 0 && Number(a[key]) === Number(b[key]));
}

export function e1Candidates(config, records, before = Date.now()) {
  return records.filter(record => record.config.stage === 'E1' && record.status === 'PASS' && finished(record)
    && Date.parse(record.endedAt) <= before && sameSubject(config, record.config) && resultIssues(record).length === 0);
}

export function e2PrerequisiteIssues(record, records = []) {
  if (record.config.stage !== 'E2') return [];
  const match = e1Candidates(record.config, records, Date.parse(record.createdAt)).find(candidate => candidate.id === record.config.e1RecordId);
  return match ? [] : ['E1 не подтверждён: нужна ссылка на предыдущий завершённый E1 PASS того же поставщика, ID, сезона и эпизода. E2 остаётся предварительной пробой.'];
}

export function adFreeIssues(record, records = []) {
  const issues = [];
  if (record.config.watchScope !== 'full' || record.checks.ended !== 'PASS' || !finished(record)) issues.push('Полный просмотр без рекламы требует режима полного просмотра, подтверждённого конца основного видео и завершения сеанса кнопкой «Закрыть источник».');
  if (['pageOpened', 'exactTitle', 'videoStarted'].some(key => record.checks[key] !== 'PASS')) issues.push('Для вывода без рекламы подтвердите открытие, точное полное произведение и фактический старт.');
  if (adKeys(record).some(key => record.ads[key] !== 'NOT_OBSERVED')) issues.push('Для вывода без рекламы нужны все рекламные категории «не наблюдалось»; пустые и неопределённые отметки не подходят.');
  if (record.technical.blocked) issues.push('Контракт источника не подтверждён.');
  if (record.measurement && !(record.measurement.ended === true && record.measurement.coverage >= .9 && record.measurement.completed === true)) issues.push('Наблюдаемый native-счётчик не подтверждает конец и 90% уникальных интервалов основного видео.');
  if (record.ads.postRoll === 'OBSERVED' || record.adBreaks?.length) issues.push('Зафиксирована реклама, включая журнал отдельных вставок.');
  if (record.technical.interrupted) issues.push('Прерванный сеанс не подтверждает полный просмотр без рекламы.');
  return [...issues, ...e2PrerequisiteIssues(record, records)];
}

export function resultIssues(record, records = []) {
  const issues = record.checks.fullNoAds === 'PASS' ? adFreeIssues(record, records) : [];
  if (record.status === 'PASS') {
    if (!['E1', 'E2'].includes(record.config.stage)) issues.push('Этап испытания не подтверждён.');
    if (record.technical.blocked) issues.push('Неподтверждённый контракт не позволяет поставить PASS этой попытке.');
    if (!record.environment.device || record.environment.device === 'unknown') issues.push('Для PASS укажите реальное устройство и браузер.');
    if (record.environment.country !== 'RU' || !['home', 'mobile'].includes(record.environment.network)) issues.push('Для PASS E1/E2 укажите реальную сеть РФ.');
    const required = record.config.stage === 'E1' ? ['pageOpened', 'exactTitle', 'videoStarted', 'fiveMinutes', 'seek50'] : E2_CHECKS;
    if (required.some(key => record.checks[key] !== 'PASS')) issues.push('PASS противоречит незавершённым обязательным наблюдениям этапа.');
    if (record.config.stage === 'E1') {
      if (record.details.startSeconds.trim() === '' || !Number.isFinite(Number(record.details.startSeconds)) || Number(record.details.startSeconds) < 0 || Number(record.details.startSeconds) > 30) issues.push('E1: фактический старт должен быть измерен и не превышать 30 секунд.');
      if (record.details.seekRecoverySeconds.trim() === '' || !Number.isFinite(Number(record.details.seekRecoverySeconds)) || Number(record.details.seekRecoverySeconds) < 0 || Number(record.details.seekRecoverySeconds) > 10) issues.push('E1: возобновление после seek должно быть измерено и не превышать 10 секунд.');
      if (!record.details.voice.trim()) issues.push('E1: зафиксируйте фактический язык и студию озвучки либо их отсутствие.');
    } else if (record.config.stage === 'E2') {
      issues.push(...adFreeIssues(record, records));
      if (record.checks.fullNoAds !== 'PASS') issues.push('E2 PASS относится только к полному сеансу без рекламы: нужна отдельная ручная отметка полного просмотра без рекламы. Успех smoke-пробы — отдельный результат наблюдений.');
    }
  }
  return [...new Set(issues)];
}

export function assessRecord(record, records = []) {
  let probeStatus = record.status;
  if (record.config.stage === 'E2') {
    const watchComplete = record.config.watchScope === 'full' ? record.checks.ended === 'PASS' && finished(record)
      : record.config.watchScope === 'smoke' && record.details.watchMinutes?.trim() !== '' && Number(record.details.watchMinutes) >= 30 && Number(record.details.watchMinutes) <= 1440 && finished(record);
    probeStatus = E2_CHECKS.some(key => record.checks[key] === 'FAIL') ? 'FAIL'
      : E2_CHECKS.every(key => record.checks[key] === 'NOT_RUN') && Object.keys(ADS).every(key => record.ads[key] === 'NOT_RUN') ? 'NOT_RUN'
      : E2_CHECKS.every(key => record.checks[key] === 'PASS') && decisiveAds(record) && watchComplete ? 'PASS' : 'INCONCLUSIVE';
    if (record.technical.blocked) probeStatus = 'INCONCLUSIVE';
  }
  const adObserved = Object.keys(ADS).some(key => record.ads[key] === 'OBSERVED') || Boolean(record.adBreaks?.length);
  const adFreeSessionStatus = adObserved || record.checks.fullNoAds === 'FAIL' ? 'FAIL'
    : record.checks.fullNoAds === 'PASS' && adFreeIssues(record, records).length === 0 ? 'PASS'
    : record.checks.fullNoAds === 'NOT_RUN' && Object.keys(ADS).every(key => record.ads[key] === 'NOT_RUN') ? 'NOT_RUN' : 'INCONCLUSIVE';
  return { statusMeaning: record.config.stage === 'E2' ? 'E2_FULL_SESSION_AD_FREE_AND_BASIC_CONTROL' : 'E1_AVAILABILITY_AND_START',
    probeStatus, adFreeSessionStatus, adFreeScope: 'SINGLE_SESSION_MANUAL_OBSERVATION', e1RecordId: record.config.e1RecordId || null,
    eligibilityIssues: e2PrerequisiteIssues(record, records), acceptanceIssues: resultIssues({ ...record, status: 'PASS' }, records) };
}

export function reconcileRecord(record, records = []) {
  const issues = resultIssues(record, records);
  if (record.checks.fullNoAds === 'PASS' && adFreeIssues(record, records).length) record.checks.fullNoAds = 'INCONCLUSIVE';
  if (record.status === 'PASS' && issues.length) record.status = 'INCONCLUSIVE';
  record.assessment = assessRecord(record, records);
  return issues;
}

function preparedRecords(records) {
  const copies = records.map(record => ({ ...record, config: { ...record.config, e1RecordId: record.config.e1RecordId || null }, checks: { ...record.checks }, details: { watchMinutes: '', ...record.details } }));
  // Revalidate E1 before its dependent E2, including journals saved before the audit fix.
  for (const stage of ['E1', 'E2']) for (const record of copies.filter(item => item.config.stage === stage)) reconcileRecord(record, copies);
  return copies;
}

export function exportJSON(records, now = new Date().toISOString(), runs = []) {
  return JSON.stringify(sanitize({ schemaVersion: VERSION, assessmentVersion: 2, specVersion:'1.2', build:BUILD, exportedAt: now,
    exportedAtMsk:new Date(Date.parse(now)+10800000).toISOString().replace('Z','+03:00'),
    notice:'Ручные подтверждения, native-события, каталог и iframe разделены. Выполненная диагностика не доказывает просмотр всех фильмов. L4/L5 автоматически не присваиваются. Исследование и облачные/физические опыты не объединяются.',
    records:preparedRecords(records).map(r=>({...r,testId:r.testId||r.id,attemptId:r.attemptId||r.id,evidenceLevel:evidenceLevel(r)})),runs }),null,2);
}

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportCSV(records, runs = []) {
  const columns = ['id','testId','attemptId','previousAttemptId','runId','buildCommit','createdAtMsk','refId','mode','upstream','canonicalId','year','season','episode','queueStatus','evidenceLevel','layers','steps','measurement','manualConfirmations','adBreaks','runProfile','runState','createdAt', 'updatedAt', 'endedAt', 'status', 'statusMeaning', 'probeStatus', 'adFreeSessionStatus', 'e1RecordId', 'eligibilityIssues', 'acceptanceIssues', 'config', 'environment', ...Object.keys(CHECKS).map(key => `check.${key}`), ...Object.keys(ADS).map(key => `ad.${key}`), 'tracking', ...Object.keys(DETAILS), 'technical', 'events', 'droppedEvents', 'rejectedMessages'];
  const json=v=>JSON.stringify(sanitize(v??null));
  const rows=preparedRecords(records).map(r=>{
    const run=runs.find(x=>x.runId===r.runId);
    return [r.id,r.testId||r.id,r.attemptId||r.id,r.previousAttemptId,r.runId,r.build?.commit,r.createdAtMsk,r.config.refId,r.config.mode,r.config.upstream,r.config.canonicalId,r.config.year,r.config.season,r.config.episode,r.queueStatus,evidenceLevel(r),json(r.layers),json(r.steps),json(r.measurement),json(r.manualConfirmations),json(r.adBreaks),json(run?.profile),run?.status,r.createdAt,r.updatedAt,r.endedAt,r.status,r.assessment.statusMeaning,r.assessment.probeStatus,r.assessment.adFreeSessionStatus,r.assessment.e1RecordId,json(r.assessment.eligibilityIssues),json(r.assessment.acceptanceIssues),json(r.config),json(r.environment),...Object.keys(CHECKS).map(k=>r.checks[k]),...Object.keys(ADS).map(k=>r.ads[k]),r.tracking,...Object.keys(DETAILS).map(k=>r.details[k]),json(r.technical),json(r.events),r.droppedEvents,r.rejectedMessages];
  });
  // Include pending/skipped queue entries even when they have no playback record.
  for(const run of runs)for(const item of run.queue)if(!records.some(r=>r.runId===run.runId&&r.testId===item.testId)){
    const values={id:item.testId,testId:item.testId,runId:run.runId,buildCommit:run.build?.commit,refId:item.refId,mode:item.config.mode,upstream:item.upstream,canonicalId:item.config.canonicalId,year:item.config.year,season:item.config.season,episode:item.config.episode,queueStatus:item.status,config:json(item.config),steps:json(item.attempts),technical:json(item.reason),runProfile:json(run.profile),runState:run.status,environment:json(run.environment)};
    rows.push(columns.map(k=>values[k]??''));
  }
  return '\uFEFF'+[columns,...rows].map(row=>row.map(v=>csvCell(sanitize(v))).join(',')).join('\r\n')+'\r\n';
}

export function loadJournal(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { records: [], runs:[], error: null, raw: null };
    const data = JSON.parse(raw);
    if (![1,VERSION].includes(data.schemaVersion) || !Array.isArray(data.records) || data.records.length > 5000) throw new Error('Неизвестный формат журнала');
    for (const r of data.records) {
      if (!isObject(r) || typeof r.id !== 'string' || typeof r.createdAt !== 'string' || !RESULTS.includes(r.status) || !isObject(r.config) || !isObject(r.environment) || !isObject(r.technical) || !isObject(r.details) || !isObject(r.checks) || !isObject(r.ads) || !Array.isArray(r.events) || r.events.length > 400 || !Number.isInteger(r.droppedEvents) || !Number.isInteger(r.rejectedMessages)) throw new Error('Повреждённая запись журнала');
      r.ads.postRoll ??= 'NOT_RUN';
      r.details.watchMinutes ??= ''; // Additive migration of the original schema-1 journal.
      if (r.config.e1RecordId != null && typeof r.config.e1RecordId !== 'string') throw new Error('Повреждённая ссылка E1');
      if (Object.keys(CHECKS).some(key => !RESULTS.includes(r.checks[key])) || Object.keys(ADS).some(key => !AD_RESULTS.includes(r.ads[key])) || !AD_RESULTS.includes(r.tracking) || Object.keys(DETAILS).some(key => typeof r.details[key] !== 'string' || r.details[key].length > 2000)) throw new Error('Повреждённые наблюдения журнала');
    }
    if (data.runs !== undefined && (!Array.isArray(data.runs) || data.runs.some(run => typeof run.runId !== 'string' || !Array.isArray(run.queue) || run.queue.length > 5000 || run.queue.some(item => typeof item.testId !== 'string' || !Array.isArray(item.attempts) || !isObject(item.config))))) throw new Error('Повреждённая очередь');
    return { records: preparedRecords(data.records), runs:data.runs || [], error: null, raw };
  } catch (error) {
    let raw = null;
    try { raw = storage.getItem(STORAGE_KEY); } catch { /* storage itself is unavailable */ }
    return { records: [], runs:[], error: `Журнал не прочитан: ${error.message}. Исходные данные не перезаписываются. Экспортируйте восстановительную копию.`, raw };
  }
}

export function saveJournal(storage, records, runs = []) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(sanitize({ schemaVersion: VERSION, records: preparedRecords(records), runs }))); return null; }
  catch { return 'Не удалось сохранить журнал на устройстве. Текущие данные остаются в памяти: экспортируйте JSON до закрытия страницы.'; }
}

export function mergeExports(existing, incoming) {
  if(!incoming || ![1,VERSION].includes(incoming.schemaVersion) || !Array.isArray(incoming.records)) throw new Error('Неизвестный формат импорта.');
  const checked=loadJournal({getItem:()=>JSON.stringify(incoming)});
  if(checked.error) throw new Error(checked.error);
  const records=new Map(existing.records.map(r=>[r.id,r]));
  for(const r of checked.records){const old=records.get(r.id);if(!old||Date.parse(r.updatedAt)>Date.parse(old.updatedAt))records.set(r.id,r);}
  const runs=new Map((existing.runs||[]).map(r=>[r.runId,r]));
  for(const r of checked.runs){const old=runs.get(r.runId);if(!old||Date.parse(r.updatedAt)>Date.parse(old.updatedAt))runs.set(r.runId,r);}
  return {records:[...records.values()],runs:[...runs.values()]};
}
