// Apply at every persistence/export boundary, including manual notes and nested URLs.
const sensitive = /^(?:authorization|proxy-authorization|cookie|set-cookie|headers|requestHeaders|responseHeaders|password|passwd|secret|.*[_-](?:token|secret|password|cookie|signature|credential)|token|accessToken|refreshToken|apiKey|api_key|bearer|sessionHash|session_hash|hash|signature|credentials)$/i;
const publicQuery = new Set(['tmdb','imdb','id','type','season','episode','ordinal','quality','search','query','limit','take','skip','item','playerId','translationId']);

export function safeURL(raw) {
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol)) return '[URL скрыт]';
    if (u.username || u.password || [...u.searchParams.keys()].some(k => !publicQuery.has(k)) || [...u.searchParams.values()].some(v => /https?:|token|secret|bearer|eyJ/i.test(v))) return `${u.origin}/[URL скрыт]`;
    if (/\.(?:m3u8|mp4|mpd|ts|aac)(?:$|\/)|[A-Za-z0-9_-]{50,}/i.test(u.pathname)) return `${u.origin}/[медиассылка скрыта]`;
    u.hash = '';
    // Session material can also live in URL paths. Exports only need origin and IDs.
    return u.origin + (u.search || '');
  } catch { return '[URL скрыт]'; }
}

export function sanitize(value, key = '') {
  if (sensitive.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(v => sanitize(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !['__proto__','constructor','prototype'].includes(k)).map(([k,v]) => [k, sanitize(v,k)]));
  if (typeof value !== 'string') return value;
  return value.replace(/https?:\/\/[^\s<>"'\\]+/gi, safeURL)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:token|api[_-]?key|secret|password|cookie|authorization|session[_-]?hash)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}
