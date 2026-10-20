// Only the documented Kodik iframe returned by the owner's search is exposed.
// No resolver, media proxy, decryption, borrowed token or arbitrary URL fetching.
export function kodikChoices(body,{season=1,episode=1}={}){
 if(!Array.isArray(body.results))return [];
 const choices=[];
 for(const item of body.results.slice(0,50)){
  const selected=item.seasons?.[String(season)]?.episodes?.[String(episode)];
  const raw=selected||(!item.seasons?item.link:null);if(typeof raw!=='string')continue;
  let u;try{u=new URL(raw.startsWith('//')?'https:'+raw:raw);}catch{continue;}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['kodik.info','kodik.cc','kodik.biz','kodik.video','kodikdb.com'].includes(u.hostname)||/[?&](?:token|api_key|access_token|signature)=/i.test(u.search))continue;
  choices.push({id:String(item.id??'').slice(0,100),title:String(item.title??'').slice(0,200),year:Number(item.year)||null,kp:item.kinopoisk_id?String(item.kinopoisk_id):null,imdb:item.imdb_id||null,translation:String(item.translation?.title??'unknown').slice(0,120),season:item.seasons?Number(season):null,episode:item.seasons?Number(episode):null,embedURL:u.href,origin:u.origin});
 }
 return choices;
}
