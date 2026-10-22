// Real browser probe. No HAR/trace, signed URLs, peer addresses, SDP, cross-origin DOM,
// Node torrent client, media proxy, or unlicensed media sessions are used.
import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {safeDiagnostic} from '../web/collector.mjs';
const base=process.env.PUBLISHED_URL || 'https://mawrikborug.github.io/kadr-video-lab/';
const output=process.env.LIFT_EVIDENCE_DIR || '/workspace/scratch/expanded-live';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
  ...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const page=await context.newPage();const errors=[],api=[],sockets=[],failures=[];
const pending=[];
page.on('pageerror',e=>errors.push({message:safeDiagnostic(e.message),
  sourceOrigins:[...new Set((e.stack?.match(/https?:\/\/[^\s)]+/g)||[]).map(url=>{try{return new URL(url).origin;}catch{return 'unknown';}}))]}));
page.on('requestfailed',r=>failures.push({origin:new URL(r.url()).origin,reason:safeDiagnostic(r.failure()?.errorText)}));
page.on('websocket',s=>sockets.push(new URL(s.url()).origin));
page.on('response',r=>{if(r.url().startsWith('https://api.liftw.ws/info/'))pending.push((async()=>{
  api.push({id:Number(new URL(r.url()).pathname.split('/').at(-1)),status:r.status(),origin:(await r.request().allHeaders()).origin,acao:await r.headerValue('access-control-allow-origin')});
})());});
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.experiments.v1')));
const current=async()=>(await state()).runs.at(-1);
const selection=()=>page.waitForFunction(()=>!document.querySelector('#connection').disabled && !document.querySelector('#material').disabled);
const save=(name,value)=>writeFile(`${output}/KADR_LIFT_STAND_EXPANSION_${name}.json`,JSON.stringify(value,null,2)+'\n');
let seed=null,nativeUrl=null;
try {
  await page.goto(base,{waitUntil:'networkidle',timeout:30000});await selection();
  const build=await page.evaluate(async()=>{const r=await fetch('./build-info.json',{cache:'no-store'});return r.json();});
  if(process.env.GITHUB_SHA && build.commit!==process.env.GITHUB_SHA)throw Error('published_commit_mismatch');
  await page.click('#start');await page.waitForFunction(()=>!document.querySelector('#start').disabled,{timeout:30000});await page.waitForTimeout(4000);
  if(await page.locator('iframe').count()){nativeUrl=await page.locator('iframe').getAttribute('src');await page.click('#ping');await page.waitForTimeout(1000);}
  const lift=await current();await save('lift',{scope:'Real Lift iframe session in cloud Chromium; not phone',build,run:lift});
  const catalogue=[];
  for(const id of [2087,13324,255,354,180,474]){
    await page.selectOption('#material',String(id));await selection();await page.click('#catalog-test');
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Каталожная проверка завершена') || document.querySelector('#frame-state').textContent.includes('Отказ'),{timeout:30000});
    const run=await current();if(await page.locator('iframe').count())throw Error('protected_catalogue_iframe_was_mounted');
    catalogue.push(run);await save('catalogue',{scope:'Real browser CORS metadata requests; protected works have no media session',build,runs:catalogue});
  }
  await save('catalogue',{scope:'Real browser CORS metadata requests; six protected works have no media session',build,runs:catalogue});
  // A temporary developer seeder in a plain same-origin document writes no app journal.
  // Store directories are fresh and distinct, so it cannot supply cached pieces to the viewer.
  seed=await context.newPage();await seed.goto(new URL('fixtures/README.txt',base).href);
  await seed.evaluate(async base=>{
    const {startDeveloperSeeder}=await import(base+'torrent.mjs');const {TORRENT_MATERIALS}=await import(base+'torrent-materials.js');
    const material=TORRENT_MATERIALS.find(item=>item.id==='kadr-control');
    window.qaTemporarySeeder=await startDeveloperSeeder({...material,seedFile:new URL(material.seedFile,base).href},text=>{window.qaSeedStatus=text;});
  },base);
  await page.selectOption('#connection','wt-webrtc');await selection();await page.selectOption('#material','kadr-control');await selection();await page.click('#start');
  let rtcPlayback=false;
  try {
    await page.waitForFunction(()=>document.querySelector('video').readyState>=1,{timeout:55000});
    await page.click('video');await page.locator('video').evaluate(v=>v.play());
    await page.waitForFunction(()=>document.querySelector('video').currentTime>0.5,{timeout:12000});rtcPlayback=true;
    await page.locator('video').evaluate(v=>{v.currentTime=45});
    await page.waitForFunction(()=>document.querySelector('video').currentTime>=45 && !document.querySelector('video').seeking,{timeout:15000});
  }catch(error){await page.selectOption('#note','other_error');await page.fill('#diagnostic','Контролируемая WebRTC-проба: '+safeDiagnostic(error.name));await page.click('#mark');}
  const rtc=await current();
  const rtcProof=rtcPlayback && rtc.transport?.webRTCBytes>0 && rtc.transport?.httpBytes===0 && rtc.transport?.preexistingBytesAtReady===0;
  const seedStatus=await seed.evaluate(()=>window.qaSeedStatus || 'not ready');
  await save('webrtc',{build,scope:'Controlled browser seeder dependency; not autonomous public swarms',rtcProof,seedStatus,run:rtc});
  await seed.evaluate(()=>new Promise(resolve=>window.qaTemporarySeeder.destroy(resolve)));await seed.close();seed=null;
  await page.selectOption('#connection','wt-http');await selection();await page.click('#start');
  await page.waitForFunction(()=>document.querySelector('video').readyState>=1,{timeout:35000});
  await page.click('video');await page.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video').currentTime>0.5,{timeout:12000});
  await page.locator('video').evaluate(v=>{v.currentTime=700});
  await page.waitForFunction(()=>document.querySelector('video').currentTime>=700 && !document.querySelector('video').seeking,{timeout:20000});
  await context.setOffline(true);await page.locator('video').evaluate(v=>{v.currentTime=500});await page.waitForTimeout(3500);await context.setOffline(false);
  let automaticRecovery=false;
  try {await page.waitForFunction(()=>document.querySelector('video').currentTime>500.2 && !document.querySelector('video').seeking,{timeout:25000});automaticRecovery=true;}catch{}
  const beforeReload=await current();const restoreTarget=beforeReload.lastPosition?.time;
  const beforeStream=await page.locator('video').getAttribute('src');
  await page.click('#reload');await page.waitForFunction(()=>document.querySelector('video').readyState>=1,{timeout:35000});
  if(await page.locator('video').getAttribute('src')===beforeStream)throw Error('media URL not isolated across reload');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kadr.videoLab.experiments.v1')).runs.at(-1).transport.httpBytes>0,{timeout:15000});
  if(restoreTarget){await page.click('#restore-position');await page.waitForFunction(t=>Math.abs(document.querySelector('video').currentTime-t)<1 && !document.querySelector('video').seeking,restoreTarget,{timeout:20000});}
  const http=await current();
  if(http.transport?.webRTCBytes!==0 || !http.events.some(e=>e.kind==='native_video' && e.event==='playing' && e.beforeFull===true))throw Error('HTTP transport/playback assertion failed');
  await save('http',{build,scope:'Real external public WebTorrent HTTP webseed, not P2P',automaticRecovery,restoreTarget,
    beforeReloadTransport:beforeReload.transport,reloadTransport:http.transport,run:http});
  await page.screenshot({path:`${output}/KADR_LIFT_STAND_EXPANSION_http.png`,fullPage:true});
  await page.click('#stop');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Источник закрыт'));
  await page.click('#compare');
  const download=page.waitForEvent('download');await page.click('#export');const text=await readFile(await (await download).path(),'utf8');
  if(nativeUrl && (text.includes(nativeUrl) || [...new URL(nativeUrl).searchParams.values()].some(value=>value.length>12 && text.includes(value))))throw Error('signed URL value leaked');
  await writeFile(`${output}/KADR_LIFT_STAND_EXPANSION_export.json`,text);
  await page.reload({waitUntil:'networkidle'});await selection();const restored=await state();
  await Promise.all(pending);
  const summary={kind:'KADR_LIFT_STAND_EXPANSION_REAL_BROWSER',utc:new Date().toISOString(),build,page:base,environment:'Cloud Chromium at 390x844; not iPhone',
    api,catalogueWorks:catalogue.length,liftAccepted:lift.events.filter(e=>e.kind==='iframe_message').map(e=>e.event),
    webRTC:{proof:rtcProof,transport:rtc.transport,dependency:'temporary developer browser seeder'},
    http:{transport:beforeReload.transport,reloadTransport:http.transport,automaticRecovery,restoreTarget,seekIntoEmptyPiece:http.events.some(e=>e.kind==='media_range_request' && e.afterSeek && e.firstPieceHadNoBytes)},
    persistedRuns:restored.runs.length,iframeNotAutoOpened:await page.locator('iframe').count()===0,
    exportPrivacy:'native signed URL and opaque query values absent; UA off',errors,sockets:[...new Set(sockets)],failures,
    iPhone:'NOT_RUN for expanded stand',fullAdSession:'NOT_RUN',Lampac:'BLOCKED: no qualified external instance/access'};
  await save('summary',summary);console.log(JSON.stringify(summary,null,2));
} finally {if(seed && !seed.isClosed())await seed.close();await context.close();await browser.close();}
