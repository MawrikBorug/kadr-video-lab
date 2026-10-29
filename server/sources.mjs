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
    // Prefer the LIVE TMDB crosswalk over a potentially stale Wiki search index.
    const direct=/^Q\d+$/.test(card.wikidata||'');
    const found=direct?{query:{search:[{title:card.wikidata}]}}:await this.json(wd,{action:'query',list:'search',srsearch:`haswbstatement:${prop}=${card.id}`,srlimit:'3'});
    const matches=[];
    for(const row of found.query?.search||[]){
      if(!/^Q\d+$/.test(row.title))continue;
      const e=await this.entity(row.title);
      const tmdbIds=e?.claims?.[prop]?.map(qvalue)||[],imdbIds=e?.claims?.P345?.map(qvalue)||[];
      if(direct&&tmdbIds.length&&!tmdbIds.some(x=>String(x)===String(card.id)))throw new Failure('SOURCE_IDENTITY_CONFLICT','TMDB и Wikidata связали разные карточки.');
      if(!tmdbIds.some(x=>String(x)===String(card.id))&&!(direct&&card.imdb&&imdbIds.includes(card.imdb)))continue;
      const imdb=e.claims.P345?.map(qvalue)||[];
      if(card.imdb&&imdb.length&&!imdb.includes(card.imdb))throw new Failure('SOURCE_IDENTITY_CONFLICT','IMDb в источнике не совпал с карточкой.');
      if(e.sitelinks?.enwiki)matches.push(e);
    }
    demand(matches.length<=1,'SOURCE_IDENTITY_AMBIGUOUS','Источники связали карточку с несколькими работами. Автоматический разбор остановлен.');
    if(matches.length===1)return matches[0];
    throw new Failure('NO_SOURCE','Не удалось связать источники с точной карточкой. Выдуманный разбор не создаётся.');
  }
  async seasonal(parent,number){
    const rel=(parent.claims.P527||[]).filter(x=>x.qualifiers?.P1545?.some(q=>String(q.datavalue?.value)===String(number)));
    const matches=[];
    for(const r of rel){
      const qid=qvalue(r)?.id;if(!qid)continue;
      const e=await this.entity(qid);
      const back=(e?.claims?.P179||[]).some(x=>qvalue(x)?.id===parent.id&&x.qualifiers?.P1545?.some(q=>String(q.datavalue?.value)===String(number)));
      if(back&&e.sitelinks?.enwiki&&!matches.some(x=>x.id===e.id))matches.push(e);
    }
    demand(matches.length<=1,'SEASON_SOURCE_AMBIGUOUS','Для сезона найдены конфликтующие источники. Автоматический разбор остановлен.');
    if(matches.length===1)return matches[0];
    throw new Failure('SEASON_SOURCE_IDENTITY','Отдельный источник этого сезона не подтверждён. Общая статья сериала не используется вместо него.');
  }
  async article(entity,season){
    const title=entity.sitelinks.enwiki.title;
    const identity=await this.json(wiki,{action:'query',prop:'pageprops',titles:title,redirects:1});
    const pages=Object.values(identity.query?.pages||{});
    demand(pages.length===1&&pages[0].pageprops?.wikibase_item===entity.id,'ARTICLE_IDENTITY','Статья не подтвердила точный идентификатор работы.');
    const p=await this.json(wiki,{action:'parse',page:title,prop:'text|sections|properties',disableeditsection:1});
    demand(p.parse&&!p.error,'WIKI_SOURCE','Статья временно недоступна.');
    const props=p.parse.properties||[];
    const sourceQ=props.find(x=>x.name==='wikibase_item')?.['*'];
    if(sourceQ)demand(sourceQ===entity.id,'ARTICLE_IDENTITY','Статья относится к другой работе.');
    const {document}=parseHTML(p.parse.text['*']);
    document.querySelectorAll('script,style,.navbox,.vertical-navbox,.reflist,.mw-references-wrap,sup,.reference,.noprint,table.infobox,.hatnote,.toc').forEach(x=>x.remove());
    const chunks=[],cast=[],episodePlots=[];let allow=true,skipLevel=null,excludedLevel=null,castLevel=null;
    for(const child of [...(document.querySelector('.mw-parser-output')||document.body).children]){
      const heading=/^H([1-6])$/.exec(child.tagName)||child.classList?.contains('mw-heading')&&/^H([1-6])$/.exec(child.querySelector('h1,h2,h3,h4,h5,h6')?.tagName||'');
      if(heading){
        const level=Number(heading[1]),name=child.textContent.trim();
        if(/^(?:Cast|Characters)/i.test(name))castLevel=level;
        else if(castLevel!==null&&level<=castLevel)castLevel=null;
        if(season&&future.test(name)){skipLevel=level;allow=false;continue;}
        if(skipLevel!==null){if(level>skipLevel)continue;skipLevel=null;}
        if(excludedLevel!==null){if(level>excludedLevel)continue;excludedLevel=null;}
        allow=!/^(?:References|External links|See also|Notes|Accolades|Reception|Release|Marketing|Ratings|Awards|Future)/i.test(name);
        if(!allow)excludedLevel=level;
        if(allow)chunks.push('\n'+name+'\n');continue;
      }
      if(!allow||skipLevel!==null)continue;
      if(castLevel!==null)for(const li of child.querySelectorAll('li')){
        const t=textOf(li).replace(/\[\d+\]/g,'');if(t.length>8&&t.length<700&&(!season||!future.test(t)))cast.push(t);
      }
      // A season article is separately identity-bound. Reject future-marked paragraphs.
      for(const node of child.matches('p')?[child]:child.querySelectorAll('p,td.description')){
        const t=node.textContent.replace(/\[\d+\]/g,'').replace(/\s+/g,' ').trim();
        if(node.tagName==='P'&&node.closest('td.description'))continue;
        if(t.length>45&&(!season||!future.test(t))){if(season&&node.matches('td.description'))episodePlots.push(t);else chunks.push(t);}
      }
    }
    let text=chunks.join('\n');const castText=words(cast.join('\n'),140);
    demand(text.length>300,'SOURCE_TEXT_EMPTY','Не удалось получить содержательные материалы.');
    // Plot/episode content precedes production. Explicit limit, never silently claims full coverage.
    const totalWords=(text+' '+castText+' '+episodePlots.join(' ')).split(/\s+/).length;
    if(season){
      demand(episodePlots.length>0,'SEASON_PLOT_MISSING','В источнике нет сюжетных описаний основных серий.');
      const plots=episodePlots.map((t,i)=>`Episode ${i+1}: ${t}`).join('\n');
      const reserved=(plots+' '+castText).split(/\s+/).length+6;
      demand(reserved<1500,'SEASON_PLOT_BUDGET','Полные сюжеты серий не помещаются в безопасный запрос. Финал не обрезается и разбор не создаётся.');
      text='Episodes\n'+plots+'\nCast and characters\n'+castText+'\nBackground and production\n'+words(text,1500-reserved);
    }else text=words(text,1500-castText.split(/\s+/).length)+'\nCast and characters\n'+castText;
    const truncated=totalWords>1500;
    return {id:'W1',title,source:'https://en.wikipedia.org/wiki/'+encodeURIComponent(title.replaceAll(' ','_')),
      text,hash:digest(p.parse.text['*']),rights:'Wikipedia contributors, CC BY-SA',truncated,episodeCount:season?episodePlots.length:null};
  }
  async publicHTML(source){
    let target=source,r;
    for(let redirects=0;redirects<3;redirects++){
      r=await fetch(target,{headers:{'User-Agent':USER_AGENT,Accept:'text/html'},signal:AbortSignal.any([this.signal,AbortSignal.timeout(18000)]),redirect:'manual'});
      if(![301,302,303,307,308].includes(r.status))break;
      const next=new URL(r.headers.get('location'),target);
      demand(next.protocol==='https:'&&next.origin===new URL(source).origin,'SOURCE_REDIRECT','Официальный источник перенаправил на другой домен.');target=next.href;
    }
    demand(r.ok,'OFFICIAL_SOURCE_HTTP',`Официальный источник ${new URL(source).hostname} временно недоступен (HTTP ${r.status}).`,502);
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
      const {document:ad}=parseHTML(a.html);ad.querySelectorAll('script,style,nav,footer,.related-content').forEach(x=>x.remove());
      let allowed=true,skipLevel=null,visual=false;const paragraphs=[],visuals=[];
      for(const node of ad.querySelectorAll('h1,h2,h3,h4,p,div.contentItem-role-text')){
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
    if(season)demand(article.episodeCount===season.episodes.length,'SEASON_PLOT_COVERAGE','Источник не содержит сюжет всех подтверждённых основных серий. Неполный разбор не создаётся.');
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
      // These adapters retrieve plot and production prose, not independently observed shots.
      documents:docs,visualEvidenceIds:[],references:[...docs.map(x=>({id:x.id,title:x.title,url:x.source,hash:x.hash||null,rights:x.rights})),...(season?finality.references:[])],
      limitations:['Источники получены автоматически; визуальные выводы допустимы только при явном свидетельстве. Сами кадры поиска не являются просмотром всего фильма.',...(article.truncated?['Объём статьи ограничен 1500 словами; пробелы должны быть явно обозначены.']:[])]};
  }
}
