// Adapted from research/followup/lift/collector.mjs. No raw payload is retained.
export const MAX_DURATION = 86400;
export const EVENTS = new Set(['startWatching', 'viewProgress', 'playerReady', 'endedSoon', 'ended', 'adStart', 'adStop', 'click overlay']);

export function accept(e, frame, origin) {
  return !!frame && origin === 'https://embed.liftw.ws' && e.source === frame && e.origin === origin;
}

export function progress(data) {
  return data?.event === 'viewProgress' && typeof data.time === 'number' && typeof data.duration === 'number'
    && Number.isFinite(data.time) && Number.isFinite(data.duration) && data.duration > 0
    && data.duration <= MAX_DURATION && data.time >= 0 && data.time <= data.duration + 2
    ? {time: data.time, duration: data.duration} : null;
}

export function sanitize(data) {
  if (data === 'pong') return {event: 'pong'};
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.hasOwn(data, 'event') || !EVENTS.has(data.event)) return null;
  // Fixed fields only: no id/key/free text, nested objects, URLs or signatures.
  const identity = {};
  for (const key of ['id', 'season', 'episode']) {
    if (Number.isSafeInteger(data[key]) && data[key] > 0 && data[key] < 1e9) identity[key] = data[key];
  }
  if (data.event === 'viewProgress') {
    const p = progress(data);
    return p ? {event: data.event, ...p, ...identity} : null;
  }
  return {event: data.event, ...identity};
}

export function rejectionReason(data) {
  if (data?.event === 'viewProgress') return 'invalid_progress_numbers';
  if (typeof data === 'string') return 'unsupported_string';
  return data && typeof data === 'object' && !Array.isArray(data) ? 'unknown_event' : 'invalid_structure';
}

export function savedPosition(value) {
  if (!value || !progress({event: 'viewProgress', time: value.time, duration: value.duration})) return null;
  if (!Number.isFinite(Date.parse(value.utc))) return null;
  return {time: value.time, duration: value.duration, utc: value.utc,
    materialId: Number.isSafeInteger(value.materialId) || ['sintel-public','kadr-control'].includes(value.materialId) ? value.materialId : 3637,
    runId: typeof value.runId === 'string' && /^[a-f0-9-]{36}$/.test(value.runId) ? value.runId : null};
}

// Error diagnostics may include a provider's reason, never a response body or URL.
export function safeDiagnostic(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 1000).replace(/(?:https?:)?\/\/[^\s<>"']+/gi, '[URL скрыт]')
    .replace(/(?:token|signature|secret|password|authorization|bearer|cookie)\s*[:= ]\s*[^\s,;]+/gi, '[скрыто]')
    .replace(/[A-Za-z0-9_+=\/-]{32,}/g, '[скрыто]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[IP скрыт]').replace(/<[^>]*>/g, '').slice(0, 300);
}
