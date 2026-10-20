// Bounded adapter for the v2 contract already recorded in the research.
// Activation requires the current cabinet documentation to be confirmed.
// Native player only: no stream extraction, decryption or media proxy.
const host='https://tv-1-kinoserial.net';
const text=v=>typeof v==='string'?v.slice(0,200):'';
const id=v=>/^\d{1,10}$/.test(String(v))?String(v):null;
function frame(raw,playerToken){
 if(typeof raw!=='string')return null;
 let u;try{u=new URL(raw);}catch{return null;}
 if(u.origin!==host||u.username||u.password||u.port||!/^\/embed\/\d+\/?$/.test(u.pathname))return null;
 // The cabinet player token, never the content database key.
 u.searchParams.set('token',playerToken);
 return u.href;
}
export function videoseedResults(body,query,playerToken){
 if(!Array.isArray(body?.data))throw new Error('unconfirmed-schema');
 const results=[];
 for(const work of body.data.slice(0,50)){
  const workId=id(work.id),title=text(work.title),year=Number(work.year??work.release_year);
  if(!workId||!title||!Number.isInteger(year)||year<1900||year>2100)continue;
  const choices=[];
  const add=(raw,translation,season=null,episode=null)=>{const embedURL=frame(raw,playerToken);if(embedURL)choices.push({translation:text(translation)||'Не указана',season,episode,videoId:new URL(embedURL).pathname.split('/').filter(Boolean).pop(),embedURL,origin:host});};
  if(work.seasons){
   const season=work.seasons[String(query.season)],episode=season?.videos?.[String(query.episode)];
   if(episode){
    for(const [key,t] of Object.entries(episode.translation_iframe||{}).slice(0,100))add(t.iframe,t.short_name||t.name||key,Number(query.season),Number(query.episode));
    if(!choices.length)add(episode.iframe,episode.short_translation,Number(query.season),Number(query.episode));
   }
  }else{
   for(const [key,t] of Object.entries(work.translation_iframe||{}).slice(0,100))add(t.iframe,t.short_name||t.name||key);
   if(!choices.length)add(work.iframe,work.short_translation);
  }
  results.push({id:workId,title,year,type:work.seasons?'tv':'movie',kp:id(work.kp),imdb:/^tt\d{5,12}$/.test(work.imdb)?work.imdb:null,tmdb:id(work.tmdb),availableSeasons:Object.keys(work.seasons||{}).filter(s=>/^\d+$/.test(s)).slice(0,100),choices});
 }
 if(body.data.length&&!results.length)throw new Error('unconfirmed-schema');
 return results;
}
