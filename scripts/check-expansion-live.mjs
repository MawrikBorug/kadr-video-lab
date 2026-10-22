// Real browser checks. No trace/HAR, SDP/IPs, raw payload or signed URLs are saved.
import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {safeDiagnostic} from '../web/collector.mjs';
const base=process.env.PUBLISHED_URL || 'https://mawrikborug.github.io/kadr-video-lab/';
const output=process.env.LIFT_EVIDENCE_DIR || '/workspace/scratch/owner-published';
const onlyA=process.env.PROBE_SCOPE==='A';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,
 ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
 ...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const page=await context.newPage(),errors=[],api=[],network=[],sockets=[],privateValues=[];let phase='shell',seed;
page.on('pageerror',e=>errors.push({phase,message:safeDiagnostic(e.message),origins:[...new Set((e.stack?.match(/https?:\/\/[^\s)]+/g)||[]).map(s=>{try{return new URL(s).origin;}catch{return 'unknown';}}))]}));
page.on('websocket',ws=>sockets.push({phase,origin:new URL(ws.url()).origin}));
const pending=[];
page.on('response',r=>{if(r.url().startsWith('https://api.liftw.ws/info/'))pending.push((async()=>api.push({phase,id:Number(new URL(r.url()).pathname.split('/').at(-1)),status:r.status(),browserOrigin:(await r.request().allHeaders()).origin,acao:await r.headerValue('access-control-allow-origin')}))());});
page.on('requestfailed',r=>{if(network.length<100)network.push({phase,origin:new URL(r.url()).origin,reason:safeDiagnostic(r.failure()?.errorText)});});
const save=(name,x)=>writeFile(`${output}/KADR_LIFT_STAND_PHONE_FIX_${name}.json`,JSON.stringify(x,null,2)+'\n');
const journal=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.experiments.v1')));
const current=async()=>(await journal()).runs.at(-1);
const selection=()=>page.waitForFunction(()=>!document.querySelector('#connection').disabled && !document.querySelector('#material').disabled);
const rememberURL=async()=>{const f=page.locator('iframe#frame');if(await f.count()){const uri=await f.getAttribute('src');privateValues.push(uri,...new URL(uri).searchParams.values());}};
const stop=async()=>{await page.click('#stop');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Источник закрыт'));};
try{
 await page.goto(base,{waitUntil:'networkidle',timeout:30000});await selection();
 const build=await page.evaluate(async()=>await (await fetch('./build-info.json',{cache:'no-store'})).json());
 if(build.version!=='lift-3' || (process.env.GITHUB_SHA && build.commit!==process.env.GITHUB_SHA))throw Error('wrong_published_build');
 const catalog=await page.evaluate(async()=>await (await fetch('./catalog.json',{cache:'no-store'})).json());
 const catalogue=[];
 if(!onlyA){
  if(process.env.SKIP_LIFT_CONTROL!=='1'){
   phase='Lift/Sintel';await page.click('#start');await page.waitForFunction(()=>!document.querySelector('#start').disabled);await rememberURL();await page.waitForTimeout(6000);await page.click('#ping');await page.waitForTimeout(5500);
   await save('Lift',{build,scope:'Real third-party iframe; player failure is not a successful media session',run:await current()});
   await page.screenshot({path:`${output}/KADR_LIFT_STAND_PHONE_FIX_Lift.png`,fullPage:true});
  }
  for(const item of catalog.filter(m=>m.ownerSample)){
   phase='catalogue/'+item.id;await page.selectOption('#material',String(item.id));await selection();await page.click('#catalog-test');
   await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Каталожная проверка завершена')||document.querySelector('#frame-state').textContent.includes('Отказ'),null,{timeout:30000});
   const before=await current();if(!before.catalog?.found)throw Error('catalogue_failed_'+item.id);
   if(await page.locator('iframe').count())throw Error('catalogue_mounted_iframe');
   await page.click('#start');await page.waitForFunction(()=>!document.querySelector('#start').disabled);await rememberURL();
   const mounted=await page.locator('iframe#frame').count();await page.waitForTimeout(1500);
   catalogue.push({subject:item.title,materialId:item.id,catalogue:before.catalog,iframeMounted:mounted===1,run:await current(),claim:'Opening iframe is not playback/quality/audio proof'});
   await save('catalogue',{build,runs:catalogue});console.log('Lift identity/catalogue/iframe',item.id,mounted===1);
  }
 }
 phase='controlled A';
 seed=await context.newPage();await seed.goto(new URL('fixtures/README.txt',base).href);
 await seed.evaluate(async base=>{
  const {startDeveloperSeeder}=await import(base+'torrent.mjs'),{TORRENT_MATERIALS}=await import(base+'torrent-materials.js');
  window.qaSeedEvents=[];
  const m=TORRENT_MATERIALS.find(m=>m.id==='kadr-control');
  window.qaSeed=await startDeveloperSeeder({...m,seedFile:new URL(m.seedFile,base).href},s=>window.qaSeedStatus=s,e=>window.qaSeedEvents.push(e));
 },base);
 await seed.waitForFunction(()=>window.qaSeedEvents.some(e=>e.kind==='seed_ready'),null,{timeout:15000});
 await page.selectOption('#connection','wt-webrtc');await selection();await page.selectOption('#material','kadr-control');await selection();await page.click('#start');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kadr.videoLab.experiments.v1')).runs.at(-1).transport?.metadataReady,null,{timeout:20000});
 await page.waitForFunction(()=>{const t=JSON.parse(localStorage.getItem('kadr.videoLab.experiments.v1')).runs.at(-1).transport;return t?.timedOut || t?.webRTCBytes>0;},null,{timeout:50000});
 let aPlayback=false;const aState=await current();
 if(aState.transport.webRTCBytes>0){await page.waitForFunction(()=>document.querySelector('video').readyState>=1,null,{timeout:20000});await page.click('video');await page.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video').currentTime>0.5);aPlayback=true;}
 const aRun=await current(),seedLog=await seed.evaluate(()=>({status:window.qaSeedStatus,events:window.qaSeedEvents}));
 const a={build,scope:'Temporary developer browser seeder, ready before viewer starts; not an autonomous public swarm',proof:aPlayback && aRun.transport.webRTCBytes>0 && aRun.transport.httpBytes===0 && aRun.transport.preexistingBytesAtReady===0,seed:seedLog,run:aRun};
 await save('A',a);await page.screenshot({path:`${output}/KADR_LIFT_STAND_PHONE_FIX_A.png`,fullPage:true});
 console.log('A',a.run.transport.failureCode || 'payload',a.run.transport.webRTCBytes,a.run.transport.httpBytes);
 await seed.evaluate(()=>new Promise(r=>window.qaSeed.destroy(r)));await seed.close();seed=null;await stop();
 const b=[];
 if(!onlyA){
  await page.selectOption('#connection','wt-http');await selection();
  for(const id of (process.env.B_IDS || 'sintel-public,kadr-control,big-buck-bunny,cosmos-laundromat,tears-of-steel').split(',')){
   phase='B/'+id;await page.selectOption('#material',id);await selection();await page.click('#start');let outcome='NOT_PLAYED',reason=null;
   try{
    await page.waitForFunction(()=>document.querySelector('video').readyState>=1 || document.querySelector('video').error || JSON.parse(localStorage.getItem('kadr.videoLab.experiments.v1')).runs.at(-1).transport?.timedOut,null,{timeout:45000});
    if(await page.locator('video').evaluate(v=>!!v.error))throw Error('native_media_error');
    await page.click('video');await page.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video').currentTime>0.5,null,{timeout:20000});
    const target=await page.locator('video').evaluate(v=>Math.floor(v.duration*.72));await page.locator('video').evaluate((v,t)=>{v.currentTime=t;},target);
    await page.waitForFunction(t=>Math.abs(document.querySelector('video').currentTime-t)<3 && !document.querySelector('video').seeking,target,{timeout:30000});
    outcome='PLAYED_AND_SEEKED';
    if(id==='sintel-public'){
     await context.setOffline(true);await page.locator('video').evaluate(v=>{v.currentTime=500;});await page.waitForTimeout(3500);await context.setOffline(false);
     let recovered=false;try{await page.waitForFunction(()=>document.querySelector('video').currentTime>500.2 && !document.querySelector('video').seeking,null,{timeout:25000});recovered=true;}catch{}
     const before=await current(),target=before.lastPosition?.time,uri=await page.locator('video').getAttribute('src');
     await page.click('#reload');await page.waitForFunction(()=>document.querySelector('video').readyState>=1,null,{timeout:30000});
     if(uri===await page.locator('video').getAttribute('src'))throw Error('media_cache_isolation_failed');
     await page.click('#restore-position');await page.waitForFunction(t=>Math.abs(document.querySelector('video').currentTime-t)<1 && !document.querySelector('video').seeking,target,{timeout:30000});
     b.push({id,phase:'before_reload',run:before,automaticNetworkRecovery:recovered,restoreTarget:target});
    }
   }catch(e){reason=safeDiagnostic(e.message);}
   const run=await current(),native=await page.locator('video').evaluate(v=>({time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,width:v.videoWidth,height:v.videoHeight,audioTracksExposed:v.audioTracks?.length ?? null,mediaError:v.error?.code ?? null}));
   if(run.transport?.webRTCBytes!==0 || sockets.some(s=>s.phase===phase))throw Error('B_transport_isolation_failed');
   b.push({id,outcome,reason,native,run});await save('B',{build,scope:'Actual external webseeds + owned existing Pages webseed; isolated HTTP, not P2P',results:b});
   await page.screenshot({path:`${output}/KADR_LIFT_STAND_PHONE_FIX_B_${id}.png`,fullPage:true});console.log('B',id,outcome,run.transport?.httpBytes);await stop();
  }
 }
 phase='export';await page.click('#compare');
 const promise=page.waitForEvent('download');await page.click('#export');const text=await readFile(await (await promise).path(),'utf8');
 if(privateValues.some(v=>v?.length>12 && text.includes(v)))throw Error('signed_url_or_value_leaked');
 const exp=JSON.parse(text);if(exp.environment.userAgentIncluded || exp.environment.userAgent)throw Error('UA unexpectedly exported');
 await writeFile(`${output}/KADR_LIFT_STAND_PHONE_FIX_export.json`,text);
 await page.reload({waitUntil:'networkidle'});await selection();const persisted=await journal();await Promise.all(pending);
 const summary={kind:'KADR_LIFT_STAND_PHONE_FIX_REAL_BROWSER',utc:new Date().toISOString(),build,page:base,environment:'Cloud Chromium 390x844, not iPhone',catalogueWorks:catalogue.length,allOwnerIframesMounted:catalogue.every(x=>x.iframeMounted),api,A:{proof:a.proof,transport:a.run.transport},B:b.map(x=>({id:x.id,outcome:x.outcome,phase:x.phase,native:x.native,transport:x.run.transport,firstPlaying:x.run.events.find(e=>e.kind==='native_video'&&e.event==='playing'),emptyPieceSeek:x.run.events.some(e=>e.kind==='media_range_request'&&e.afterSeek&&e.firstPieceHadNoBytes),automaticNetworkRecovery:x.automaticNetworkRecovery})),persistedRuns:persisted.runs.length,noAutomaticIframe:await page.locator('iframe').count()===0,exportPrivacy:'No actual signed URI/long query value; UA off',errors,network,sockets,iPhone:'NOT_RUN',fullAdSession:'NOT_RUN',hypothesisCadence:'Separate native-site control observation; source model is not runtime proof'};
 await save('summary',summary);console.log('Real browser probe complete',summary.persistedRuns);
}finally{if(seed&&!seed.isClosed())await seed.close();await context.close();await browser.close();}
