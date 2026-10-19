import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {sanitize} from '../web/security.js';
const base=process.env.LAB_URL||'http://127.0.0.1:4173/kadr-video-lab/';
const prefix=process.env.LAB_EVIDENCE_PREFIX||'local-live';
await mkdir('artifacts',{recursive:true});
const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',...(proxy?{proxy:{server:proxy,bypass:'127.0.0.1,localhost'}}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const page=await context.newPage(),failures=[],errors=[],documents=[];
page.on('response',r=>{if(r.request().resourceType()==='document'){const u=new URL(r.url());documents.push({origin:u.origin,status:r.status(),xFrameOptions:r.headers()['x-frame-options']||null});}});
page.on('requestfailed',r=>{try{failures.push({origin:new URL(r.url()).origin,error:r.failure()?.errorText});}catch{}});
page.on('pageerror',e=>errors.push({message:sanitize(e.message),source:sanitize(e.stack||''),scope:(e.stack||'').includes(new URL(base).origin)?'app':'external-frame-or-unknown'}));
const results=[];
try{
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>document.querySelectorAll('#sample option').length===18,{timeout:15000});
 const build=await page.locator('#build-info').innerText();
 if(process.env.EXPECTED_COMMIT&&!build.includes(process.env.EXPECTED_COMMIT))throw new Error('Published commit does not match expected commit');
 await page.selectOption('#device','desktop-chrome');await page.fill('#environment-notes','Automated cloud QA: UI confirmations are scripted, not physical iPhone observations');await page.check('#access-consent');
 const controls=(process.env.LAB_SMOKE_ONLY||process.env.LAB_NO_CONTROLS)?[]:['blender','apple'];
 for(const provider of controls){
  const result={provider,environment:'cloud Chromium, mobile viewport; not physical iPhone',startedAt:new Date().toISOString(),sound:'AAC/declared tracks only; no listening confirmation'};
  if(await page.locator('#new-session').count())await page.click('#new-session');
  await page.selectOption('#provider',provider);await page.check('#access-consent');await page.click('#open-source');
  try{
   await page.waitForSelector('video',{timeout:10000});await page.click('#play');
   await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>1;},{timeout:25000});
   result.start='observed';result.initial=await page.locator('video').evaluate(v=>({position:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,muted:v.muted,readyState:v.readyState,error:v.error?.code||null}));
   await page.click('#pause');await page.waitForTimeout(650);
   const paused=await page.locator('video').evaluate(v=>({paused:v.paused,position:v.currentTime}));await page.waitForTimeout(500);const after=await page.locator('video').evaluate(v=>v.currentTime);
   result.pause={observed:paused.paused&&Math.abs(after-paused.position)<.15,position:after};
   if(result.initial.duration){
    await page.click('#seek');await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.seeking&&Math.abs(v.currentTime-v.duration/2)<2;},{timeout:15000});
    result.seek50={observed:true,position:await page.locator('video').evaluate(v=>v.currentTime)};
    await page.click('#play');await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>v.duration/2+.5;},{timeout:15000});result.seekResume='observed';
   }
   await page.click('#sleep-timer');await page.waitForTimeout(10500);result.sleepTimer={paused:await page.locator('video').evaluate(v=>v.paused)};
   await page.click('#restore-position');result.restore={position:await page.locator('video').evaluate(v=>v.currentTime)};
   // A seek-to-end checks ended separately; it must not qualify as a completed watch.
   if(result.initial.duration){
    await page.locator('video').evaluate(v=>{v.currentTime=Math.max(0,v.duration-1);});await page.click('#play');
    await page.waitForFunction(()=>document.querySelector('video')?.ended,{timeout:15000});result.ended='observed-after-seek-not-full-watch';
   }
  }catch(e){result.start??='not-confirmed';result.error=sanitize(String(e.message).split('\n')[0]);result.message=await page.locator('#message').innerText();if(await page.locator('video').count())result.video=await page.locator('video').evaluate(v=>({position:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,readyState:v.readyState,error:v.error?.code||null}));}
  await page.screenshot({path:`artifacts/${prefix}-${provider}.png`,fullPage:false});if(await page.locator('#stop').isEnabled())await page.click('#stop');
  const snapshot=await page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.v1')).records.at(-1));result.measurement=snapshot.measurement;result.layers=snapshot.layers;result.technical=snapshot.technical;results.push(result);await writeFile(`artifacts/${prefix}-progress.json`,JSON.stringify(sanitize({results,failures,errors}),null,2));await writeFile(`artifacts/${prefix}-journal-checkpoint.json`,JSON.stringify(await page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.v1'))),null,2));
 }
 const providers=process.env.LAB_PROVIDERS?process.env.LAB_PROVIDERS.split(','):process.env.LAB_CONTROLS_ONLY?[]:process.env.LAB_SMOKE_ONLY?['filmix']:['filmix','aniliberty','mikai','primesrc','vokino','animeon','vidapi','vidlink','vidzee','stellar','yapgrid','mapple','embedwave','vidrift','cinesrc','cinezo'];
 for(const provider of providers){
  const documentStart=documents.length;await page.click('#new-session');await page.selectOption('#provider',provider);await page.selectOption('#sample',provider==='archive'?'archive-sintel':['aniliberty','mikai','animeon'].includes(provider)?'solo':'dune');await page.check('#access-consent');await page.click('#open-source');
  const frameMode=['vidapi','vidlink','vidzee','stellar','yapgrid','mapple','embedwave','vidrift','cinesrc','cinezo'].includes(provider);
  if(frameMode)await page.waitForTimeout(Number(process.env.LAB_WAIT_FRAME_MS||5000));else try{await page.waitForFunction(()=>{const records=JSON.parse(localStorage.getItem('kadr.videoLab.v1'))?.records;const r=records?.at(-1);return r&&(r.technical.apiError||r.technical.catalogResult);},{timeout:22000});}catch{}
  if(provider==='filmix'){const candidate=page.locator('#api-results button').filter({hasText:'170881'});if(await candidate.count()){await candidate.first().click();try{await page.waitForFunction(()=>{const r=JSON.parse(localStorage.getItem('kadr.videoLab.v1')).records.at(-1);return r.technical.followup||r.technical.followupError;},null,{timeout:22000});}catch{}}}
  const snapshot=await page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.v1')).records.at(-1));
  results.push({provider,environment:'cloud Chromium; not physical iPhone',layers:snapshot.layers,technical:snapshot.technical,queueStatus:snapshot.queueStatus,message:await page.locator('#message').innerText(),iframeCount:await page.locator('iframe').count(),documents:documents.slice(documentStart),contentPlaybackConfirmed:false});
  await writeFile(`artifacts/${prefix}-progress.json`,JSON.stringify(sanitize({results,failures,errors}),null,2));if(await page.locator('#stop').isEnabled())await page.click('#stop');
 }
 await page.selectOption('#export-scope','all');const waiting=page.waitForEvent('download');await page.click('#export-json');const file=await waiting;const exported=JSON.parse(await readFile(await file.path(),'utf8'));
 await writeFile(`artifacts/${prefix}-journal.json`,JSON.stringify(sanitize(exported),null,2));
 const csvWaiting=page.waitForEvent('download');await page.click('#export-csv');const csvFile=await csvWaiting;await writeFile(`artifacts/${prefix}-journal.csv`,await readFile(await csvFile.path()));
 const report=sanitize({base,build,utc:new Date().toISOString(),environment:'cloud Chromium; external network via configured session proxy, country not assumed',physicalIPhone:'NOT_RUN',results,failures,errors});
 await writeFile(`artifacts/${prefix}-browser.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({build,results:results.map(r=>({provider:r.provider,start:r.start,error:r.error,apiError:r.technical?.error,iframe:r.iframeCount,pause:r.pause,seek50:r.seek50,sleepTimer:r.sleepTimer,ended:r.ended})),errors},null,2));
}finally{await context.close();await browser.close();}
