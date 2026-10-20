import {LabError,SANDBOX} from './providers.js';
export const PLAYER_ORIGIN='https://tv-1-kinoserial.net';
// Cabinet screenshot explicitly supplies /embed/%id%/?token=%token%.
// %id% is the provider's ID; a KP/TMDB ID must never be substituted here.
export function videoseedFrame({id,namespace,sandbox='strict',unrestrictedConsent,cleanSessionConsent,diagnosticConsentVersion,season,episode,type},playerToken){
 if(namespace!=='videoseed'||!/^\d{1,10}$/.test(String(id)))throw new LabError('no-address','Нужен ID Videoseed из кабинета или подтверждённого ответа API. Это не ID Кинопоиска.');
 if(!/^[a-f0-9]{32}$/i.test(playerToken||''))throw new LabError('auth-required','Введите отдельный ключ API плеера. Ключ базы здесь не используется.');
 if(!(sandbox in SANDBOX)||sandbox==='documented'&&!unrestrictedConsent)throw new LabError('needs-action','Для запуска без sandbox требуется явное подтверждение диагностики.');
 if(sandbox==='documented'&&diagnosticConsentVersion!==2&&!cleanSessionConsent)throw new LabError('needs-action','Для диагностики без sandbox подтвердите отдельную попытку.');
 const u=new URL('/embed/'+id+'/',PLAYER_ORIGIN);u.searchParams.set('token',playerToken);
 // S/E are confirmed in the official player until the cabinet contract is read.
 return {kind:'iframe',url:u.href,origin:u.origin,sandbox:SANDBOX[sandbox],mode:'embed',episodeSelection:type==='tv'?{season,episode,source:'manual-in-player'}:null};
}
export async function videoseedSearch(config,{endpoint,accessToken,signal,fetcher=fetch}){
 if(!endpoint||!accessToken)throw new LabError('auth-required','Поиск требует размещённого закрытого адаптера. Ключ базы не вводится на GitHub Pages.');
 const payload={provider:'videoseed',operation:'search',title:config.searchTitle||config.title,type:config.type,year:config.year||null,season:Number(config.season)||1,episode:Number(config.episode)||1};
 if(config.id&&config.namespace!=='videoseed'){payload.id=config.id;payload.namespace=config.namespace;}
 const r=await fetcher(endpoint,{method:'POST',cache:'no-store',credentials:'omit',signal,headers:{'content-type':'application/json',authorization:'Bearer '+accessToken},body:JSON.stringify(payload)});
 const body=await r.json().catch(()=>({}));
 if(!r.ok)throw new LabError([401,403,409,503].includes(r.status)?'auth-required':r.status===429?'rate-limited':'server-blocker',`Videoseed: ${body.code||'server-error'} (HTTP ${r.status}).`,{httpStatus:r.status,retryAfter:Number(body.retryAfter)||null});
 if(!Array.isArray(body.results)||body.results.length>50)throw new LabError('invalid-response','Сервер не подтвердил структуру результатов Videoseed.');
 return body;
}
