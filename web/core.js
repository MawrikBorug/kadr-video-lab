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
export const DETAILS = { voice: 'Язык и студия озвучки', subtitles: 'Язык и вид субтитров', observedQuality: 'Фактическое качество', startSeconds: 'Старт, секунд', seekRecoverySeconds: 'Возобновление после seek, секунд', payment: 'Оплата / ключ / сервер / другое приложение', mediaHost: 'Конечный медиахост (если наблюдаем)', trackingEvidence: 'Наблюдение трекинга: домены и метод', controlNotes: 'Управление, PiP, обрыв, таймер, смена серии', notes: 'Наблюдения / ошибки / точная версия произведения' };

export function makeRecord(config, environment, now = new Date().toISOString(), id = crypto.randomUUID()) {
  return { id, createdAt: now, updatedAt: now, endedAt: null, status: 'NOT_RUN',
    config: { ...config }, environment: { ...environment },
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

export function resultIssues(record) {
  const issues = [];
  if (record.checks.fullNoAds === 'PASS' && (record.config.watchScope !== 'full' || record.checks.ended !== 'PASS' || Object.values(record.ads).some(value => value !== 'NOT_OBSERVED'))) issues.push('Полный просмотр без рекламы требует режима полного просмотра, конца основного видео и отметок «не наблюдалось» для всех пяти видов рекламы.');
  if (record.status === 'PASS') {
    if (record.technical.blocked) issues.push('Неподтверждённый контракт не позволяет поставить PASS этой попытке.');
    if (!record.environment.device || record.environment.device === 'unknown') issues.push('Для PASS укажите реальное устройство и браузер.');
    if (record.environment.country !== 'RU' || !['home', 'mobile'].includes(record.environment.network)) issues.push('Для PASS E1/E2 укажите реальную сеть РФ.');
    const required = record.config.stage === 'E1' ? ['pageOpened', 'exactTitle', 'videoStarted', 'fiveMinutes', 'seek50'] : ['pageOpened', 'exactTitle', 'videoStarted', 'pause'];
    if (required.some(key => record.checks[key] !== 'PASS')) issues.push('PASS противоречит незавершённым обязательным наблюдениям этапа.');
    if (record.config.stage === 'E1') {
      if (record.details.startSeconds.trim() === '' || !Number.isFinite(Number(record.details.startSeconds)) || Number(record.details.startSeconds) < 0 || Number(record.details.startSeconds) > 30) issues.push('E1: фактический старт должен быть измерен и не превышать 30 секунд.');
      if (record.details.seekRecoverySeconds.trim() === '' || !Number.isFinite(Number(record.details.seekRecoverySeconds)) || Number(record.details.seekRecoverySeconds) < 0 || Number(record.details.seekRecoverySeconds) > 10) issues.push('E1: возобновление после seek должно быть измерено и не превышать 10 секунд.');
      if (!record.details.voice.trim()) issues.push('E1: зафиксируйте фактический язык и студию озвучки либо их отсутствие.');
    }
  }
  return issues;
}

export function exportJSON(records, now = new Date().toISOString()) {
  return JSON.stringify({ schemaVersion: VERSION, exportedAt: now, notice: 'Ручные результаты и технические события разделены. NOT_RUN не означает FAIL. Автопроверка не подтверждает iPhone, РФ и отсутствие рекламы.', records }, null, 2);
}

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportCSV(records) {
  const columns = ['id', 'createdAt', 'updatedAt', 'endedAt', 'status', 'config', 'environment', ...Object.keys(CHECKS).map(key => `check.${key}`), ...Object.keys(ADS).map(key => `ad.${key}`), 'tracking', ...Object.keys(DETAILS), 'technical', 'events', 'droppedEvents', 'rejectedMessages'];
  const rows = records.map(record => [record.id, record.createdAt, record.updatedAt, record.endedAt, record.status, JSON.stringify(record.config), JSON.stringify(record.environment), ...Object.keys(CHECKS).map(key => record.checks[key]), ...Object.keys(ADS).map(key => record.ads[key]), record.tracking, ...Object.keys(DETAILS).map(key => record.details[key]), JSON.stringify(record.technical), JSON.stringify(record.events), record.droppedEvents, record.rejectedMessages]);
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
      if (Object.keys(CHECKS).some(key => !RESULTS.includes(r.checks[key])) || Object.keys(ADS).some(key => !AD_RESULTS.includes(r.ads[key])) || !AD_RESULTS.includes(r.tracking) || Object.keys(DETAILS).some(key => typeof r.details[key] !== 'string' || r.details[key].length > 2000)) throw new Error('Повреждённые наблюдения журнала');
    }
    return { records: data.records, error: null, raw };
  } catch (error) {
    let raw = null;
    try { raw = storage.getItem(STORAGE_KEY); } catch { /* storage itself is unavailable */ }
    return { records: [], error: `Журнал не прочитан: ${error.message}. Исходные данные не перезаписываются. Экспортируйте восстановительную копию.`, raw };
  }
}

export function saveJournal(storage, records) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: VERSION, records })); return null; }
  catch { return 'Не удалось сохранить журнал на устройстве. Текущие данные остаются в памяти: экспортируйте JSON до закрытия страницы.'; }
}
