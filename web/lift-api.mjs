import {CONFIG} from './config.js';
import {safeDiagnostic} from './collector.mjs';

export class LiftError extends Error {
  constructor(code, details = {}) { super(code); this.code = code; this.details = details; }
}

const original = {id:3637, original:'Sintel', year:2010, nativeType:2};
export function extractEmbed(data, material = original) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== material.id
      || data.origin_name !== material.original || Number(data.year) !== material.year
      || (!material.original && data.name !== material.providerTitle)
      || (data.type !== undefined && data.type !== material.nativeType)) throw new LiftError('identity_mismatch');
  const raw = data.iframe_uri;
  if (typeof raw !== 'string' || raw.length > 8192) throw new LiftError('embed_missing');
  let url;
  try { url = new URL(raw); } catch { throw new LiftError('embed_invalid'); }
  if (url.protocol !== 'https:' || url.origin !== CONFIG.expectedOrigin || url.pathname !== `/embed/movie/${material.id}`
      || url.username || url.password || url.hash) throw new LiftError('embed_origin_or_path');
  return raw; // Preserve the native host, path, signature, region and ad parameters.
}

export async function getFreshEmbed(signal, material = original) {
  let response;
  try {
    response = await fetch(CONFIG.apiBase + material.id, {mode: 'cors', cache: 'no-store', credentials: 'omit', redirect: 'error', signal});
  } catch {
    throw new LiftError(signal?.aborted ? 'api_timeout_or_cancel' : 'api_network_or_cors');
  }
  const maxBytes=2*1024*1024; // Series include a much larger cast/metadata object than Sintel.
  if (Number(response.headers.get('content-length')) > maxBytes) {await response.body?.cancel().catch(()=>{});throw new LiftError('api_too_large');}
  let text;
  try {
    const reader=response.body?.getReader();
    if(reader){
      const decoder=new TextDecoder();text='';let size=0;
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>maxBytes){await reader.cancel();throw new LiftError('api_too_large');}text+=decoder.decode(value,{stream:true});}
      text+=decoder.decode();
    }else text=await response.text();
  } catch(error) { if(error instanceof LiftError)throw error;throw new LiftError(signal?.aborted ? 'api_timeout_or_cancel' : 'api_network_or_cors'); }
  if (text.length > maxBytes) throw new LiftError('api_too_large');
  let data;
  try { data = JSON.parse(text); } catch { throw new LiftError('api_non_json', {httpStatus: response.status}); }
  const reason = safeDiagnostic(typeof data?.error === 'string' ? data.error : data?.message);
  if (!response.ok) throw new LiftError('api_http_error', {httpStatus: response.status, reason});
  if (data?.error) throw new LiftError('api_provider_error', {httpStatus: response.status, reason});
  return {embedUrl: extractEmbed(data, material), httpStatus: response.status,
    catalog: {id: data.id, title: material.title || 'Sintel', year: material.year, nativeType: material.nativeType,
      found: true, iframeReceived: true, checkedAt: new Date().toISOString(),
      catalogQuality: ['SD','HD','FHD','4K','UHD'].includes(data.quality) ? data.quality : 'unknown',
      videoStarted: false}};
}
