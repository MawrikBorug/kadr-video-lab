// Real browser run; no request bodies, signed URLs, traces, HAR or cross-origin DOM reads.
import {chromium} from '@playwright/test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {safeDiagnostic} from '../web/collector.mjs';
const base=process.env.PUBLISHED_URL || 'https://mawrikborug.github.io/kadr-video-lab/';
const output=process.env.LIFT_EVIDENCE_DIR || '/workspace/scratch/lift-live';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
  ...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const page=await context.newPage();
const errors=[],networkFailures=[],apiResponses=[];
page.on('pageerror',error=>{
  const stack=error.stack || '';
  errors.push({message:safeDiagnostic(error.message),source:stack.includes('https://embed.liftw.ws')?'Lift iframe':stack.includes(new URL(base).origin)?'parent':'unattributed'});
});
page.on('requestfailed',request=>networkFailures.push({origin:new URL(request.url()).origin,error:safeDiagnostic(request.failure()?.errorText)}));
page.on('response',async response=>{
  if(response.url()!=='https://api.liftw.ws/info/3637')return;
  const requestHeaders=await response.request().allHeaders();
  apiResponses.push({status:response.status(),requestOrigin:requestHeaders.origin || null,acao:await response.headerValue('access-control-allow-origin')});
});
try{
  await page.goto(base,{waitUntil:'networkidle',timeout:30000});
  await page.waitForSelector('#run-info');
  const build=await page.evaluate(async()=>{const r=await fetch('./build-info.json',{cache:'no-store'});return r.json();});
  if(process.env.GITHUB_SHA && build.commit!==process.env.GITHUB_SHA)throw Error('Published commit mismatch');
  await page.click('#start');
  await page.waitForFunction(()=>!document.querySelector('#start').disabled,{timeout:35000});
  await page.waitForTimeout(8000);
  const frameCount=await page.locator('iframe').count();
  // Read the parent-owned attribute only, and keep it in memory for a privacy assertion.
  const nativeUrl=frameCount?await page.locator('iframe').getAttribute('src'):null;
  if(frameCount){await page.click('#ping');await page.waitForTimeout(5500);}
  if(errors.length){
    await page.selectOption('#note','other_error');
    await page.fill('#diagnostic','Облачный Chromium: '+[...new Set(errors.map(e=>e.message))].join('; ').slice(0,250));
    await page.click('#mark');
  }
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.lift.journal.v1')));
  const download=page.waitForEvent('download');await page.click('#export');
  const exportText=await readFile(await (await download).path(),'utf8');
  if(nativeUrl && exportText.includes(nativeUrl))throw Error('Native URL leaked into JSON');
  if(nativeUrl){for(const value of new URL(nativeUrl).searchParams.values())if(value.length>12 && exportText.includes(value))throw Error('Native query value leaked into JSON');}
  if(/https:\/\/embed\.liftw\.ws\/embed\/movie\/3637\?/.test(exportText))throw Error('Signed URL found in export');
  await writeFile(`${output}/KADR_LIFT_STAND_browser_export.json`,exportText);
  await page.screenshot({path:`${output}/KADR_LIFT_STAND_published.png`,fullPage:true});
  const summary={kind:'KADR_LIFT_STAND_REAL_BROWSER',utc:new Date().toISOString(),page:base,build,
    environment:'Cloud Chromium, 390 × 844 viewport; not an iPhone',apiResponses,frameCount,
    status:await page.locator('#status').textContent(),ready:await page.locator('#ready-state').textContent(),
    position:await page.locator('#position').textContent(),bridge:await page.locator('#bridge').textContent(),
    acceptedEvents:before.runs.at(-1).events.filter(e=>e.kind==='iframe_message').map(e=>e.event),
    parentErrors:before.runs.at(-1).events.filter(e=>['parent_js_error','parent_promise_error'].includes(e.kind)).length,
    browserErrors:errors,networkFailures,exportPrivacy:'native URL and opaque query values absent',
    physicalIPhone:'NOT_RUN',fullAdSession:'NOT_RUN'};
  await page.reload({waitUntil:'networkidle'});
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.lift.journal.v1')));
  summary.persistence={sameRunId:before.runs.at(-1).runId===after.runs.at(-1).runId,eventsBefore:before.runs.at(-1).events.length,eventsAfter:after.runs.at(-1).events.length,
    iframeNotAutoOpened:await page.locator('iframe').count()===0};
  await writeFile(`${output}/KADR_LIFT_STAND_browser_evidence.json`,JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
}finally{await context.close();await browser.close();}
