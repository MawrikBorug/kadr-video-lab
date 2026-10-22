import {CONFIG} from './config.js';
import {safeDiagnostic} from './collector.mjs';

export class LiftError extends Error {
  constructor(code, details = {}) { super(code); this.code = code; this.details = details; }
}

export function extractEmbed(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== CONFIG.materialId
      || data.origin_name !== 'Sintel' || Number(data.year) !== 2010) throw new LiftError('identity_mismatch');
  const raw = data.iframe_uri;
  if (typeof raw !== 'string' || raw.length > 8192) throw new LiftError('embed_missing');
  let url;
  try { url = new URL(raw); } catch { throw new LiftError('embed_invalid'); }
  if (url.protocol !== 'https:' || url.origin !== CONFIG.expectedOrigin || url.pathname !== CONFIG.expectedPath
      || url.username || url.password || url.hash) throw new LiftError('embed_origin_or_path');
  return raw; // Preserve the native host, path, signature, region and ad parameters.
}

export async function getFreshEmbed(signal) {
  let response;
  try {
    response = await fetch(CONFIG.endpoint, {mode: 'cors', cache: 'no-store', credentials: 'omit', redirect: 'error', signal});
  } catch {
    throw new LiftError(signal?.aborted ? 'api_timeout_or_cancel' : 'api_network_or_cors');
  }
  if (Number(response.headers.get('content-length')) > 131072) throw new LiftError('api_too_large');
  let text;
  try { text = await response.text(); }
  catch { throw new LiftError(signal?.aborted ? 'api_timeout_or_cancel' : 'api_network_or_cors'); }
  if (text.length > 131072) throw new LiftError('api_too_large');
  let data;
  try { data = JSON.parse(text); } catch { throw new LiftError('api_non_json', {httpStatus: response.status}); }
  const reason = safeDiagnostic(typeof data?.error === 'string' ? data.error : data?.message);
  if (!response.ok) throw new LiftError('api_http_error', {httpStatus: response.status, reason});
  if (data?.error) throw new LiftError('api_provider_error', {httpStatus: response.status, reason});
  return {embedUrl: extractEmbed(data), httpStatus: response.status};
}
