// Synthetic protocol/lifecycle tests plus the research's actual torrent metadata.
// These are not evidence of live search, peers, audiovisual identity or iPhone.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import bencode from 'bencode';
import {WORKS,LIMITS,workQuery,streamId} from '../web/search-config.mjs';
import {parseMetadata,resolveFile,sha1,explicitFileAllowed} from '../web/torrent-metadata.mjs';
import {SearchAdapter,LocatorVault,normalizeStream} from '../web/source-search.mjs';
import {SearchSession,safeSearchResult} from '../web/search-session.mjs';
import {SearchBudget,CandidateProbe} from '../web/source-probe.mjs';
import {SourceError,requestBytes} from '../web/source-utils.mjs';
const configuration=JSON.parse(await readFile('web/search-fixtures/packages.json','utf8'));
const source={id:'synthetic-primary',label:'SYNTHETIC TEST',manifest:'https://fixture.invalid/manifest.json'};
const movie=workQuery(WORKS.find(w=>w.type==='movie'));
const manifest={id:'test',name:'SYNTHETIC',version:'1',types:['movie','series'],resources:['stream']};
const wrap=body=>({bytes:new TextEncoder().encode(JSON.stringify(body)),response:new Response('{}')});
const pause=()=>new Promise(r=>setTimeout(r,0));

test('24 exact IMDb queries and all 20 episode mappings resolve against full original file order and actual SHA-1',async()=>{
  assert.equal(WORKS.length,10);assert.equal(WORKS.reduce((n,w)=>n+(w.type==='movie'?1:w.seasons*2),0),24);
  assert.equal(configuration.mappings.length,20);assert.equal(configuration.packages.length,9);
  for(const row of configuration.mappings){
    const work=workQuery(WORKS.find(w=>w.key===row.title_key),row.season,row.episode);
    assert.equal(streamId(work),`${work.imdb}:${row.season}:${row.episode}`);
    for(const match of row.matches){
      const bytes=new Uint8Array(await readFile('web/'+configuration.packages.find(p=>p.infohash===match.infohash).fixture));
      const meta=await parseMetadata(bytes,match.infohash),selected=resolveFile(meta,work,0,configuration.mappings);
      assert.equal(selected.index,match.fileIdx);assert.equal(meta.files[match.fileIdx].length,match.length);
      assert.equal(explicitFileAllowed(meta,meta.files[match.fileIdx],work,configuration.mappings),true);
      if(work.type==='series')assert.equal(explicitFileAllowed(meta,meta.files[match.fileIdx],{...work,episode:work.episode===1?2:1},configuration.mappings),false);
      await assert.rejects(parseMetadata(bytes,'0'.repeat(40)),{code:'INFOHASH_MISMATCH'});
    }
  }
  const d1=configuration.mappings.find(m=>m.title_key==='dandadan' && m.season===1 && m.episode===1).matches[0];
  assert.equal(d1.fileIdx,19);assert.equal(configuration.mappings.find(m=>m.title_key==='dandadan' && m.season===2).matches[0].infohash,'ac90e5631f8d78d8932c167743386762369eb545');
});
test('ambiguous packages, wrong provider index and sample/bonus never choose the largest or adjacent episode',()=>{
  const meta={infoHash:'0'.repeat(40),files:[{fileIdx:0,path:'Show.S01E02.sample.mp4',length:999999,video:false},
    {fileIdx:1,path:'unknown.mkv',length:9999999,video:true},{fileIdx:2,path:'Show.S01E02.mkv',length:10,video:true}]};
  assert.equal(resolveFile(meta,workQuery(WORKS[0],1,1),1).index,null);
  assert.equal(resolveFile(meta,workQuery(WORKS[0],1,2),1).index,2);
  assert.equal(resolveFile(meta,movie,1).index,null);
  for(const [key,name] of [['deathnote','Death Note 2017 live action'],['shrek','Shrek 2 (2004)'],['hailmary','Project Hail Mary audiobook.epub']]){
    const c=normalizeStream({infoHash:'1'.repeat(40),name},workQuery(WORKS.find(w=>w.key===key)),source,new LocatorVault());assert.equal(c.identity.match,'rejected');
  }
  assert.equal(explicitFileAllowed({files:[]},{video:true,path:'Collection/Shrek.2.2004.mp4'},WORKS.find(w=>w.key==='shrek')),false);
});
test('fresh native Nyaa torrent snapshot retains all twelve files and independently resolves S01E02',async()=>{
  const config=JSON.parse(await readFile('web/search-fixtures/metadata-sources.json','utf8')),p=config.packages[0];
  const meta=await parseMetadata(new Uint8Array(await readFile('web/'+p.fixture)),p.infohash);
  assert.equal(meta.files.length,12);assert.equal(meta.files[1].length,1682464444);
  assert.equal(resolveFile(meta,workQuery(WORKS[0],1,2),99).index,1);
  assert.equal(meta.webseeds.length,0);assert.equal(p.dataMode,'developer-metadata-snapshot');
});
test('Stremio errors distinguish invalid manifest, configure, empty, JSON parse and 429; reserve only runs when needed',async()=>{
  for(const [response,code] of [[{streams:[]},'EMPTY_STREAMS'],[{streams:[{name:'Please configure addon',url:'https://fixture.invalid/notice.mp4'}]},'CONFIGURATION_NOTICE'],[{},'STREAMS_INVALID']]){
    const states=[],vault=new LocatorVault(),adapter=new SearchAdapter({vault,fetchBytes:async url=>wrap(url.includes('manifest')?manifest:response)});
    assert.equal((await adapter.search(source,movie,{signal:new AbortController().signal,onState:s=>states.push(s),onCandidates:()=>{throw Error('notice accepted');}})).fallback,true);
    assert.equal(states.at(-1).code,code);
  }
  for(const [body,code] of [[{},'MANIFEST_INVALID'],[{...manifest,behaviorHints:{configurationRequired:true}},'CONFIGURATION_REQUIRED']]){
    const states=[],adapter=new SearchAdapter({vault:new LocatorVault(),fetchBytes:async()=>wrap(body)});
    await adapter.search(source,movie,{signal:new AbortController().signal,onState:s=>states.push(s),onCandidates:()=>{}});assert.equal(states.at(-1).code,code);
  }
  const states=[];await new SearchAdapter({vault:new LocatorVault(),fetchBytes:async()=>{throw new SourceError('RATE_LIMIT',{httpStatus:429,retryAfter:120});}})
    .search({...source,id:'rate-test'},movie,{signal:new AbortController().signal,onState:s=>states.push(s),onCandidates:()=>{}});
  assert.equal(states.at(-1).retryAfter,120);
  let secondaryRequests=0;
  const adapter=new SearchAdapter({vault:new LocatorVault(),fetchBytes:async url=>{if(url.includes('secondary'))secondaryRequests++;return wrap(url.includes('manifest')?manifest:{streams:[{infoHash:'1'.repeat(40)}]});}});
  await adapter.primaryThenFallback(movie,{signal:new AbortController().signal,onState:()=>{},onCandidates:()=>{}},[source,{...source,id:'secondary',manifest:'https://secondary.invalid/manifest.json'}]);
  assert.equal(secondaryRequests,0);
});
test('native xs/as torrent hints stay in the private vault and must match the magnet before installing metadata',async()=>{
  const bytes=new Uint8Array(await readFile('web/fixtures/kadr-control-60s.torrent')),hash='05b36bedda4c62b73af236553176141c51912689';
  const vault=new LocatorVault(),c=normalizeStream({url:`magnet:?xt=urn:btih:${hash}&xs=${encodeURIComponent('https://fixture.invalid/native?token=CANARY_XS')}&as=${encodeURIComponent('http://insecure.invalid/a.torrent')}`},movie,source,vault);
  assert.deepEqual(vault.get(c).metadataURLs,['https://fixture.invalid/native?token=CANARY_XS']);
  assert.equal(vault.get(c).magnet,'magnet:?xt=urn:btih:'+hash);assert.ok(!JSON.stringify(safeSearchResult({candidates:[c]})).includes('CANARY_XS'));
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return new Response(bytes);};
  const probe=new CandidateProbe({candidate:c,vault,budget:new SearchBudget(),signal:new AbortController().signal,onChange:()=>{}});
  try{assert.equal((await probe.metadata()).infoHash,hash);assert.equal(requests,1);assert.equal(c.metadataProvenance.dataMode,'live-metadata');}
  finally{await probe.close();globalThis.fetch=original;}
  const wrong=normalizeStream({infoHash:'0'.repeat(40),sources:['https://fixture.invalid/a.torrent']},movie,source,vault);
  globalThis.fetch=async()=>new Response(bytes);
  const failed=new CandidateProbe({candidate:wrong,vault,budget:new SearchBudget(),signal:new AbortController().signal,onChange:()=>{}});
  try{assert.equal(await failed.metadata(),null);assert.equal(vault.get(wrong).meta,undefined);assert.equal(wrong.torrent.metadataHashVerified,false);}
  finally{await failed.close();globalThis.fetch=original;}
});
test('queue starts with first batch, deduplicates, runs exactly one probe, caps automatic count, and joins cancellation',async()=>{
  let active=0,peak=0,started=0,releases=[];
  const session=new SearchSession({work:movie,probeFactory:({signal})=>({run:async()=>{
    active++;started++;peak=Math.max(peak,active);await new Promise(resolve=>{releases.push(resolve);signal.addEventListener('abort',resolve,{once:true});});active--;
  }})});
  const c=n=>normalizeStream({infoHash:String(n).repeat(40)},movie,source,session.vault);
  session.add([c(1),c(1),c(2),c(3),c(4)]);assert.equal(session.run.candidates.length,4);assert.equal(started,1);
  releases.shift()();await pause();assert.equal(started,2);releases.shift()();await pause();releases.shift()();await pause();
  assert.equal(started,3);assert.equal(peak,1);assert.equal(active,0);
  await session.nextBatch();await pause();assert.equal(started,4);await session.cancel();assert.equal(active,0);assert.equal(session.vault.items.size,0);
  session.add([c(5)]);assert.equal(session.run.candidates.length,4);
});
test('probe payload budgets reserve requests, stop at a whole piece, and B verifies multifile offsets and hash',async()=>{
  const prefix=new Uint8Array([1,2,3,4,5]),media=new Uint8Array([6,7,8,9,10,11,12,13,14]),all=new Uint8Array([...prefix,...media]);
  const digests=[await sha1(all.subarray(0,8)),await sha1(all.subarray(8))];
  const pieces=Uint8Array.from(digests.join('').match(/../g),v=>parseInt(v,16));
  const bytes=bencode.encode({info:{name:'Pack','piece length':8,pieces,files:[{length:5,path:['readme.txt']},{length:9,path:['film.mp4']}]},'url-list':['https://fixture.invalid/']});
  const meta=await parseMetadata(bytes),vault=new LocatorVault(),candidate=normalizeStream({infoHash:meta.infoHash},movie,source,vault);
  Object.assign(vault.get(candidate),{meta,metadata:bytes});
  const original=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,opts)=>{
    requests.push({url,range:opts.headers.Range});const file=url.endsWith('readme.txt')?prefix:media;
    const [,a,b]=opts.headers.Range.match(/bytes=(\d+)-(\d+)/);return new Response(file.subarray(+a,+b+1),{status:206,headers:{'Content-Range':`bytes ${a}-${b}/${file.length}`}});
  };
  try{
    const budget=new SearchBudget({...LIMITS,payloadBytes:8}),probe=new CandidateProbe({candidate,vault,budget,signal:new AbortController().signal,onChange:()=>{}});
    await probe.run();assert.equal(candidate.states.B,'bytes-received');assert.equal(candidate.probe.verifiedBytes,8);
    assert.equal(candidate.probe.webrtcBytes,0);assert.equal(candidate.probe.httpBytes,8);assert.equal(requests.length,2);
    assert.equal(requests[0].range,'bytes=0-4');assert.equal(requests[1].range,'bytes=0-2');assert.throws(()=>budget.reserve(1),{code:'PAYLOAD_BUDGET'});
  }finally{globalThis.fetch=original;}
});
test('HTTP200 ignored Range is cancelled before reading large body; export never includes runtime signatures or tokens',async()=>{
  const original=globalThis.fetch;let cancelled=false;
  globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:200});
  try{await assert.rejects(requestBytes('https://fixture.invalid/',{max:16,range:true}),{code:'RANGE_NOT_206'});assert.equal(cancelled,true);}finally{globalThis.fetch=original;}
  const vault=new LocatorVault(),c=normalizeStream({url:'https://fixture.invalid/movie.mp4?token=CANARY_PRIVATE',description:'token=CANARY_PRIVATE https://fixture.invalid/?sig=CANARY_PRIVATE',behaviorHints:{proxyHeaders:{request:{Authorization:'CANARY_PRIVATE'}}}},movie,source,vault);
  const result=JSON.stringify(safeSearchResult({candidates:[c]}));assert.ok(!result.includes('CANARY_PRIVATE'));assert.ok(!result.includes('https://'));assert.equal(c.delivery.requiresHeaders[0],'Authorization');
});
