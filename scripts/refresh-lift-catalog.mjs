import JSON5 from 'json5';
import {writeFile,readFile} from 'node:fs/promises';
// Developer metadata refresh. Signed iframe and nested media URLs remain in memory only.
const previous=JSON.parse(await readFile('web/catalog.json','utf8'));
const entries=[
 [3637,'Синтел','Sintel',2010,2,'control',false],
 [76436,'Дандадан','Dandadan',2024,7,'anime',true],
 [68777,'Фрирен / Frieren: Beyond Journey’s End','Sousou no Frieren',2023,7,'anime',true],
 [2087,'Тетрадь смерти','Death Note',2006,7,'anime',true],
 [180,'Интерстеллар','Interstellar',2014,1,'film',false],
 [70403,'Фаллаут','Fallout',2024,3,'series',true],
 [255,'Во все тяжкие','Breaking Bad',2008,3,'series',true],
 [5784,'Человек-паук: Вдали от дома','Spider-Man: Far From Home',2019,1,'film',false],
 [87181,'Проект «Аве Мария» / Project Hail Mary','Project Hail Mary',2026,1,'film',false],
 [2209,'Шрек','Shrek',2001,2,'film',false],
 [69530,'Слово пацана. Кровь на асфальте','',2023,3,'series',true]
];
function literal(text,key){
 const m=new RegExp('(?:\\b'+key+'|"'+key+'")\\s*:\\s*([\\[{])').exec(text);if(!m)return null;
 const start=m.index+m[0].length-1;let stack=[],quote='',escape=false;
 for(let i=start;i<text.length;i++){
  const c=text[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}
  if(c==='"'||c==="'"){quote=c;continue;}if(c==='['||c==='{')stack.push(c);if(c===']'||c==='}')stack.pop();
  if(!stack.length){try{return JSON5.parse(text.slice(start,i+1));}catch{return null;}}
 }return null;
}
const cleanLabel=s=>typeof s==='string'&&!/(?:https?:|\/\/)/i.test(s)?s.slice(0,140):null;
function tracks(item){const audio=item?.audio;return {audioLabels:(audio?.names||[]).map(cleanLabel).filter(Boolean),subtitleLabels:(Array.isArray(item?.subtitle)?item.subtitle:[]).map(s=>cleanLabel(s.label||s.name||s.title)).filter(Boolean)};}
const results=[];
for(const [id,title,original,year,nativeType,group,series] of entries){
 try{
 const response=await fetch('https://api.liftw.ws/info/'+id,{signal:AbortSignal.timeout(25000)});const d=await response.json();
 if(d.id!==id || d.origin_name!==original || Number(d.year)!==year || d.type!==nativeType)throw Error('identity_mismatch');
 const u=new URL(d.iframe_uri);if(u.origin!=='https://embed.liftw.ws'||u.pathname!==`/embed/movie/${id}`)throw Error('native_embed_mismatch');
 const frame=await fetch(d.iframe_uri,{signal:AbortSignal.timeout(25000)});const html=await frame.text();
 const all=literal(html,'seasons');
 const seasons=Array.isArray(all)?all.map(s=>({season:Number(s.season),episodes:s.episodes.map(e=>({episode:Number(e.episode),providerId:Number(e.id),title:cleanLabel(e.title)||null,...tracks(e),duration:Number(e.duration)||null})).filter(e=>Number.isSafeInteger(e.episode)&&e.episode>=0)})).filter(s=>Number.isSafeInteger(s.season)&&s.episodes.length).sort((a,b)=>a.season-b.season):[];
 const flat=seasons.flatMap(s=>s.episodes),audios=flat.flatMap(e=>e.audioLabels),subs=flat.flatMap(e=>e.subtitleLabels);
 if(!series){const a=literal(html,'audio');audios.push(...(a?.names||[]).map(cleanLabel).filter(Boolean));const sub=literal(html,'subtitle');if(Array.isArray(sub))subs.push(...sub.map(s=>cleanLabel(s.label||s.name||s.title)).filter(Boolean));}
 const videoId=Number(/var videoKey\s*=\s*(\d+)/.exec(html)?.[1])||null;
 results.push({id,title,original,providerTitle:d.name,year,nativeType,group,series,ownerSample:group!=='control',plannedSeason:series?seasons[0]?.season??null:null,plannedEpisode:series?seasons[0]?.episodes[0]?.episode??null:null,
  access:'native-player-user-selected',webseedQualification:previous.find(m=>m.id===id)?.webseedQualification || {state:'NOT_CHECKED'},snapshot:{checkedAt:new Date().toISOString(),found:true,iframeReceived:true,catalogQuality:d.quality,declaredQualities:[d.quality],qualityEvidence:'Provider API label; levels require playback',audioLabels:[...new Set(audios)],subtitleLabels:[...new Set(subs)],seasons,videoProviderId:videoId,videoNotStarted:true,
  evidence:'Native info identity and embed playlist metadata, no media claim',episodeCommandInNativeCode:html.includes("'playlist go' == e.data.event")&&html.includes("post({\n\t\t\t\tevent: 'changeEpisode'")}});
 console.log(JSON.stringify({id,title,year,nativeType,seasons:seasons.map(s=>[s.season,s.episodes.length]),audioLabels:results.at(-1).snapshot.audioLabels}));
 }catch(e){console.log(JSON.stringify({id,error:e.name,code:e.message==='identity_mismatch'?e.message:'request_or_parse_failed'}));throw Error('Snapshot incomplete, no output published');}
}
await writeFile(process.env.CATALOG_OUTPUT || 'web/catalog.json',JSON.stringify(results,null,2)+'\n');
