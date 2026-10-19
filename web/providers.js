export const SANDBOX = Object.freeze({strict:'allow-scripts allow-same-origin',popups:'allow-scripts allow-same-origin allow-popups',documented:null});
const frame=(name,refId,origin,grammar='slash',types=['movie','tv'])=>({name,refId,origin,grammar,types,kind:'iframe',enabled:true,namespace:'tmdb',modes:['embed'],source:origin,gate:'Штатный iframe',live:'HTML не подтверждает основное видео',description:'Точная адресация TMDB. Слои и ручные подтверждения сохраняются раздельно.',limitation:'Parent pause/seek не подтверждены. Реклама, русский звук и физический iPhone не измерены.'});
const api=(name,refId,namespace,modes,types,source,description,limitation)=>({name,refId,namespace,modes,types,source,description,limitation,kind:'catalog',enabled:true,gate:'Каталог / варианты отдельно от media',live:'Анонимный режим; неизвестное не означает «нет»'});
export const PROVIDERS={
 apple:{...api('Apple HLS · контроль','CONTROL-APPLE','control',['media'],['control'],'https://developer.apple.com/streaming/examples/','Apple BipBop HLS — разрешённый контроль транспорта.','Не подтверждает N14 или русский звук.'),kind:'hls'},
 blender:{...api('Blender Sintel · контроль','CONTROL-BLENDER','control',['media'],['control'],'https://durian.blender.org/sharing/','Sintel © Blender Foundation, sintel.org, CC BY 3.0.','Трейлер 52 секунды, не пятиминутный фильм N14.'),kind:'mp4'},
 aniliberty:{...api('AniLiberty v1','C11','aniliberty',['catalog','media'],['tv'],'https://api.anilibria.app/api/docs/v1/','Свежий v1. 9600/9542/9789; эпизод по ordinal. Другой сезон требует ID релиза.','HLS не подтверждает права и RU. Подписанные URL только в памяти.'),kind:'hls'},
 mikai:api('Mikai','X28','mal',['catalog'],['tv'],'https://api.mikai.me/public/docs','Атрибуция: Mikai и команды релизов. Анонимно 60/min, ключ необязателен.','UA не считается RU. Voice/sub и дробные номера сохраняются; embedUrl не HLS.'),
 primesrc:{...frame('PrimeSrc','X31','https://primesrc.me','query'),kind:'catalog',modes:['catalog','embed']},
 filmix:api('FilmixTV','X09','filmix',['catalog','variants'],['movie','tv'],'https://api.filmix.tv','FilmixTV list и post/video-links — разные режимы; совпадение поиска подтверждается.','403 не обходится. proPlus=false не доказательство бесплатности.'),
 vokino:api('VoKino','X18','kp',['catalog','online'],['movie','tv'],'https://api.vokino.org','Публичный view отдельно от закрытого online. HTTP 200 + error:401 — отказ.','Без CORS ответ не прочитать с Pages. Runtime сериала не длительность серии.'),
 animeon:api('AnimeON','L006','animeon',['catalog','episodes'],['tv'],'https://animeon.club','Translations и episodes. ID 1283/924/3384; player и translation из ответа.','В исследовании fileUrl отсутствовал. URL из episode ID не синтезируется.'),
  archive:api('Internet Archive · Sintel metadata','C13','archive',['catalog'],['control'],'https://archive.org/metadata/Sintel','Метаданные конкретного Sintel; отдельный разрешённый объект, не N14.','Метаданные и лицензия не заменяют запуск медиасеанса. Контрольный трейлер доставляется Blender.'),
 vidapi:frame('VidAPI','C28','https://vaplayer.ru'),
 vidlink:frame('VidLink','C29','https://vidlink.pro','plain'),
 vidzee:frame('VidZee','C30','https://player.vidzee.wtf'),
  stellar:{...frame('Stellar','X21','https://stellar.rip','stellar'),limitation:'READY/INIT проверен по живой документации в браузере. request-token не копируется. Локаль не задаёт язык звука; команды pause/seek не подтверждены.'},
 yapgrid:frame('YapGrid','X22','https://yapgrid.com'),
 mapple:frame('Mapple','X23','https://mapple.fun','mapple'),
 embedwave:frame('EmbedWave','X25','https://embedwave.cc'),
  vidrift:{...frame('VidRift','X26','https://embed.vidrift.net'),limitation:'Movie и TV route подтверждены живой документацией в браузере. Управление auto-next и parent pause не подтверждены; переходы отмечаются вручную.'},
 cinesrc:{...frame('CineSrc','X27','https://cinesrc.st','slash',['movie']),limitation:'Подтверждена movie grammar. Точный TV route и внешние команды неизвестны.'},
 cinezo:frame('Cinezo','X30','https://player.cinezo.live'),
 ezvidapi:{name:'ezvidapi',refId:'X24',kind:'unconfirmed',enabled:false,modes:['unknown'],namespace:'tmdb',source:'https://ezvidapi.com/',gate:'Неизвестен контракт',live:'API не установлен',description:'Исторический ID сохранён.',limitation:'Нужны официальный endpoint и условия.'},
};
export const MODE_NAMES={media:'Media / контроль',catalog:'Каталог / варианты',variants:'FilmixTV video-links',episodes:'AnimeON перевод / эпизод',embed:'Штатный iframe',online:'Online · нужен доступ',unknown:'Ожидается контракт'};
export class LabError extends Error {constructor(code,message,extra={}){super(message);this.name='LabError';this.code=code;Object.assign(this,extra);}}
export const excludedBranch=name=>/(?:youtube|rutube|vkmovie|vkvideo|vk[_ -]?video|lumex)/i.test(String(name));
const fail=(code,message)=>{throw new LabError(code,message);};
const numeric=v=>/^[1-9]\d{0,9}$/.test(String(v));
export function modeIssue(p,mode){
 if(!p?.enabled)return {code:'unknown-contract',reason:p?.limitation||'Неизвестен контракт'};
 if(p.handshakeBlocked)return {code:'unknown-contract',reason:p.limitation};
 if(p.refId==='X18'&&mode==='online')return {code:'auth-required',reason:'Нужен свой VoKino token и закрытый серверный адаптер. Бесплатные условия не подтверждены.'};
 return null;
}
export function buildRequest(c){
 const p=PROVIDERS[c.provider];if(!p?.enabled)fail('unknown-contract','Источник не подтвердился: актуальный публичный контракт недоступен.');
 const mode=c.mode||p.modes[0],issue=modeIssue(p,mode);if(issue)fail(issue.code,issue.reason);
 if(!p.modes.includes(mode))fail('unknown-contract','Режим не поддержан этим поставщиком.');
 if(['apple','blender'].includes(c.provider))return {kind:p.kind,url:c.provider==='apple'?'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8':'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',mode,mainVideo:true};
 const id=String(c.id??'').trim();if(!p.types.includes(c.type))fail('unsupported-type','Неподдерживаемый тип. TV route не угадывается.');
 if(c.type==='tv'){
  const anime=['aniliberty','mikai','animeon'].includes(c.provider);
  if(!(anime?/^\d{1,3}(?:\.\d{1,2})?$/:/^[1-9]\d{0,2}$/).test(String(c.episode))||Number(c.episode)<=0)fail('invalid-id','Недопустимый номер эпизода. Дробные anime ordinal сохраняются.');
  if(!anime&&!/^[1-9]\d{0,2}$/.test(String(c.season)))fail('invalid-id','Сезон от 1 до 999.');
 }
 if(c.provider==='aniliberty'){
  if(c.namespace!=='aniliberty'||!/^(?:[1-9]\d{0,8}|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(id)||id.length>120)fail('invalid-id','AniLiberty: нужен ID / alias релиза, а не TMDB или IMDb.');
  if(!['480','720','1080'].includes(c.quality))fail('invalid-id','Выберите качество из списка.');
  return {kind:'catalog',url:`https://api.anilibria.app/api/v1/anime/releases/${encodeURIComponent(id)}`,mode};
 }
 if(c.provider==='filmix'&&mode==='catalog'){
  if(!c.title?.trim())fail('no-address','Укажите точное название для поиска.');
  return {kind:'catalog',url:`https://api.filmix.tv/api-fx/list?search=${encodeURIComponent(c.searchTitle||c.title)}&limit=48`,mode};
 }
 if(c.provider==='archive'){
  if(c.namespace!=='archive'||id!=='Sintel')fail('no-address','Разрешённый metadata-объект Archive: точный identifier Sintel. Для других объектов нужен отдельный контракт.');
  return {kind:'catalog',url:'https://archive.org/metadata/Sintel',mode};
 }
 if(c.namespace!==p.namespace||!numeric(id))fail('no-address',`Нужен точный ${p.namespace.toUpperCase()} ID. Неизвестный ID не заменяется другим фильмом.`);
 if(c.provider==='mikai')return {kind:'catalog',url:`https://api.mikai.me/public/v1/anime/mal:${id}/player`,mode};
 if(c.provider==='filmix')return {kind:'catalog',url:`https://api.filmix.tv/api-fx/post/${id}/video-links`,mode};
 if(c.provider==='vokino')return {kind:'catalog',url:`https://api.vokino.org/v2/view/${id}`,mode};
 if(c.provider==='animeon'){
  let url=`https://animeon.club/api/player/${id}/translations`;
  if(mode==='episodes'){
   if(!numeric(c.translationId)||!numeric(c.playerId))fail('no-address','Выберите translationId и playerId из свежего ответа translations.');
   url=`https://animeon.club/api/player/${id}/episodes?take=100&skip=-1&playerId=${c.playerId}&translationId=${c.translationId}`;
  }return {kind:'catalog',url,mode};
 }
 const type=c.type,suffix=type==='movie'?`movie/${id}`:`tv/${id}/${c.season}/${c.episode}`,query=`${type}?tmdb=${id}${type==='tv'?`&season=${c.season}&episode=${c.episode}`:''}`;
 if(c.provider==='primesrc'&&mode==='catalog')return {kind:'catalog',url:`${p.origin}/api/v1/list_servers?type=${type}&tmdb=${id}${type==='tv'?`&season=${c.season}&episode=${c.episode}`:''}`,mode};
 if(!(c.sandbox in SANDBOX))fail('invalid-config','Неизвестный режим sandbox.');
 if(c.sandbox==='documented'&&!c.unrestrictedConsent)fail('needs-action','Для режима без sandbox подтвердите предупреждение об окнах и навигации.');
 if(c.sandbox==='documented'&&!c.cleanSessionConsent)fail('needs-action','Нужна отдельная чистая тестовая сессия после strict-пробы.');
 let path=`/embed/${suffix}`;
 if(p.grammar==='plain')path=`/${suffix}`;
 if(p.grammar==='query')path=`/embed/${query}`;
 if(p.grammar==='mapple')path=type==='movie'?`/watch/movie/${id}`:`/watch/tv/${id}-${c.season}-${c.episode}`;
 if(p.grammar==='stellar')path=(type==='movie'?`/en/watch/embed/movie/${id}`:`/en/watch/embed/tv/${id}-${c.season}-${c.episode}`)+'?autoPlay=false&autoNext=false';
 return {kind:'iframe',url:p.origin+path,origin:p.origin,sandbox:SANDBOX[c.sandbox],mode};
}
export function configForSample(provider,mode,sample,settings={}){
 const namespace=PROVIDERS[provider]?.namespace||'unknown',id=namespace==='control'?provider:sample[namespace];
 return {provider,mode,sampleKey:sample.key,canonicalId:sample.canonicalId||null,title:sample.title,searchTitle:sample.title,year:sample.year||null,category:sample.category,type:sample.type,namespace,id:id?String(id):'',season:String(sample.season||1),episode:String(sample.episode||1),quality:'480',sandbox:'strict',stage:'E1',watchScope:'smoke',canonical:{kp:sample.kp||null,tmdb:sample.tmdb||null,imdb:sample.imdb||null,mal:sample.mal||null,year:sample.year||null},...settings};
}
export function selectEpisode(r,ordinal,quality){
 if(!r||!Array.isArray(r.episodes)||typeof r.name?.main!=='string')fail('invalid-response','Источник не подтвердился: неверная структура релиза.');
 const e=r.episodes.find(e=>Number(e.ordinal)===Number(ordinal));if(!e)fail('empty-result','Этот эпизод не найден в ответе API. Это не проверка всего каталога.');
 const raw=e[`hls_${quality}`];if(typeof raw!=='string'||raw.length>4096)fail('empty-result','В ответе нет публичного HLS выбранного качества.');
 const u=new URL(raw),hosts=['libria.fun','anilibria.top','aniliberty.top'];
 if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.some(h=>u.hostname===h||u.hostname.endsWith(`.${h}`)))fail('unsafe-media','Новый или небезопасный медиахост: нужна проверка контракта.');
 return {url:raw,origin:u.origin,title:r.name.main.slice(0,200),episodeName:String(e.name??'').slice(0,200),ordinal:Number(e.ordinal),duration:Number(e.duration)||null};
}
