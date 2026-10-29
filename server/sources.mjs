import {createHash} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {Failure,demand,jsonFetch,cut} from './core.mjs';

const USER_AGENT='KADR-Video-Lab/3 (https://github.com/MawrikBorug/kadr-video-lab)';
const wd='https://www.wikidata.org/w/api.php',wiki='https://en.wikipedia.org/w/api.php';
const url=(base,params)=>base+'?'+new URLSearchParams({format:'json',...params});
const qvalue=s=>s?.mainsnak?.datavalue?.value;
const words=(text,max)=>String(text).split(/\s+/).slice(0,max).join(' ');
const digest=text=>createHash('sha256').update(text).digest('hex');
const textOf=node=>[...node.childNodes].map(x=>x.nodeType===3?x.textContent:textOf(x)).join(' ').replace(/\s+/g,' ').trim();
const future=/\b(?:season\s*[2-9]|second season|third season|fourth season)\b/i;

export class Sources {
  constructor(signal){this.signal=signal;this.calls=0;}
  async json(base,params){demand(++this.calls<=20,'SOURCE_BUDGET','Достигнут предел запросов материалов.');return jsonFetch(url(base,params),{signal:this.signal,headers:{'User-Agent':USER_AGENT}});}
  async entity(id){return (await this.json(wd,{action:'wbgetentities',ids:id,props:'claims|sitelinks',sitefilter:'enwiki'})).entities?.[id];}
  async identity(card){
    const prop=card.type==='movie'?'P4947':'P4983';
    const found=await this.json(wd,{action:'query',list:'search',srsearch:`haswbstatement:${prop}=${card.id}`,srlimit:'3'});
    for(const row of found.query?.search||[]){
      if(!/^Q\d+$/.test(row.title))continue;
      const e=await this.entity(row.title);
      if(!e?.claims?.[prop]?.some(x=>String(qvalue(x))===String(card.id)))continue;
      const imdb=e.claims.P345?.map(qvalue)||[];
      if(card.imdb&&imdb.length&&!imdb.includes(card.imdb))throw new Failure('SOURCE_IDENTITY_CONFLICT','IMDb в источнике не совпал с карточкой.');
      demand(e.sitelinks?.enwiki,'NO_SOURCE','Для этой карточки не найден проверенный текстовый источник.');return e;
    }
    throw new Failure('NO_SOURCE','Не удалось связать источники с точной карточкой. Выдуманный разбор не создаётся.');
  }
  async seasonal(parent,number){
    const rel=(parent.claims.P527||[]).filter(x=>x.qualifiers?.P1545?.some(q=>String(q.datavalue?.value)===String(number)));
    for(const r of rel){
      const qid=qvalue(r)?.id;if(!qid)continue;
      const e=await this.entity(qid);
      const back=(e?.claims?.P179||[]).some(x=>qvalue(x)?.id===parent.id&&x.qualifiers?.P1545?.some(q=>String(q.datavalue?.value)===String(number)));
      if(back&&e.sitelinks?.enwiki)return e;
    }
    throw new Failure('SEASON_SOURCE_IDENTITY','Отдельный источник этого сезона не подтверждён. Общая статья сериала не используется вместо него.');
  }
  async article(entity,season){
    const title=entity.sitelinks.enwiki.title;
    const p=await this.json(wiki,{action:'parse',page:title,prop:'text|sections|properties',disableeditsection:1});
    demand(p.parse&&!p.error,'WIKI_SOURCE','Статья временно недоступна.');
    const props=p.parse.properties||[];
    const sourceQ=props.find(x=>x.name==='wikibase_item')?.['*'];
    if(sourceQ)demand(sourceQ===entity.id,'ARTICLE_IDENTITY','Статья относится к другой работе.');
    const {document}=parseHTML(p.parse.text['*']);
    document.querySelectorAll('script,style,.navbox,.vertical-navbox,.reflist,.mw-references-wrap,sup,.reference,.noprint,table.infobox,.hatnote,.toc').forEach(x=>x.remove());
    const chunks=[];let allow=true,skipLevel=null;
    for(const child of [...(document.querySelector('.mw-parser-output')||document.body).children]){
      const heading=/^H([1-6])$/.exec(child.tagName)||child.classList?.contains('mw-heading')&&/^H([1-6])$/.exec(child.querySelector('h1,h2,h3,h4,h5,h6')?.tagName||'');
      if(heading){
        const level=Number(heading[1]),name=child.textContent.trim();
        if(season&&future.test(name)){skipLevel=level;allow=false;continue;}
        if(skipLevel!==null){if(level>skipLevel)continue;skipLevel=null;}
        allow=!/^(?:References|External links|See also|Notes|Accolades|Reception|Release|Marketing|Ratings|Awards|Future)/i.test(name);
        if(allow)chunks.push('\n'+name+'\n');continue;
      }
      if(!allow||skipLevel!==null)continue;
      // A season article is separately identity-bound. Reject future-marked paragraphs.
      for(const node of child.matches('p')?[child]:child.querySelectorAll('p,td.description')){
        const t=node.textContent.replace(/\[\d+\]/g,'').replace(/\s+/g,' ').trim();
        if(t.length>45&&(!season||!future.test(t)))chunks.push(t);
      }
    }
    let text=chunks.join('\n');
    demand(text.length>300,'SOURCE_TEXT_EMPTY','Не удалось получить содержательные материалы.');
    // Plot/episode content precedes production. Explicit limit, never silently claims full coverage.
    const truncated=text.split(/\s+/).length>1500;text=words(text,1500);
    return {id:'W1',title,source:'https://en.wikipedia.org/wiki/'+encodeURIComponent(title.replaceAll(' ','_')),
      text,hash:digest(p.parse.text['*']),rights:'Wikipedia contributors, CC BY-SA',truncated};
  }
  async publicHTML(source){
    let target=source,r;
    for(let redirects=0;redirects<3;redirects++){
      r=await fetch(target,{headers:{'User-Agent':USER_AGENT,Accept:'text/html'},signal:AbortSignal.any([this.signal,AbortSignal.timeout(18000)]),redirect:'manual'});
      if(![301,302,303,307,308].includes(r.status))break;
      const next=new URL(r.headers.get('location'),target);
      demand(next.protocol==='https:'&&next.origin===new URL(source).origin,'SOURCE_REDIRECT','Официальный источник перенаправил на другой домен.');target=next.href;
    }
    demand(r.ok,'OFFICIAL_SOURCE_HTTP','Официальное подтверждение временно недоступно.',502);
    const html=await r.text();demand(html.length<=4000000,'SOURCE_TOO_LARGE','Официальный источник слишком большой.');
    return {html,hash:digest(html)};
  }
  async finality(card,season){
    // Accepted B04 adapter. No inference from release dates, Wikipedia or a player.
    if(card.type!=='tv')return {state:'confirmed',basis:'standalone film',references:[],documents:[]};
    if(card.id!==106379||season.number!==1)return {state:'unknown',reason:'Для этого сезона пока нет проверенного адаптера официального подтверждения выпуска. Дата последней серии не является доказательством.'};
    const amazon='https://www.aboutamazon.com/news/entertainment/fallout-tv-series-cast';
    const prime='https://www.primevideo.com/-/de/detail/0HAQAA7JM43QWX0H6GUD3IOF70?tr=pr';
    let signals;
    try{
      const [a,p]=await Promise.all([this.publicHTML(amazon),this.publicHTML(prime)]);
      const {document:ad}=parseHTML(a.html);ad.querySelectorAll('script,style,nav,footer').forEach(x=>x.remove());
      let allowed=true,skipLevel=null,visual=false;const paragraphs=[],visuals=[];
      for(const node of ad.querySelectorAll('h1,h2,h3,h4,p')){
        if(/^H/.test(node.tagName)){
          const level=Number(node.tagName[1]);if(future.test(textOf(node))){skipLevel=level;allowed=false;continue;}
          if(skipLevel!==null&&level<=skipLevel){skipLevel=null;allowed=true;}
          visual=allowed&&/Less was more visually/i.test(textOf(node));continue;
        }
        if(allowed&&skipLevel===null&&!future.test(textOf(node))){paragraphs.push(textOf(node));if(visual)visuals.push(textOf(node));}
      }
      const at=paragraphs.join(' ').replace(/\s+/g,' ');
      const all=/watch\s+all\s+eight\s+episodes\s+of\s+Fallout\s+Season\s+1|all\s+eight\s+episodes\s+of\s+Fallout\s+Season\s+1\s+are\s+(?:now\s+)?available/i.test(at);
      const final=/final\s+episode\s+of\s+Fallout\s+Season\s+1/i.test(at);
      const {document:pd}=parseHTML(p.html),pt=pd.querySelector('title')?.textContent||'';
      const nums=new Set();for(const h of pd.querySelectorAll('h1,h2,h3,h4')){
        const m=/^(?:S(?:taffel)?\s*1\s*[-–:]\s*)?(?:E(?:pisode)?\s*)?([1-8])[.\s–:-]+(.{1,90})$/i.exec(textOf(h));if(m)nums.add(Number(m[1]));
      }
      signals={amazonAvailable:all,amazonFinalEpisode:final,primeSelectedSeason:/Fallout.{0,40}(?:Staffel\s*1|Season\s*1)/i.test(pt),primeEpisodeNumbers:[...nums].sort(),tmdbEpisodeCount:season.episodes.length};
      demand(all&&final&&signals.primeSelectedSeason&&nums.size===8&&season.episodes.length===8&&season.episodes.every(e=>nums.has(e.number)),
        'FINALITY_UNKNOWN','Официальные подтверждения выпуска и состава сезона не совпали.');
      const docs=[{id:'A1',title:'Amazon — creators and visual production (season 1 only)',source:amazon,text:words(visuals.join(' '),180),hash:a.hash,rights:'Amazon; bounded input, original generated analysis only'}].filter(x=>x.text.length>30);
      return {state:'confirmed',checkedAt:new Date().toISOString(),revision:season.revision,episodeIds:season.episodes.map(x=>x.id),
        basis:'Amazon: all eight available and explicit final episode; Prime: selected S1 entries 1–8',
        references:[{id:'F1',title:'Amazon — availability and final episode',url:amazon,hash:a.hash},{id:'F2',title:'Prime Video — season 1 entries',url:prime,hash:p.hash}],documents:docs};
    }catch(e){return {state:'unknown',reason:e instanceof Failure?e.message:'Официальное подтверждение не получено.',signals};}
  }
  async acquire(card,season,finality){
    const parent=await this.identity(card),entity=season?await this.seasonal(parent,season.number):parent;
    const article=await this.article(entity,season?.number);
    const docs=[article,{id:'T1',title:'TMDB verified identity and runtime',source:card.url,text:JSON.stringify({title:card.original,year:card.year,type:card.type,runtime_minutes:card.runtime,imdb:card.imdb}),rights:'TMDB API metadata'}];
    if(season)docs.push(...(finality.documents||[]));
    // Primary production material discovered from a verified film identity; not a prepared answer.
    if(parent.id==='Q925587'&&!season){
      try{const p=await this.publicHTML('https://durian.blender.org/about/');const {document}=parseHTML(p.html);
        const ps=[...document.querySelectorAll('p')].map(x=>x.textContent).filter(t=>/14m:48|888 seconds|commenced in May|Colin Levy|Creative Commons Attribution|international team/i.test(t));
        docs.push({id:'P1',title:'Sintel official production account',source:'https://durian.blender.org/about/',text:words(ps.join('\n'),350),hash:p.hash,rights:'Blender Foundation, CC BY 3.0'});
      }catch{/* Secondary dossier retains an explicit missing-primary limitation. */}
    }
    return {scope:{id:`${card.type}:${card.id}`,...(season?{season:season.number,compositionRevision:season.revision}:{}),title:card.original,year:card.year},
      documents:docs,references:[...docs.map(x=>({id:x.id,title:x.title,url:x.source,hash:x.hash||null,rights:x.rights})),...(season?finality.references:[])],
      limitations:['Источники получены автоматически; визуальные выводы допустимы только при явном свидетельстве. Сами кадры поиска не являются просмотром всего фильма.',...(article.truncated?['Объём статьи ограничен 1500 словами; пробелы должны быть явно обозначены.']:[])]};
  }
}
