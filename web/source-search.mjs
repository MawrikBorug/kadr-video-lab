import {SEARCH_SOURCES,LIMITS,streamId} from './search-config.mjs';
import {SourceError,requestBytes,safeText,safeOrigin,now,failure} from './source-utils.mjs';
const cooldowns=new Map();
export const candidateKey = c => c.torrent.infoHash?`${c.torrent.infoHash}:${c.torrent.fileIdx ?? '?'}`:c.candidateId;
export class LocatorVault {
  constructor(){this.items=new Map();}
  get(candidate){return this.items.get(candidate.candidateId);}
  put(candidate,locator){this.items.set(candidate.candidateId,locator);}
  clear(){this.items.clear();}
}
function claimsFrom(text) {
  const resolution=text.match(/\b(2160p|1080p|720p|480p|4k)\b/i)?.[1]?.toLowerCase() || null;
  const container=text.match(/\b(mkv|mp4|webm|avi)\b/i)?.[1]?.toLowerCase() || null;
  const videoCodec=text.match(/\b(hevc|h\.?265|x265|avc|h\.?264|x264|av1|vp9)\b/i)?.[1] || null;
  const audioCodecs=[...new Set(text.match(/\b(FLAC|AAC|AC3|EAC3|DTS|TrueHD|Opus|MP3|Vorbis)\b/gi) || [])];
  const languages=[];
  for(const [lang,re] of [['ru',/\b(?:RUS|Russian)\b|Русск|🇷🇺/i],['en',/\b(?:ENG|English)\b|🇬🇧|🇺🇸/i],['ja',/\b(?:JAP|JPN|Japanese)\b|🇯🇵/i]])if(re.test(text))languages.push(lang);
  const voiceLabels=[...new Set(text.match(/AniLibria|LostFilm|TVShows|Flarrow Films|AniBaza|Amber|Dream Cast|Студийная Банда|Кубик в кубе|HDRezka|JASKIER|AlexFilm|Дубляжная|Baibako/gi) || [])];
  return {resolution,container,videoCodec,audioCodecs,languages,voiceLabels,subtitleLabels:[],tracksInspected:false};
}
export function normalizeStream(stream,work,source,vault,{evidenceId=crypto.randomUUID(),queriedAt=now(),dataMode='live'}={}) {
  if(!stream || typeof stream!=='object')return null;
  const raw=[stream.name,stream.description,stream.title,stream.behaviorHints?.filename].filter(v=>typeof v==='string').join('\n');
  if(/configure (?:the |your )?addon|configuration required|please configure|настройте|deprecated|not configured/i.test(raw))return null;
  let hash=typeof stream.infoHash==='string'?stream.infoHash.toLowerCase():null,magnet=null,direct=null;
  if(typeof stream.url==='string' && stream.url.startsWith('magnet:?')) {
    try{magnet=stream.url;hash=new URL(magnet).searchParams.get('xt')?.match(/^urn:btih:([a-f0-9]{40})$/i)?.[1]?.toLowerCase() || hash;}catch{/* invalid */}
  }
  if(!/^[a-f0-9]{40}$/.test(hash || ''))hash=null;
  if(!hash && typeof stream.url==='string') {try{const u=new URL(stream.url);if(['http:','https:'].includes(u.protocol))direct=u.href;}catch{/* invalid */}}
  if(!hash && !direct)return null; // externalUrl/resolvers/notice are not playable sources.
  const idx=Number.isInteger(stream.fileIdx) && stream.fileIdx>=0?stream.fileIdx:null;
  const filename=typeof stream.behaviorHints?.filename==='string'?stream.behaviorHints.filename:null;
  const contradiction=work.key==='deathnote' && /\b(?:2015|2017)\b|live[ ._-]*action|игровая[ ._-]+экранизация/i.test(raw)?'Death Note live-action/year conflict':
    work.key==='shrek' && /(?:Shrek|Шрек)[ .:_-]+(?:[234]\b|Forever\b|the[ ._-]+Third\b)/i.test(raw)?'Shrek sequel conflict':
    work.key==='hailmary' && /audiobook|аудиокниг|\.(?:epub|fb2|mobi|pdf)\b/i.test(raw)?'Book instead of movie':null;
  const c={schemaVersion:'0.1',candidateId:crypto.randomUUID(),dataMode,
    work:{...work,kind:work.type},provenance:{adapter:source.adapter || 'stremio',instanceId:source.id,hostLabel:source.label,
      upstreamLabels:[safeText(raw.match(/🔎\s*([^\n]+)/)?.[1] || '',180)].filter(Boolean),queriedAt,evidenceId,status:dataMode==='live'?'VERIFIED':'DOCUMENTED'},
    origins:[source.label],identity:{match:contradiction?'rejected':'exact-id',episodeMatch:work.type==='series'?'provider-claimed':'unresolved',
      rawReleaseTitle:safeText(raw),reason:contradiction},
    torrent:{infoHash:hash,magnet:hash?'magnet:?xt=urn:btih:'+hash:null,torrentUrlRef:null,fileIdx:idx,filePath:null,fileLength:null,
      metadataHashVerified:false,packageKind:'unknown',seedersReported:null,seedersObservedAt:null},
    claims:claimsFrom(raw),delivery:{kind:hash?'torrent-unresolved':/\.m3u8(?:\?|$)/i.test(direct)?'hls':/\.mpd(?:\?|$)/i.test(direct)?'dash':'http-file',
      state:'unverified',locatorRef:hash?null:'session-only',expiresAt:null,requiresHeaders:Object.keys(stream.behaviorHints?.proxyHeaders?.request || {}),
      ipBinding:'unknown',cors:'untested',range:'untested',webrtc:{trackerPeers:null,connectedPeers:null,receivedBytes:null},webseed:{urlRef:null,pieceHashMatched:false},
      clientCompatibility:{chromium:'untested',iPhoneSafari:'untested',PWA:'untested'}},
    access:{registration:'unknown',mandatoryCost:'unknown',serverDependency:null,termsEvidence:null},
    states:{search:'found',file:'unresolved',A:'unverified',B:'unverified',direct:'unverified',playback:'unverified'}};
  const urls=[];
  if(Array.isArray(stream.sources))for(const value of stream.sources)if(typeof value==='string' && /^https:\/\/[^\s]+\.torrent(?:\?|$)/i.test(value))urls.push(value);
  vault.put(c,{direct,filename,claimedIdx:idx,metadataURLs:urls,magnet:hash?'magnet:?xt=urn:btih:'+hash:null});return c;
}
export function validateManifest(manifest,work) {
  if(!manifest || typeof manifest.id!=='string' || typeof manifest.name!=='string' || typeof manifest.version!=='string' || !Array.isArray(manifest.resources) || !Array.isArray(manifest.types))throw new SourceError('MANIFEST_INVALID');
  if(manifest.behaviorHints?.configurationRequired || manifest.configurationRequired)throw new SourceError('CONFIGURATION_REQUIRED');
  if(!manifest.types.includes(work.type))throw new SourceError('TYPE_UNSUPPORTED');
  const resource=manifest.resources.find(r=>r==='stream' || r?.name==='stream');if(!resource)throw new SourceError('STREAM_UNSUPPORTED');
  const prefixes=typeof resource==='object'?resource.idPrefixes:manifest.idPrefixes;
  if(prefixes?.length && !prefixes.some(p=>work.imdb.startsWith(p)))throw new SourceError('ID_PREFIX_UNSUPPORTED');
  if(typeof resource==='object' && resource.types?.length && !resource.types.includes(work.type))throw new SourceError('TYPE_UNSUPPORTED');
  return manifest;
}
export class SearchAdapter {
  constructor({vault,limits=LIMITS,fetchBytes=requestBytes}){Object.assign(this,{vault,limits,fetchBytes});}
  async search(source,work,{signal,onState,onCandidates,onBytes=()=>{}}) {
    const requestId=crypto.randomUUID(),started=performance.now(),record={requestId,host:source.label,instanceId:source.id,
      queriedAt:now(),query:{type:work.type,id:streamId(work)},dataMode:'live',phase:'manifest',state:'requesting',searchBytes:0};
    const update=patch=>{Object.assign(record,patch,{elapsedMs:Math.round(performance.now()-started)});if(!signal.aborted)onState({...record});};
    const count=n=>{record.searchBytes+=n;onBytes(n);};
    const json=async url=>{
      const {bytes,response}=await this.fetchBytes(url,{signal,max:this.limits.searchResponseBytes,ms:this.limits.requestMs,onBytes:count});
      record.httpStatus=response.status;record.browserCors='readable';
      try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new SourceError('JSON_PARSE');}
    };
    update({});
    try {
      const until=cooldowns.get(source.id);if(until>Date.now())throw new SourceError('RATE_LIMIT_COOLDOWN',{retryAfter:Math.ceil((until-Date.now())/1000)});
      const manifest=validateManifest(await json(source.manifest),work);
      update({manifest:{id:safeText(manifest.id,120),name:safeText(manifest.name,120),version:safeText(manifest.version,40)},phase:'streams'});
      const url=source.manifest.replace(/manifest\.json(?:\?.*)?$/,'')+`stream/${work.type}/${encodeURIComponent(streamId(work))}.json`;
      const body=await json(url);if(!Array.isArray(body?.streams))throw new SourceError('STREAMS_INVALID');
      let rejected=0,accepted=0;
      for(let offset=0;offset<body.streams.length && accepted<this.limits.maxResults;offset+=50){
        if(signal.aborted)throw new SourceError('CANCELLED');
        const chunk=body.streams.slice(offset,offset+50).map(s=>normalizeStream(s,work,source,this.vault,{evidenceId:requestId})).filter(Boolean);
        rejected+=Math.min(50,body.streams.length-offset)-chunk.length;
        const selected=chunk.slice(0,this.limits.maxResults-accepted);accepted+=selected.length;
        if(selected.length)onCandidates(selected);
        // Yield so first results and automatic probes paint before the whole list.
        await new Promise(r=>setTimeout(r,0));
      }
      const configure=body.streams.some(s=>/configur|настройте/i.test([s.name,s.title,s.description].join(' ')));
      update({state:accepted?(body.error?'partial':'success'):configure?'configuration':'empty',code:accepted?null:configure?'CONFIGURATION_NOTICE':body.streams.length?'NOTICE_OR_UNSUPPORTED':'EMPTY_STREAMS',
        accepted,rejected,reported:body.streams.length,truncated:body.streams.length>this.limits.maxResults});
      return {fallback:!accepted || !!body.error,record};
    } catch(e) {
      const error=failure(e);if(error.code==='RATE_LIMIT')cooldowns.set(source.id,Date.now()+1000*(error.retryAfter ?? 60));
      update({state:error.code==='CANCELLED'?'cancelled':'failed',...error});return {fallback:error.code!=='CANCELLED',record};
    }
  }
  async primaryThenFallback(work,handlers,sources=SEARCH_SOURCES) {
    for(let i=0;i<sources.length;i++){
      if(handlers.signal.aborted)return;
      const result=await this.search(sources[i],work,handlers);if(!result.fallback)return;
    }
  }
}
export async function checkSupplement(id,{signal,work,onBytes=()=>{}}) {
  const query=id==='nyaa'?work.title:work.ru;
  const url=id==='nyaa'?`https://nyaa.si/?page=rss&q=${encodeURIComponent(query)}&c=1_2&f=0`:`https://rutor.info/search/0/0/000/0/${encodeURIComponent(query)}`;
  const result=await requestBytes(url,{signal,max:1048576,ms:12000,onBytes});
  // Available native interfaces, with browser CORS required. Never a proxy.
  const text=new TextDecoder().decode(result.bytes),doc=new DOMParser().parseFromString(text,id==='nyaa'?'application/xml':'text/html');
  if(id==='nyaa' && doc.querySelector('parsererror'))throw new SourceError('RSS_PARSE');
  const matches=id==='nyaa'?[...doc.querySelectorAll('item')].map(item=>({title:item.querySelector('title')?.textContent,
    hash:item.getElementsByTagNameNS('*','infoHash')[0]?.textContent,url:item.querySelector('link')?.textContent})):
    [...doc.querySelectorAll('a[href^="magnet:"]')].map(a=>({title:a.closest('tr')?.querySelector('a[href*="/torrent/"]')?.textContent || a.closest('tr')?.textContent,
      hash:a.getAttribute('href')?.match(/urn:btih:([a-f0-9]{40})/i)?.[1]}));
  return {host:safeOrigin(url),matches};
}
