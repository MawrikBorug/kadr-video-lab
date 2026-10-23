import {SourceError} from './source-utils.mjs';
const decoder=new TextDecoder();
const string = v => v instanceof Uint8Array?decoder.decode(v):'';
export const videoFile = path => /\.(mp4|m4v|mkv|webm|mov|avi|ts)$/i.test(path) && !/(?:^|[\/ ._\-])(sample|bonus|trailer|extras?|ncop|nced)(?:[\/ ._\-]|$)/i.test(path);
export async function sha1(bytes) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
export async function parseMetadata(bytes,expected,{maxBytes=1048576,maxFiles=10000}={}) {
  if(bytes.length>maxBytes)throw new SourceError('METADATA_SIZE_LIMIT');
  let i=0,nodes=0,infoStart,infoEnd;
  function read(depth=0) {
    if(++nodes>200000 || depth>32 || i>=bytes.length)throw new SourceError('TORRENT_PARSE');
    const c=bytes[i];
    if(c===105){const start=++i;while(i<bytes.length && bytes[i]!==101)i++;const n=Number(decoder.decode(bytes.subarray(start,i++)));if(!Number.isSafeInteger(n))throw new SourceError('TORRENT_PARSE');return n;}
    if(c===108 || c===100){i++;const value=c===108?[]:Object.create(null);while(i<bytes.length && bytes[i]!==101){
      if(c===108)value.push(read(depth+1));else {const key=string(read(depth+1));const start=i;value[key]=read(depth+1);if(depth===0 && key==='info'){infoStart=start;infoEnd=i;}}}
      if(bytes[i++]!==101)throw new SourceError('TORRENT_PARSE');return value;}
    const start=i;while(i<bytes.length && bytes[i]>=48 && bytes[i]<=57)i++;
    if(i===start || bytes[i++]!==58)throw new SourceError('TORRENT_PARSE');const length=Number(decoder.decode(bytes.subarray(start,i-1)));
    if(!Number.isSafeInteger(length) || length<0 || i+length>bytes.length)throw new SourceError('TORRENT_PARSE');
    const value=bytes.subarray(i,i+length);i+=length;return value;
  }
  const root=read();if(i!==bytes.length || infoStart===undefined)throw new SourceError('TORRENT_PARSE');
  const hash=await sha1(bytes.subarray(infoStart,infoEnd));if(expected && hash!==expected.toLowerCase())throw new SourceError('INFOHASH_MISMATCH');
  const info=root.info,name=string(info['name.utf-8'] || info.name),pieceLength=info['piece length'],pieces=info.pieces;
  if(!name || !Number.isSafeInteger(pieceLength) || pieceLength<=0 || !(pieces instanceof Uint8Array) || pieces.length%20)throw new SourceError('TORRENT_PARSE');
  const entries=info.files || [{length:info.length,path:[]}];if(!Array.isArray(entries) || entries.length>maxFiles)throw new SourceError('FILE_COUNT_LIMIT');
  let offset=0;
  const files=entries.map((file,fileIdx)=>{
    const parts=file['path.utf-8'] || file.path;if(!Array.isArray(parts) || !Number.isSafeInteger(file.length) || file.length<0)throw new SourceError('TORRENT_PARSE');
    const relative=parts.map(string).join('/'),path=relative?name+'/'+relative:name;
    if(path.split('/').some(s=>s==='..' || s==='.' || /[\\\0]/.test(s)))throw new SourceError('UNSAFE_TORRENT_PATH');
    const result={fileIdx,path,relativePath:relative,length:file.length,offset,video:videoFile(path)};offset+=file.length;return result;
  });
  if(!Number.isSafeInteger(offset) || Math.ceil(offset/pieceLength)!==pieces.length/20)throw new SourceError('TORRENT_PIECES_MISMATCH');
  let seeds=root['url-list'] || [];if(seeds instanceof Uint8Array)seeds=[seeds];
  const webseeds=Array.isArray(seeds)?seeds.map(string).filter(v=>{try{return ['https:','http:'].includes(new URL(v).protocol);}catch{return false;}}):[];
  return {infoHash:hash,name,files,length:offset,pieceLength,pieces,webseeds,httpSeeds:root['httpseeds']?'BEP17_UNSUPPORTED':null,
    private:info.private===1,multiFile:!!info.files,metadataBytes:bytes.length};
}
export function resolveFile(meta,work,claimedIdx,mappings=[]) {
  const verified=mappings.find(m=>m.title_key===work.key && m.season===work.season && m.episode===work.episode)?.matches
    .find(m=>m.infohash===meta.infoHash && meta.files[m.fileIdx]?.length===m.length &&
      (meta.files[m.fileIdx].path===m.filePath || meta.files[m.fileIdx].relativePath===m.filePath));
  if(verified)return {index:verified.fileIdx,basis:'research-map + fresh infohash/path/length verification'};
  const videos=meta.files.filter(f=>f.video);
  if(work.type==='movie')return videos.length===1?{index:videos[0].fileIdx,basis:'single video file'}:{index:null,basis:'multiple movie files; explicit selection required'};
  const matches=videos.filter(f=>{
    const p=f.path,explicit=[...p.matchAll(/S(\d{1,2})[ ._\-]*E(\d{1,3})(?!\d)/gi)];
    if(explicit.length)return explicit.some(m=>+m[1]===work.season && +m[2]===work.episode);
    // No guessed absolute episode, season number or file ordinal.
    return false;
  });
  if(matches.length===1)return {index:matches[0].fileIdx,basis:'explicit SxxExx path'};
  return {index:null,basis:claimedIdx!=null?'provider fileIdx is a claim; episode path unresolved':'episode file unresolved'};
}
export function explicitFileAllowed(meta,file,work,mappings=[]) {
  if(!file?.video)return false;
  if(work.type!=='series')return true;
  const explicit=[...file.path.matchAll(/S(\d{1,2})[ ._\-]*E(\d{1,3})(?!\d)/gi)];
  if(explicit.length && !explicit.some(m=>+m[1]===work.season && +m[2]===work.episode))return false;
  const related=mappings.filter(row=>row.title_key===work.key && row.matches.some(m=>m.infohash===meta.infoHash));
  if(related.length)return related.some(row=>row.season===work.season && row.episode===work.episode && row.matches.some(m=>m.infohash===meta.infoHash && m.fileIdx===file.fileIdx));
  return true; // Unknown naming remains an explicit user choice, never an auto choice.
}
export function webseedFileURL(seed,meta,file) {
  const url=new URL(seed);if(url.protocol!=='https:' && !(url.hostname==='127.0.0.1' || url.hostname==='localhost'))throw new SourceError('WEBSEED_HTTPS_REQUIRED');
  if(meta.multiFile && !url.pathname.endsWith('/'))throw new SourceError('MULTIFILE_WEBSEED_BASE_UNRESOLVED');
  if(url.pathname.endsWith('/'))return new URL(file.path.split('/').map(encodeURIComponent).join('/'),url).href;
  return url.href;
}
