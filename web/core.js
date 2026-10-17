export const VERSION = 1;
export const STORAGE_KEY = 'kadr.videoLab.v1';
export const RESULTS = ['NOT_RUN', 'PASS', 'FAIL', 'INCONCLUSIVE'];
export const AD_RESULTS = ['NOT_RUN', 'OBSERVED', 'NOT_OBSERVED', 'INCONCLUSIVE'];
export const CHECKS = {
  pageOpened: 'Страница / данные источника открылись', exactTitle: 'Найдено точное полное произведение',
  videoStarted: 'Видео действительно запустилось', fiveMinutes: '5 минут воспроизведения',
  seek50: 'Seek к 50% и возобновление', pause: 'Пауза сработала', ended: 'Достигнут конец основного видео',
  fullNoAds: 'Полный просмотр без рекламы', eventsReceived: 'Получены допустимые события',
};
export const ADS = { preRoll: 'Pre-roll', midRoll: 'Mid-roll', overlay: 'Overlay / баннер', popup: 'Pop-up / новое окно', navigation: 'Изменение навигации' };
export const DETAILS = { voice: 'Язык и студия озвучки', subtitles: 'Язык и вид субтитров', observedQuality: 'Фактическое качество', startSeconds: 'Старт, секунд', seekRecoverySeconds: 'Возобновление после seek, секунд', watchMinutes: 'Фактически наблюдали, минут (E2 smoke ≥30)', payment: 'Оплата / ключ / сервер / другое приложение', mediaHost: 'Конечный медиахост (если наблюдаем)', trackingEvidence: 'Наблюдение трекинга: домены и метод', controlNotes: 'Управление, PiP, обрыв, таймер, смена серии', notes: 'Наблюдения / ошибки / точная версия произведения' };

export function makeRecord(config, environment, now = new Date().toISOString(), id = crypto.randomUUID()) {
  return { id, createdAt: now, updatedAt: now, endedAt: null, status: 'NOT_RUN',
    config: { ...config, e1RecordId: config.e1RecordId || null }, environment: { ...environment },
    checks: Object.fromEntries(Object.keys(CHECKS).map(key => [key, 'NOT_RUN'])),
    ads: Object.fromEntries(Object.keys(ADS).map(key => [key, 'NOT_RUN'])), tracking: 'NOT_RUN',
    details: Object.fromEntries(Object.keys(DETAILS).map(key => [key, ''])),
    events: [], droppedEvents: 0, rejectedMessages: 0, technical: {},
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
const decisiveAds = record => Object.keys(ADS).every(key => ['OBSERVED', 'NOT_OBSERVED'].includes(record.ads[key]));
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
  if (Object.keys(ADS).some(key => record.ads[key] !== 'NOT_OBSERVED')) issues.push('Для вывода без рекламы нужны все пять рекламных категорий «не наблюдалось»; пустые и неопределённые отметки не подходят.');
  if (record.technical.blocked) issues.push('Контракт источника не подтверждён.');
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
  const adObserved = Object.keys(ADS).some(key => record.ads[key] === 'OBSERVED');
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

export function exportJSON(records, now = new Date().toISOString()) {
  return JSON.stringify({ schemaVersion: VERSION, assessmentVersion: 2, exportedAt: now, notice: 'Ручные результаты и технические события разделены. probeStatus — завершённость пробы наблюдений, не отсутствие рекламы. E2 PASS — полный сеанс без рекламы и базовый контроль с основанием E1; adFreeSessionStatus относится только к одному ручному сеансу, не поставщику в целом. Для вывода по выборке нужны фильм, эпизод и повтор в новой сессии. Пользовательские отметки не доказывают реальный просмотр.', records: preparedRecords(records) }, null, 2);
}

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportCSV(records) {
  const columns = ['id', 'createdAt', 'updatedAt', 'endedAt', 'status', 'statusMeaning', 'probeStatus', 'adFreeSessionStatus', 'e1RecordId', 'eligibilityIssues', 'acceptanceIssues', 'config', 'environment', ...Object.keys(CHECKS).map(key => `check.${key}`), ...Object.keys(ADS).map(key => `ad.${key}`), 'tracking', ...Object.keys(DETAILS), 'technical', 'events', 'droppedEvents', 'rejectedMessages'];
  const rows = preparedRecords(records).map(record => [record.id, record.createdAt, record.updatedAt, record.endedAt, record.status, record.assessment.statusMeaning, record.assessment.probeStatus, record.assessment.adFreeSessionStatus, record.assessment.e1RecordId, JSON.stringify(record.assessment.eligibilityIssues), JSON.stringify(record.assessment.acceptanceIssues), JSON.stringify(record.config), JSON.stringify(record.environment), ...Object.keys(CHECKS).map(key => record.checks[key]), ...Object.keys(ADS).map(key => record.ads[key]), record.tracking, ...Object.keys(DETAILS).map(key => record.details[key]), JSON.stringify(record.technical), JSON.stringify(record.events), record.droppedEvents, record.rejectedMessages]);
  return '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function loadJournal(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { records: [], error: null, raw: null };
    const data = JSON.parse(raw);
    if (data.schemaVersion !== VERSION || !Array.isArray(data.records) || data.records.length > 240) throw new Error('Неизвестный формат журнала');
    for (const r of data.records) {
      if (!isObject(r) || typeof r.id !== 'string' || typeof r.createdAt !== 'string' || !RESULTS.includes(r.status) || !isObject(r.config) || !isObject(r.environment) || !isObject(r.technical) || !isObject(r.details) || !isObject(r.checks) || !isObject(r.ads) || !Array.isArray(r.events) || r.events.length > 400 || !Number.isInteger(r.droppedEvents) || !Number.isInteger(r.rejectedMessages)) throw new Error('Повреждённая запись журнала');
      r.details.watchMinutes ??= ''; // Additive migration of the original schema-1 journal.
      if (r.config.e1RecordId != null && typeof r.config.e1RecordId !== 'string') throw new Error('Повреждённая ссылка E1');
      if (Object.keys(CHECKS).some(key => !RESULTS.includes(r.checks[key])) || Object.keys(ADS).some(key => !AD_RESULTS.includes(r.ads[key])) || !AD_RESULTS.includes(r.tracking) || Object.keys(DETAILS).some(key => typeof r.details[key] !== 'string' || r.details[key].length > 2000)) throw new Error('Повреждённые наблюдения журнала');
    }
    return { records: preparedRecords(data.records), error: null, raw };
  } catch (error) {
    let raw = null;
    try { raw = storage.getItem(STORAGE_KEY); } catch { /* storage itself is unavailable */ }
    return { records: [], error: `Журнал не прочитан: ${error.message}. Исходные данные не перезаписываются. Экспортируйте восстановительную копию.`, raw };
  }
}

export function saveJournal(storage, records) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: VERSION, records: preparedRecords(records) })); return null; }
  catch { return 'Не удалось сохранить журнал на устройстве. Текущие данные остаются в памяти: экспортируйте JSON до закрытия страницы.'; }
}
