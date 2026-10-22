// Optional developer control on Lift's own site. No cross-origin DOM, guessed
// postMessage seek commands, URL edits, profile extraction or synthetic progress.
import {chromium} from '@playwright/test';import {mkdir,writeFile} from 'node:fs/promises';import {safeDiagnostic} from '../web/collector.mjs';
const out=process.env.LIFT_EVIDENCE_DIR || '/workspace/scratch/lift-progress-control';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
const page=await browser.newPage({viewport:{width:390,height:844}}),events=[],actions=[],errors=[],httpErrors=[];let phase='load',generation=1;
const save=()=>writeFile(out+'/KADR_LIFT_STAND_PHONE_FIX_NATIVE_PROGRESS.json',JSON.stringify({scope:'Official liftw.ws same-site control; not third-party embedding or iPhone proof',utc:new Date().toISOString(),events,actions,errors,httpErrors},null,2));
await page.exposeFunction('qaRecord',data=>{events.push({...data,phase,generation});});
await page.addInitScript(()=>{if(self!==top)return;addEventListener('message',e=>{
 if(e.origin!=='https://embed.liftw.ws' || ![...document.querySelectorAll('iframe')].some(f=>f.contentWindow===e.source))return;
 const d=e.data==='pong'?{event:'pong'}:e.data;if(!d || !['playerReady','startWatching','viewProgress','endedSoon','ended','adStart','adStop'].includes(d.event))return;
 const value={utc:new Date().toISOString(),event:d.event};for(const k of ['id','time','duration'])if(typeof d[k]==='number'&&Number.isFinite(d[k])&&d[k]>=0&&d[k]<1e9)value[k]=d[k];if(d.event==='playerReady')window.qaLiftReady=true;window.qaRecord(value);
 });});
page.on('pageerror',e=>errors.push({phase,reason:safeDiagnostic(e.message)}));
page.on('response',r=>{if(r.status()>=400 && httpErrors.length<100)httpErrors.push({phase,origin:new URL(r.url()).origin,status:r.status()});});
const shot=name=>page.screenshot({path:out+'/KADR_LIFT_STAND_PHONE_FIX_'+name+'.png'});
async function action(name,fn){actions.push({utc:new Date().toISOString(),phase,generation,action:name});await fn();await save();}
async function observe(seconds){for(let t=0;t<seconds;t+=10){await page.waitForTimeout(Math.min(10,seconds-t)*1000);await save();}console.log(phase,'progress',events.filter(e=>e.phase===phase&&e.event==='viewProgress').map(e=>e.time.toFixed(2)).join(','));}
async function waitReady(){await page.waitForFunction(()=>window.qaLiftReady===true,null,{timeout:45000});await page.waitForTimeout(1000);}
async function chooseEnglishAndPlay(){
 const before=events.filter(e=>e.generation===generation&&e.event==='startWatching').length;
 // Coordinates are normal visible player controls for this 390x844 control page.
 await page.mouse.click(349,341);await page.waitForTimeout(400);await page.mouse.click(295,396);await page.waitForTimeout(400);await shot('audio_menu_g'+generation);
 await page.mouse.click(238,427);await page.waitForTimeout(2000);
 if(events.filter(e=>e.generation===generation&&e.event==='startWatching').length===before)await page.mouse.click(52,416);
}
try{
 await page.goto('https://liftw.ws/details.html?id=3637',{waitUntil:'domcontentloaded'});await waitReady();await shot('native_initial');
 phase='continuous';await action('select Eng.Original via visible menu, then Play',chooseEnglishAndPlay);await observe(Number(process.env.CONTINUOUS_SECONDS)||155);await shot('native_after_continuous');
 if(!events.some(e=>e.phase==='continuous'&&e.event==='viewProgress'&&e.time>60)){phase='blocked';await save();console.log('Real continuous playback was not established; later phases NOT_RUN');}
 else{
  phase='pause';await action('pause via player click',()=>page.mouse.click(195,416));await observe(12);await shot('native_paused');
  phase='resume';await action('resume via player click',()=>page.mouse.click(52,416));await observe(18);
  phase='seek';await action('native keyboard ArrowRight five times on focused player',async()=>{for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');});await shot('native_after_seek');await observe(75);
  phase='reload';generation++;await action('reload official details page; provider creates fresh iframe',()=>page.reload({waitUntil:'domcontentloaded'}));await waitReady();await shot('native_after_reload_before_play');
  await action('select original and play after reload',chooseEnglishAndPlay);await observe(75);await shot('native_after_reload_observation');
 }
 await save();console.log('Native control completed; inspect screenshots and events before making claims');
}finally{await browser.close();}
