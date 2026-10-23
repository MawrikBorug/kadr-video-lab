// Public instances selected by the 2026-10-23 research; no credentials or SLA.
export const SEARCH_SOURCES = Object.freeze([
  {id:'comet', label:'Comet · comet.feels.legal', adapter:'stremio', manifest:'https://comet.feels.legal/manifest.json'},
  {id:'torrentsdb', label:'TorrentsDB · torrentsdb.com', adapter:'stremio', manifest:'https://torrentsdb.com/manifest.json'},
]);
export const LIMITS = Object.freeze({candidates:3, concurrency:1, candidateMs:20000, queueMs:60000,
  payloadBytes:16*1024*1024, metadataBytes:1024*1024, metadataTotalBytes:4*1024*1024,
  searchResponseBytes:12*1024*1024, searchTotalBytes:24*1024*1024, requestMs:15000,
  metadataRequestMs:6000, maxResults:400, maxFiles:10000, blockBytes:16384});
export const WORKS = Object.freeze([
  ['dandadan','Дандадан','Dandadan','tt30217403',2024,'series',76436,2],
  ['frieren','Фрирен','Frieren: Beyond Journey’s End','tt22248376',2023,'series',68777,2],
  ['deathnote','Тетрадь смерти, аниме 2006','Death Note','tt0877057',2006,'series',2087,1],
  ['interstellar','Интерстеллар','Interstellar','tt0816692',2014,'movie',180,0],
  ['fallout','Фаллаут, сериал','Fallout','tt12637874',2024,'series',70403,2],
  ['breakingbad','Во все тяжкие','Breaking Bad','tt0903747',2008,'series',255,2],
  ['spiderman','Человек-паук: Вдали от дома','Spider-Man: Far from Home','tt6320628',2019,'movie',5784,0],
  ['hailmary','Проект «Аве Мария»','Project Hail Mary','tt12042730',2026,'movie',87181,0],
  ['shrek','Шрек, первый фильм 2001','Shrek','tt0126029',2001,'movie',2209,0],
  ['slovo','Слово пацана. Кровь на асфальте','The Boy’s Word: Blood on the Asphalt','tt28429213',2023,'series',69530,1],
].map(([key,ru,title,imdb,year,type,liftId,seasons])=>({key,ru,title,imdb,year,type,liftId,seasons})));
export function workQuery(work,season=1,episode=1) {
  return {...work,season:work.type==='series'?Number(season):null,episode:work.type==='series'?Number(episode):null};
}
export const streamId = work => work.type==='series'?`${work.imdb}:${work.season}:${work.episode}`:work.imdb;
