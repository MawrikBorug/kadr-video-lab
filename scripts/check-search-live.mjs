// Real browser verification. No HAR/trace, raw responses, media bodies, peer IPs,
// SDP, cookies, Authorization values or signed URLs are written to evidence.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base=process.env.PUBLISHED_URL || 'https://mawrikborug.github.io/kadr-video-lab/';
const output=(process.env.SEARCH_EVIDENCE_DIR || '/workspace/search-evidence')+'/'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+randomUUID();
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  ...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{})});
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const errors=[],network=[],websockets=[];
page.on('pageerror',e=>errors.push({name:e.name,message:e.message.replace(/https?:\/\/\S+/g,'[URL]').slice(0,200)}));
page.on('requestfailed',r=>{if(network.length<100)network.push({host:new URL(r.url()).host,reason:r.failure()?.errorText});});
page.on('websocket',ws=>websockets.push({host:new URL(ws.url()).host}));
const save=(name,value)=>writeFile(output+'/'+name+'.json',JSON.stringify(value,null,2)+'\n');
const searchJournal=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.search.v1')));
const oldJournal=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.experiments.v1')));
const waitLegacy=()=>page.waitForFunction(()=>!document.querySelector('#connection').disabled && !document.querySelector('#material').disabled);
try{
 await page.goto(base,{waitUntil:'networkidle',timeout:30000});await page.waitForFunction(()=>!document.querySelector('#search-start').disabled);
 const build=await page.evaluate(async()=>await(await fetch('./build-info.json',{cache:'no-store'})).json());
 if(build.version!=='search-2' || (process.env.GITHUB_SHA && build.commit!==process.env.GITHUB_SHA))throw Error('wrong_build');
 await save('build',{build,base,utc:new Date().toISOString(),scope:'Actual app; managed Chromium, not iPhone Safari/PWA'});console.log('Build',build.version,build.commit);
 const works=await page.evaluate(async()=>{const {WORKS}=await import('./search-config.mjs');return WORKS;});
 const matrix=[];
 for(const sourceId of ['comet','torrentsdb']){
  let blocked=false;
  for(const w of works)for(const [season,episode] of w.type==='movie'?[[null,null]]:Array.from({length:w.seasons*2},(_,i)=>[Math.floor(i/2)+1,i%2+1])){
   if(blocked){matrix.push({sourceId,imdb:w.imdb,season,episode,status:'NOT_RUN_AFTER_RATE_LIMIT'});continue;}
   const row=await page.evaluate(async({sourceId,key,season,episode})=>{
    const {SEARCH_SOURCES,WORKS,workQuery}=await import('./search-config.mjs'),{SearchAdapter,LocatorVault}=await import('./source-search.mjs');
    const source=SEARCH_SOURCES.find(s=>s.id===sourceId),work=workQuery(WORKS.find(w=>w.key===key),season,episode),vault=new LocatorVault();
    const states=[],samples=[];let count=0;
    const result=await new SearchAdapter({vault}).search(source,work,{signal:new AbortController().signal,onState:s=>states.push(s),onCandidates:cs=>{
      count+=cs.length;for(const c of cs)if(samples.length<3)samples.push({infoHash:c.torrent.infoHash,fileIdx:c.torrent.fileIdx,release:c.identity.rawReleaseTitle,kind:c.delivery.kind,claims:c.claims});
    }});vault.clear();return {sourceId,work,count,samples,record:result.record,states};
   },{sourceId,key:w.key,season,episode});
   matrix.push(row);await save('matrix',matrix);console.log('Live query',sourceId,w.key,season,episode,row.count,row.record.code || row.record.state);
   if(['RATE_LIMIT','RATE_LIMIT_COOLDOWN'].includes(row.record.code))blocked=true;
  }
 }
 const identities=[];
 for(const w of works){
  const row=await page.evaluate(async w=>{try{
   const r=await fetch(`https://v3-cinemeta.strem.io/meta/${w.type}/${w.imdb}.json`,{credentials:'omit',signal:AbortSignal.timeout(12000)}),b=await r.json();
   return {imdb:w.imdb,type:w.type,status:r.status,id:b.meta?.id,name:b.meta?.name,year:b.meta?.releaseInfo,browserCors:'readable'};
  }catch(e){return {imdb:w.imdb,type:w.type,error:e.name};}},w);identities.push(row);
 }await save('identities',identities);console.log('Identity metadata',identities.length);
 await page.selectOption('#search-work','dandadan');await page.selectOption('#search-episode','2');await page.click('#search-start');
 await page.waitForFunction(()=>{const j=JSON.parse(localStorage.getItem('kadr.videoLab.search.v1'));const r=j?.runs.at(-1);return r?.candidates?.length || r?.searchState==='finished';},null,{timeout:35000});
 console.log('Automatic probe queue started');
 await page.waitForFunction(()=>{const j=JSON.parse(localStorage.getItem('kadr.videoLab.search.v1'));const r=j?.runs.at(-1);return r?.searchState==='finished' && ['batch-complete','time-limit','stopped'].includes(r.queueState);},null,{timeout:75000});
 await save('automatic-search',await searchJournal());await page.screenshot({path:output+'/search.png',fullPage:true});console.log('Automatic probe queue finished');
 await page.locator('details').filter({has:page.locator('#search-supplements')}).evaluate(el=>el.open=true);await page.click('#search-supplements');
 await page.waitForFunction(()=>document.querySelector('#search-supplement-status').textContent.includes('nyaa'),null,{timeout:30000});
 await save('supplements',{status:await page.locator('#search-supplement-status').textContent(),journal:await searchJournal()});
 await page.selectOption('#connection','lift');await waitLegacy();
 const catalog=await page.evaluate(async()=>await(await fetch('./catalog.json')).json()),lift=[];
 for(const item of catalog.filter(x=>x.ownerSample)){
  await page.selectOption('#material',String(item.id));await waitLegacy();await page.click('#catalog-test');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Каталожная проверка завершена') || document.querySelector('#frame-state').textContent.includes('Отказ'),null,{timeout:30000});
  const run=(await oldJournal()).runs.at(-1);lift.push({subject:run.subject,catalog:run.catalog,apiErrors:run.events.filter(e=>e.kind==='api_error'),iframeCount:await page.locator('iframe').count()});
 }
 await save('lift-catalogue',lift);console.log('Lift catalogue',lift.length);
 await page.selectOption('#material','76436');await waitLegacy();await page.click('#start');await page.waitForFunction(()=>!document.querySelector('#start').disabled,null,{timeout:30000});
 await page.waitForTimeout(2000);await save('lift-native',{iframeMounted:await page.locator('iframe').count(),run:(await oldJournal()).runs.at(-1),claim:'Iframe load/messages are not playback; 60-second/resume issues not declared fixed'});
 await page.click('#stop');
 await page.selectOption('#connection','wt-http');await waitLegacy();await page.selectOption('#material','kadr-control');await waitLegacy();await page.click('#start');
 await page.waitForFunction(()=>document.querySelector('video').readyState>=1,null,{timeout:30000});await page.locator('video').evaluate(v=>v.play());
 await page.waitForFunction(()=>document.querySelector('video').currentTime>.5);await page.locator('video').evaluate(v=>{v.currentTime=45;});
 await page.waitForFunction(()=>document.querySelector('video').currentTime>=45 && !document.querySelector('video').seeking,null,{timeout:25000});
 const before=(await oldJournal()).runs.at(-1),uri=await page.locator('video').getAttribute('src');
 await page.click('#reload');await page.waitForFunction(()=>document.querySelector('video').readyState>=1,null,{timeout:30000});await page.click('#restore-position');
 await page.waitForFunction(()=>document.querySelector('video').currentTime>=45 && !document.querySelector('video').seeking,null,{timeout:25000});
 const restored=(await oldJournal()).runs.at(-1),freshURL=(await page.locator('video').getAttribute('src'))!==uri;
 await page.locator('video').evaluate(async v=>{v.currentTime=58;await v.play();});
 await page.waitForFunction(()=>document.querySelector('video').ended,null,{timeout:25000});
 const ended=(await oldJournal()).runs.at(-1);
 await save('B-control',{scope:'Real published owned control, not the searched title',before,restored,freshURL,ended,
   truePlaying:before.events.some(e=>e.kind==='native_video' && e.event==='playing' && e.trusted),
   emptyPieceSeek:before.events.some(e=>e.kind==='media_range_request' && e.afterSeek && e.firstPieceHadNoBytes),
   nativeEnded:ended.events.some(e=>e.kind==='native_video' && e.event==='ended' && e.trusted)});
 await page.click('#stop');console.log('Published B control playing / seek / restore / ended');
 await save('summary',{build,base,utc:new Date().toISOString(),queries:matrix.length,errors,network,websockets,physicalIPhone:'NOT_RUN',Safari:'NOT_RUN',PWA:'NOT_RUN'});
 console.log('Evidence',output);
}catch(e){await save('interrupted',{error:e.message.replace(/https?:\/\/\S+/g,'[URL]').slice(0,400),errors,network,physicalIPhone:'NOT_RUN'});throw e;}
finally{await context.close();await browser.close();}
