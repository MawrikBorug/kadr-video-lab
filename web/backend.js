import {LabError} from './providers.js';
// Password stays in this page's memory, never journal, sessionStorage or exports.
export async function privateSearch(config,{endpoint,accessToken,signal,fetcher=fetch}){
 if(!endpoint||!accessToken)throw new LabError('auth-required','Серверный контур / лабораторный доступ не подключён.');
 const r=await fetcher(endpoint,{method:'POST',cache:'no-store',credentials:'omit',signal,headers:{'content-type':'application/json',authorization:'Bearer '+accessToken},body:JSON.stringify({provider:'kodik',operation:'search',title:config.title,season:Number(config.season)||1,episode:Number(config.episode)||1})});
 if(!r.ok){
  const error=await r.json().catch(()=>({}));
  const missing=['own-credential-missing','adapter-not-configured','issued-contract-required','private-lab-access-required'].includes(error.code);
  throw new LabError(missing||r.status===401||r.status===403?'auth-required':r.status===429?'rate-limited':'server-blocker',`Закрытый адаптер: HTTP ${r.status}.`,{httpStatus:r.status,retryAfter:Number(error.retryAfter)||null});
 }
 const body=await r.json();if(!Array.isArray(body.choices))throw new LabError('invalid-response','Сервер не вернул разрешённые варианты iframe.');
 return body;
}
