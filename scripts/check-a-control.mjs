// Temporary owned-media seeder and fresh viewers, with real public WSS discovery.
// No local/manual signaling, media HTTP fallback, policy overrides, HAR or SDP logs.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const base=process.env.CONTROL_BASE_URL || 'http://127.0.0.1:4173/kadr-video-lab/';
const output=process.env.CONTROL_EVIDENCE_DIR || 'artifacts/a-control';
await mkdir(output,{recursive:true});
const save=(name,value)=>writeFile(output+'/'+name+'.json',JSON.stringify(value,null,2)+'\n');
let server,browser;const result={utc:new Date().toISOString(),base,scope:'Temporary developer WebRTC seeder; owned 60-second media; not a public title swarm',publicTrackers:true,manualSignaling:false,physicalIPhone:'NOT_RUN'};
try{
 if(new URL(base).hostname==='127.0.0.1'){
  server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:'ignore'});
  for(let i=0;i<30;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
 }
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
  ...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844}}),seed=await context.newPage(),page=await context.newPage();
 await seed.goto(base+'fixtures/README.txt');
 result.build=await seed.evaluate(async()=>await(await fetch('../build-info.json',{cache:'no-store'})).json());
 result.browser=browser.version();
 await seed.evaluate(async base=>{
  const {startDeveloperSeeder}=await import(base+'torrent.mjs'),{TORRENT_MATERIALS}=await import(base+'torrent-materials.js');
  const material=TORRENT_MATERIALS.find(m=>m.id==='kadr-control');window.seedEvents=[];
  window.controlSeed=await startDeveloperSeeder({...material,seedFile:new URL(material.seedFile,base).href},()=>{},event=>window.seedEvents.push({utc:new Date().toISOString(),...event}));
 },base);
 await seed.waitForFunction(()=>window.seedEvents.some(e=>e.kind==='seed_ready'),null,{timeout:20000});
 console.log('Developer seeder ready; SHA-1 matched; starting fresh magnet-only viewer');
 await page.goto(base+'fixtures/README.txt');
 result.bep9=await page.evaluate(async base=>{
  const {CandidateProbe,SearchBudget}=await import(base+'source-probe.mjs'),{LocatorVault,normalizeStream}=await import(base+'source-search.mjs'),
   {LIMITS,WORKS,workQuery}=await import(base+'search-config.mjs');
  const vault=new LocatorVault(),candidate=normalizeStream({infoHash:'05b36bedda4c62b73af236553176141c51912689',name:'OWNED CONTROL, synthetic search identity'},workQuery(WORKS.find(w=>w.type==='movie')),{id:'developer-control',label:'Temporary owned control'},vault);
  const events=[],probe=new CandidateProbe({candidate,vault,budget:new SearchBudget(),limits:{...LIMITS,candidateMs:45000},signal:new AbortController().signal,onChange:()=>{},onEvent:(kind,details)=>events.push({kind,...details})});
  let error=null;
  try{await probe.webrtc(null);}catch(e){error={code:e.code || e.name};}finally{await probe.close();}
  const meta=vault.get(candidate)?.meta;
  return {plan:'CandidateProbe.webrtc(null); BEP9 only; no HTTPS metadata and no webseed',error,stats:probe.stats,events,metadataHashVerified:candidate.torrent.metadataHashVerified,infoHash:meta?.infoHash,fileCount:meta?.files.length,fileIdx:candidate.torrent.fileIdx,filePath:candidate.torrent.filePath,states:candidate.states,resourcesClosed:!probe.client};
 },base);
 await save('bep9',result.bep9);console.log('BEP9',result.bep9.stats.connectedWires,result.bep9.stats.metadataBytes,result.bep9.stats.webrtcBytes,result.bep9.error?.code);
 await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>!document.querySelector('#connection').disabled);
 await page.selectOption('#connection','wt-webrtc');await page.waitForFunction(()=>!document.querySelector('#material').disabled);
 await page.selectOption('#material','kadr-control');await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.click('#start');
 let playerError=null;
 try{
  await page.waitForFunction(()=>document.querySelector('video').readyState>=1,null,{timeout:50000});
  await page.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>!document.querySelector('video').paused && document.querySelector('video').currentTime>1,null,{timeout:15000});
 }catch(e){playerError=e.name;}
 result.player={error:playerError,run:await page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.experiments.v1')).runs.at(-1)),native:await page.locator('video').evaluate(v=>({time:v.currentTime,width:v.videoWidth,height:v.videoHeight,paused:v.paused,error:v.error?.code || null}))};
 await page.screenshot({path:output+'/A-control.png',fullPage:true});await page.click('#stop');
 result.seed=await seed.evaluate(()=>window.seedEvents);
 result.proof={metadata:result.bep9.metadataHashVerified===true && result.bep9.stats.metadataBytes>0,peer:result.bep9.stats.connectedWires>0,verifiedPayload:result.bep9.stats.verifiedBytes>0 && result.bep9.stats.webrtcBytes>0,
  nativePlaying:!playerError && result.player.run.events.some(e=>e.kind==='native_video' && e.event==='playing' && e.trusted) && result.player.native.time>1,
  noHTTPMedia:result.bep9.stats.httpBytes===0 && result.player.run.transport?.httpBytes===0,
  freshViewer:result.player.run.transport?.preexistingBytesAtReady===0,playingBeforeFull:result.player.run.transport?.playbackBeforeFull===true,
  seederSentPayload:result.seed.some(e=>e.kind==='seed_payload_sent' && e.bytes>0)};
 const hold=Math.min(180000,Math.max(0,Number(process.env.CONTROL_HOLD_MS)||0));
 if(hold && Object.values(result.proof).every(v=>v===true)){
  result.externalWindow={started:new Date().toISOString(),maximumMs:hold};await save('control',result);
  console.log('Verified seeder remains available for the external viewer window',hold);
  await new Promise(resolve=>setTimeout(resolve,hold));result.externalWindow.ended=new Date().toISOString();
  result.seed=await seed.evaluate(()=>window.seedEvents);
 }
 await seed.evaluate(()=>new Promise(resolve=>window.controlSeed.destroy(resolve)));result.seederClosed=true;
 await save('control',result);console.log('A control proof',JSON.stringify(result.proof));
 if(Object.values(result.proof).some(v=>v!==true))process.exitCode=1;
}catch(e){result.error={name:e.name,message:e.message.replace(/https?:\/\/\S+/g,'[URL]').slice(0,300)};await save('control',result);throw e;}
finally{await browser?.close();server?.kill();}
