// Actual UI and upstream search, no routes/mocks, no HAR/SDP/IP or media capture.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const base=process.env.CONTROL_BASE_URL || 'https://mawrikborug.github.io/kadr-video-lab/';
const output=process.env.FOLLOWUP_EVIDENCE_DIR || 'artifacts/followup-live';
await mkdir(output,{recursive:true});
const save=(name,data)=>writeFile(output+'/'+name+'.json',JSON.stringify(data,null,2)+'\n');
let browser,server;const result={utc:new Date().toISOString(),base,scope:'Actual search UI, Comet with TorrentsDB reserve; no routed upstream responses',iPhone:'NOT_RUN'},network=[];
try{
 if(new URL(base).hostname==='127.0.0.1'){
  server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:'ignore'});
  for(let i=0;i<30;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
 }
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
  ...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('requestfailed',r=>{if(network.length<30)network.push({host:new URL(r.url()).host,reason:r.failure()?.errorText});});
 await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>!document.querySelector('#search-start').disabled);
 result.browser=browser.version();result.build=await page.evaluate(async()=>await(await fetch('./build-info.json',{cache:'no-store'})).json());
 if(result.build.version!=='search-2' || (process.env.GITHUB_SHA && result.build.commit!==process.env.GITHUB_SHA))throw Error('wrong_build');
 await page.selectOption('#search-work','dandadan');await page.selectOption('#search-episode','2');await page.click('#search-start');
 await page.waitForFunction(()=>{const r=JSON.parse(localStorage.getItem('kadr.videoLab.search.v1'))?.runs.at(-1);return r?.searchState==='finished' && ['batch-complete','time-limit','stopped','waiting-for-results'].includes(r.queueState);},null,{timeout:100000});
 const run=await page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.search.v1')).runs.at(-1));
 await save('automatic-search',run);
 result.found=run.candidates.length;result.hosts=run.hostStates;result.counters=run.counters;
 result.probes=run.candidates.filter(c=>c.probe).map(c=>({infoHash:c.torrent.infoHash,fileIdx:c.torrent.fileIdx,filePath:c.torrent.filePath,fileLength:c.torrent.fileLength,
  metadataHashVerified:c.torrent.metadataHashVerified,metadataProvenance:c.metadataProvenance,probe:c.probe,states:c.states,reason:c.probeReason}));
 // Retain all file paths for the freshly retrieved snapshot, independently of UI labels.
 result.fullMetadata=await page.evaluate(async()=>{
  const {parseMetadata}=await import('./torrent-metadata.mjs'),config=await(await fetch('./search-fixtures/metadata-sources.json')).json(),out=[];
  for(const p of config.packages){const bytes=new Uint8Array(await(await fetch('./'+p.fixture)).arrayBuffer()),meta=await parseMetadata(bytes,p.infohash);
   out.push({infoHash:meta.infoHash,files:meta.files,bytes:bytes.length,webseeds:meta.webseeds.length,snapshotRetrievedAt:p.retrievedAt});}
  return out;
 });
 await page.screenshot({path:output+'/search.png',fullPage:true});
 if(run.candidates.length){
  await page.locator('.source-result button').first().click();
  await page.evaluate(()=>{window.closedPick=document.querySelector('.source-result button').onclick;window.closedPlay=document.querySelector('#search-play-a').onclick;window.closedProbe=document.querySelector('#search-reprobe').onclick;});
  await page.selectOption('#connection','wt-webrtc');await page.waitForFunction(()=>document.querySelector('#search-status').textContent.includes('Поиск закрыт'));
  await page.evaluate(async()=>{window.closedPick();await window.closedPlay();await window.closedProbe();});
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.search.v1')).runs.at(-1));
  result.stale={searchIdUnchanged:run.searchId===after.searchId,closed:after.searchState==='cancelled',allResultActionsDisabled:await page.locator('.source-result button').evaluateAll(bs=>bs.every(b=>b.disabled)),
   selectedHidden:await page.locator('#search-selected').isHidden(),newLaunches:after.events.filter(e=>['play_requested','manual_probe_requested'].includes(e.kind)).length-run.events.filter(e=>['play_requested','manual_probe_requested'].includes(e.kind)).length,
   journalCandidatesRetained:after.candidates.length===run.candidates.length};
  await save('after-source-switch',after);await page.screenshot({path:output+'/closed-results.png',fullPage:true});
 }
 result.network=network;result.finished=new Date().toISOString();await save('summary',result);
 console.log('Found recheck',JSON.stringify({build:result.build,found:result.found,probes:result.probes,stale:result.stale}));
 if(result.probes.length!==3 || result.stale?.newLaunches!==0 || !result.stale?.allResultActionsDisabled)throw Error('followup_incomplete');
}catch(e){await save('interrupted',{...result,error:{name:e.name,message:e.message.replace(/https?:\/\/\S+/g,'[URL]').slice(0,300)},network});throw e;}
finally{await browser?.close();server?.kill();}
