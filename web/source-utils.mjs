export class SourceError extends Error {
  constructor(code,details={}) {super(code);this.name='SourceError';this.code=code;this.details=details;}
}
export const now = () => new Date().toISOString();
export function safeText(value,max=800) {
  return String(value ?? '').replace(/(?:https?:)?\/\/[^\s<>"']+/gi,'[URL скрыт]')
    .replace(/(?:Bearer\s+|(?:token|signature|authorization|cookie|api[_-]?key|password|secret)\s*[:=]\s*)[^\s,;]+/gi,'[скрыто]').slice(0,max);
}
export function safeOrigin(value) {try {return new URL(value).origin;}catch{return 'unknown';}}
export const failure = e => ({code:e?.code || (e?.name==='AbortError'?'CANCELLED':'NETWORK_OR_CORS'),...(e?.details || {})});
export function linkedSignal(signal,ms) {
  const controller=new AbortController();let timedOut=false;
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},ms);
  return {signal:controller.signal,get timedOut(){return timedOut;},close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
}
export async function boundedBody(response,max,onBytes=()=>{}) {
  if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw new SourceError('SIZE_LIMIT');}
  if(!response.body)throw new SourceError('EMPTY_BODY');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try {
    for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;onBytes(value.byteLength);
      if(length>max)throw new SourceError('SIZE_LIMIT');chunks.push(value);}
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function requestBytes(url,{signal,ms=15000,max,onBytes,headers={},range=false}={}) {
  const scope=linkedSignal(signal,ms);
  try {
    const response=await fetch(url,{signal:scope.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers});
    if(response.status===429){await response.body?.cancel();throw new SourceError('RATE_LIMIT',{httpStatus:429,retryAfter:retryAfter(response.headers.get('retry-after'))});}
    if(!response.ok){await response.body?.cancel();throw new SourceError('HTTP_ERROR',{httpStatus:response.status});}
    if(range && response.status!==206){await response.body?.cancel();throw new SourceError('RANGE_NOT_206',{httpStatus:response.status});}
    const bytes=await boundedBody(response,max,onBytes);return {bytes,response};
  } catch(e) {
    if(scope.timedOut)throw new SourceError('TIMEOUT');
    if(signal?.aborted)throw new SourceError('CANCELLED');
    if(e instanceof SourceError)throw e;
    throw new SourceError('NETWORK_OR_CORS'); // JS cannot distinguish CORS from a network/proxy refusal.
  } finally {scope.close();}
}
export function retryAfter(value) {
  if(!value)return null;const sec=Number(value);return Number.isFinite(sec)?Math.max(0,sec):Math.max(0,Math.ceil((Date.parse(value)-Date.now())/1000)) || null;
}
