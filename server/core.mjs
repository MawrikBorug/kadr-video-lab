import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';

export class Failure extends Error {
  constructor(code, message, status=422, details={}) { super(message); Object.assign(this,{code,status,details}); }
}
export const demand=(condition,code,message,status=422)=>{if(!condition)throw new Failure(code,message,status);};
export const cut=(text,n)=>String(text||'').slice(0,n);
export const stamp=()=>new Date().toISOString();
export function sign(value,secret){
  demand(secret,'SERVER_NOT_CONFIGURED','Серверный секрет ещё не настроен.',503);
  const body=Buffer.from(JSON.stringify(value)).toString('base64url');
  return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
}
export function unseal(token,secret){
  demand(typeof token==='string'&&token.length<20000,'INVALID_PROOF','Подтверждение устарело. Выберите карточку заново.',403);
  const [body,mac]=token.split('.');const expected=createHmac('sha256',secret).update(body||'').digest('base64url');
  demand(mac?.length===expected.length&&timingSafeEqual(Buffer.from(mac),Buffer.from(expected)),'INVALID_PROOF','Недействительное подтверждение.',403);
  let value;try{value=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw new Failure('INVALID_PROOF','Повторите выбор карточки.',403);}
  demand(value.exp>Date.now(),'PROOF_EXPIRED','Подтверждение истекло. Подтвердите просмотр заново.',403);return value;
}
export const newId=()=>randomUUID();
export async function jsonFetch(url,{signal,headers={},timeout=18000,method='GET',body}={}){
  const response=await fetch(url,{method,body,headers,signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeout)]),redirect:'error'});
  if(!response.ok)throw new Failure('UPSTREAM_HTTP',`Источник временно недоступен (HTTP ${response.status}).`,502,{status:response.status});
  const text=await response.text();demand(text.length<=2500000,'SOURCE_TOO_LARGE','Источник превысил допустимый объём.');
  try{return JSON.parse(text);}catch{throw new Failure('SOURCE_FORMAT','Источник вернул неожиданный формат.',502);}
}

export const SECTIONS=['Краткое резюме','Сюжет и финал','Смысл','Детали и отсылки','Создание','Персонажи','Визуальный язык','Теории','Источники'];
export function sectionCoverage(text){
  const lines=text.split('\n').map(x=>x.replace(/[*#]/g,'').trim());let last=-1;
  return SECTIONS.every((name,i)=>{const heading=`${i+1}. ${name}`;const index=lines.findIndex((line,n)=>n>last&&(line===heading||line===`${i+1}) ${name}`));if(index<0)return false;last=index;return true;});
}
