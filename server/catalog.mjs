import {Failure,demand,jsonFetch,cut} from './core.mjs';

export class Catalog {
  constructor(env,signal){this.env=env;this.signal=signal;this.calls=0;}
  async get(path,params={}){
    const token=this.env.TMDB_READ_ACCESS_TOKEN||this.env.TMDB_API_READ_ACCESS_TOKEN;
    demand(token||this.env.TMDB_API_KEY,'TMDB_NOT_CONFIGURED','Серверный TMDB-ключ ещё не настроен.',503);
    demand(++this.calls<=28,'CATALOG_BUDGET','Достигнут лимит каталожных запросов.');
    const url=new URL('https://api.themoviedb.org/3'+path);
    for(const [k,v]of Object.entries({language:'ru-RU',...params}))url.searchParams.set(k,v);
    if(!token)url.searchParams.set('api_key',this.env.TMDB_API_KEY);
    return jsonFetch(url,{signal:this.signal,headers:token?{Authorization:'Bearer '+token}:{}});
  }
  project(row,type){
    const kind=type||row.media_type;
    return {id:row.id,type:kind,title:cut(row.title||row.name,250),original:cut(row.original_title||row.original_name,250),
      year:Number((row.release_date||row.first_air_date||'').slice(0,4))||null,
      poster:row.poster_path&&/^\/[\w.-]+$/.test(row.poster_path)?'https://image.tmdb.org/t/p/w342'+row.poster_path:null,
      catalogVerified:true,frameMatchVerified:false,url:`https://www.themoviedb.org/${kind}/${row.id}`};
  }
  async search(query){
    demand(typeof query==='string'&&query.trim().length>=2&&query.length<=250,'QUERY','Введите название или используйте описание для AI-поиска.');
    const data=await this.get('/search/multi',{query:query.trim(),include_adult:'false'});
    return (data.results||[]).filter(x=>['movie','tv'].includes(x.media_type)).slice(0,6).map(x=>this.project(x));
  }
  async visualSearch(queries){
    const headers={'User-Agent':'KADR-Video-Lab/3 (https://github.com/MawrikBorug/kadr-video-lab)'},result=[];
    for(const text of queries){
      if(typeof text!=='string'||text.length<3||text.length>150)continue;
      const query=new URLSearchParams({action:'query',generator:'search',gsrsearch:'hastemplate:"Infobox film" '+text,gsrlimit:'6',prop:'pageprops',format:'json'});
      let pages;try{pages=Object.values((await jsonFetch('https://en.wikipedia.org/w/api.php?'+query,{signal:this.signal,headers})).query?.pages||{}).sort((a,b)=>(a.index||0)-(b.index||0));}catch{continue;}
      for(const page of pages.slice(0,4)){
        const id=page.pageprops?.wikibase_item;if(!/^Q\d+$/.test(id||''))continue;
        let entity;try{entity=(await jsonFetch('https://www.wikidata.org/w/api.php?'+new URLSearchParams({action:'wbgetentities',ids:id,props:'claims',format:'json'}),{signal:this.signal,headers})).entities?.[id];}catch{continue;}
        const movie=entity?.claims?.P4947?.[0]?.mainsnak?.datavalue?.value,tv=entity?.claims?.P4983?.[0]?.mainsnak?.datavalue?.value;
        if(!movie&&!tv)continue;
        const type=movie?'movie':'tv',value=Number(movie||tv);
        if(result.some(x=>x.id===value&&x.type===type))continue;
        try{result.push({...await this.detail(type,value),retrievedBy:'visual-keyword-search'});}catch(e){if(e.code==='TMDB_NOT_CONFIGURED')throw e;}
        if(result.length>=3)return result;
      }
    }
    return result;
  }
  async detail(type,id){
    demand(['movie','tv'].includes(type)&&Number.isSafeInteger(id)&&id>0,'IDENTITY','Неверная карточка.');
    const d=await this.get(`/${type}/${id}`,{append_to_response:'external_ids',language:'en-US'});
    demand(d.id===id,'CATALOG_IDENTITY','Каталог вернул другую карточку.');
    return {...this.project(d,type),imdb:d.imdb_id||d.external_ids?.imdb_id||null,
      runtime:type==='movie'?d.runtime:null,overview:cut(d.overview,1800),homepage:d.homepage||null,
      seasons:(d.seasons||[]).filter(s=>s.season_number>0).map(s=>({number:s.season_number,count:s.episode_count,title:s.name}))};
  }
  async season(id,number){
    demand(Number.isSafeInteger(number)&&number>=1&&number<=100,'SEASON','Неверный сезон.');
    const s=await this.get(`/tv/${id}/season/${number}`,{language:'en-US'});
    demand(s.season_number===number&&(s.episodes||[]).length>0,'SEASON_IDENTITY','Состав сезона не подтверждён.');
    return {number,episodes:s.episodes.map(x=>({id:x.id,number:x.episode_number,title:x.name})),
      revision:s.episodes.map(x=>`${x.id}:${x.episode_number}`).join(',')};
  }
}
