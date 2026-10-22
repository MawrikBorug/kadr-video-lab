// Export-only access to old local data. No provider or queue code is loaded.
const secretKey = /authorization|cookie|password|secret|token|signature|credential|api.?key|session.?hash/i;
export function redactLegacy(value, depth = 0) {
  if (depth > 40) return '[слишком глубокое поле]';
  if (typeof value === 'string') return value.replace(/(?:https?:)?\/\/[^\s<>"'\\]+/gi, '[URL скрыт]')
    .replace(/\b(?:Bearer\s+|(?:token|secret|password|signature|authorization|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '[скрыто]');
  if (Array.isArray(value)) return value.map(v => redactLegacy(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !['__proto__', 'constructor', 'prototype'].includes(k))
    .map(([k, v]) => [k, secretKey.test(k) ? '[скрыто]' : redactLegacy(v, depth + 1)]));
  return value;
}
