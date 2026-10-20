import {LabError,excludedBranch} from './providers.js';
const fail=(code,message)=>{throw new LabError(code,message);};
export function applicationError(b){
 const n=Number(typeof b?.error==='object'?b.error.code:b?.error||b?.statusCode);
 if([401,403].includes(n))return new LabError('auth-required',`API сообщил отказ ${n} внутри HTTP 200.`,{httpStatus:200,appStatus:n});
 if(b?.ok===false||b?.status==='error'||b?.error&&b.error!==0)return new LabError('app-error','Ошибка приложения внутри ответа API.',{appStatus:n||null});
 return null;
}
export async function fetchJSON(url,{signal,fetcher=fetch,timeoutMs=20000}={}){
 const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 let r;try{r=await fetcher(url,{signal:combined,credentials:'omit',cache:'no-store',referrerPolicy:'strict-origin-when-cross-origin'});}catch{
  if(signal?.aborted)throw new LabError('interrupted','Опыт прерван.');
  if(timeout.aborted)throw new LabError('timeout','Запрос не завершился за отведённое время.');
  throw new LabError('network-or-cors','Сетевая ошибка или CORS: браузер не дал прочитать ответ.');
 }
 const retry=r.headers.get('retry-after'),retryAfter=retry?(Number.isFinite(Number(retry))?Number(retry):Math.max(0,(Date.parse(retry)-Date.now())/1000)):null;
 if(!r.ok)throw new LabError([401,403].includes(r.status)?'auth-required':r.status===429?'rate-limited':'http-error',`API ответил HTTP ${r.status}. Ограничение не обходится.`,{httpStatus:r.status,retryAfter});
 if(!r.headers.get('content-type')?.includes('json'))fail('invalid-response','API вернул не JSON.');
 let data;try{
  const reader=r.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();fail('oversize','Ответ превышает 2 МиБ.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}data=JSON.parse(new TextDecoder().decode(bytes));
 }catch(e){if(e instanceof LabError)throw e;if(combined.aborted)throw new LabError(signal?.aborted?'interrupted':'timeout','Чтение ответа прервано.');fail('invalid-response','Некорректный JSON.');}
 const err=applicationError(data);if(err)throw err;
 return {data,http:{status:r.status,mime:r.headers.get('content-type'),origin:new URL(url).origin,retryAfter}};
}
export function parseCatalog(provider,d,c){
 const err=applicationError(d);if(err)throw err;if(!d||typeof d!=='object')fail('invalid-response','Неверная структура ответа.');
 if(provider==='archive'){
  if(!d.metadata||d.metadata.identifier!=='Sintel')fail('invalid-response','Archive: не подтверждён metadata identifier Sintel.');
  return {title:d.metadata.title,year:d.metadata.year||d.metadata.date,identity:'matched',identifier:d.metadata.identifier,license:d.metadata.licenseurl||'unknown',fileCount:Array.isArray(d.files)?d.files.length:0,limit:'Метаданные полнометражного Sintel, отдельный объект. Не трейлер Blender и не N14-сеанс; файлы автоматически не запускаются.'};
 }
 if(provider==='aniliberty'){
  if(!Array.isArray(d.episodes)||typeof d.name?.main!=='string')fail('invalid-response','Неверная структура релиза.');
  const e=d.episodes.find(e=>Number(e.ordinal)===Number(c.episode));if(!e)fail('empty-result','Выбранный ordinal отсутствует.');
  return {title:d.name.main,year:d.year,identity:String(d.id)===c.id||d.alias===c.id?'matched':'needs-confirmation',episode:Number(e.ordinal),duration:Number(e.duration)||null,variants:['480','720','1080'].map(q=>({quality:q,hasFreshHLS:Boolean(e[`hls_${q}`])})),limit:'HLS-поле не медиадоставка; год и звук проверяются отдельно.'};
 }
 if(provider==='mikai'){
  const r=d.result;if(d.ok!==true||!r?.anime||!Array.isArray(r.releases))fail('invalid-response','Mikai: ожидается ok/result.anime/releases.');
  const id=r.anime.ids?.mal??r.anime.ids?.myanimelist,variants=[];
  const episodeFound=r.releases.some(release=>(release.episodes||[]).some(ep=>Number(ep.number)===Number(c.episode)));
  for(const release of r.releases)for(const ep of release.episodes||[])if(Number(ep.number)===Number(c.episode))for(const s of ep.sources||[])if(!excludedBranch(s.provider)&&typeof s.embedUrl==='string')variants.push({kind:release.kind,teams:(release.teams||[]).map(t=>typeof t==='string'?t:{id:t.id,name:t.name,slug:t.slug}),episode:Number(ep.number),provider:s.provider,embedOrigin:(()=>{try{return new URL(s.embedUrl).origin;}catch{return null;}})(),hasEmbed:true,language:'unknown-UA-oriented',releaseId:release.id});
  return {title:r.anime.titles,year:r.anime.year,identity:String(id)===c.id&&(!c.year||Number(r.anime.year)===Number(c.year))?(episodeFound?'matched':'episode-not-returned'):'needs-confirmation',episodeSelection:{requested:Number(c.episode),returned:episodeFound},variants,licensed:r.licensed,limit:'Mikai и команды релизов. UA не RU; разрешение медиа upstream проверяется отдельно.'};
 }
 if(provider==='primesrc'){
  if(!d.info||!Array.isArray(d.servers))fail('invalid-response','PrimeSrc: нет info/servers.');
  const e=d.info.episode,expected=c.canonical?.imdb,match=expected&&d.info.imdb_id===expected&&(c.type==='movie'||Number(e?.season)===Number(c.season)&&Number(e?.episode)===Number(c.episode));
  return {title:d.info.title,year:String(d.info.release_date||'').slice(0,4),identity:match?'matched':'needs-confirmation',episode:e?{season:e.season,episode:e.episode,title:e.title}:null,canonicalTMDB:c.id,upstreamTMDBFieldType:typeof d.info.tmdb_id,variants:d.servers.slice(0,100).map(s=>({name:s.name,quality:s.quality,audioLanguage:s.audio_language,audioType:s.audio_type,hasPlaybackURL:false})),limit:'Server records без URL. Ошибочное info.tmdb_id не заменяет canonical TMDB; language не аудиопроверка.'};
 }
 if(provider==='filmix'){
  if(c.mode==='variants')return {identity:'needs-confirmation',variantsStatus:'response-received-unconfirmed-contract',limit:'Video-links получен отдельно; схема/разрешение медиа требуют подтверждения. Ответ и URL не сохраняются.'};
  if(!Array.isArray(d.items))fail('invalid-response','FilmixTV: нет items.');
  return {identity:'needs-confirmation',candidates:d.items.slice(0,48).map(s=>({id:String(s.id),title:s.title,originalName:s.original_name,year:s.year,quality:s.quality})),limit:'Совпадение поиска и production year подтверждает наблюдатель. Нерелевантный поиск не отсутствие фильма.'};
 }
 if(provider==='vokino'){
  if(!d.details||!d.online||typeof d.online!=='object')fail('invalid-response','VoKino: нет details/online.');
  return {title:d.details.name,year:d.details.released,identity:'needs-confirmation',variants:Object.entries(d.online).filter(([k])=>!excludedBranch(k)).map(([name,v])=>({name,disabled:v.disabled,tags:v.tags,hasPlaylist:Boolean(v.playlist_url),requiresOwnAccess:true})),limit:'Карточка произведения, не эпизода. Online требует свой token. Runtime не перенесён в длительность серии.'};
 }
 if(provider==='animeon'){
  if(c.mode==='episodes'){
   if(!Array.isArray(d.episodes))fail('invalid-response','AnimeON: нет episodes.');
   const e=d.episodes.find(e=>Number(e.episode)===Number(c.episode)||Number(e.sourceEpisode)===Number(c.episode));
   return {identity:e?'needs-confirmation':'not-found',episode:e?{id:e.id,episode:e.episode,sourceEpisode:e.sourceEpisode,hasFileURL:typeof e.fileUrl==='string'}:null,limit:'Без fileUrl медиаконтракт отсутствует. URL из episode ID не создаётся.'};
  }
  if(!Array.isArray(d.translations))fail('invalid-response','AnimeON: нет translations.');
  return {identity:'needs-confirmation',variants:d.translations.flatMap(t=>(Array.isArray(t.player)?t.player:[]).map(p=>({translationId:t.translation?.id,translation:t.translation?.name,isSub:t.translation?.isSub,studios:t.translation?.studios,playerId:p.id,player:p.name,episodesCount:p.episodesCount}))),limit:'Выберите translation/player для episodes; русский звук не проверен.'};
 }
 fail('unknown-contract','Нет распознавателя ответа этого режима.');
}

export function mikaiEmbedChoices(d,c){
 const summary=parseCatalog('mikai',d,c);
 if(summary.identity!=='matched')throw new LabError('identity-unconfirmed','Mikai: точные MAL, год и эпизод не подтверждены ответом.');
 const result=[];
 for(const release of d.result.releases)for(const ep of release.episodes||[])if(Number(ep.number)===Number(c.episode))for(const s of ep.sources||[]){
  if(excludedBranch(s.provider)||typeof s.embedUrl!=='string'||s.embedUrl.length>4096)continue;
  let u;try{u=new URL(s.embedUrl);}catch{continue;}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['ashdi.vip','moonanime.art','fenixplay.xyz','tortuga.tw'].includes(u.hostname))continue;
  result.push({url:u.href,origin:u.origin,provider:s.provider,releaseId:release.id,kind:release.kind,teams:(release.teams||[]).map(t=>typeof t==='string'?t:t.name).filter(Boolean),episode:Number(ep.number)});
 }
 return result;
}
