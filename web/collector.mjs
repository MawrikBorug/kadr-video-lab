// Adapted from research/followup/lift/collector.mjs. No raw payload is retained.
export const MAX_DURATION = 86400;
export const EVENTS = new Set(['startWatching', 'viewProgress', 'playerReady', 'endedSoon', 'ended', 'adStart', 'adStop', 'click overlay', 'changeEpisode', 'lastEpisode']);

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
  if (data === 'playlist hooked') return {event:'playlist hooked'};
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.hasOwn(data, 'event') || !EVENTS.has(data.event)) return null;
  // Fixed fields only: no id/key/free text, nested objects, URLs or signatures.
  const identity = {};
  for (const key of ['id', 'season', 'episode']) {
    const value=['lastEpisode','changeEpisode'].includes(data.event) && typeof data[key]==='string' && /^\d{1,5}$/.test(data[key])?Number(data[key]):data[key];
    if (Number.isSafeInteger(value) && value >= (key==='id'?1:0) && value < 1e9) identity[key] = value;
  }
  if (['changeEpisode','lastEpisode'].includes(data.event) && (identity.season===undefined || identity.episode===undefined)) return null;
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
    materialId: Number.isSafeInteger(value.materialId) || (typeof value.materialId==='string' && /^[a-z][a-z0-9-]{0,64}$/.test(value.materialId)) ? value.materialId : 3637,
    runId: typeof value.runId === 'string' && /^[a-f0-9-]{36}$/.test(value.runId) ? value.runId : null};
}

// Error diagnostics may include a provider's reason, never a response body or URL.
export function safeDiagnostic(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 1000).replace(/(?:https?:)?\/\/[^\s<>"']+/gi, '[URL скрыт]')
    .replace(/(?:token|signature|secret|password|authorization|bearer|cookie)\s*[:= ]\s*[^\s,;]+/gi, '[скрыто]')
    .replace(/[A-Za-z0-9_+=\/-]{32,}/g, '[скрыто]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[IP скрыт]').replace(/<[^>]*>/g, '').slice(0, 300);
}
