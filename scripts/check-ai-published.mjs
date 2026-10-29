import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import readline from 'node:readline';

process.stdout.write('Ready for private deployment access JSON on stdin.\n');
const rl=readline.createInterface({input:process.stdin});
const config=await new Promise(resolve=>rl.once('line',s=>resolve(JSON.parse(s))));rl.close();
const share=new URL(config.shareUrl);share.pathname='/ai.html';
const out=config.output||'artifacts/published-ai';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const evidence={kind:'REAL_PUBLISHED_HTTPS',physicalIPhone:'NOT_RUN',at:new Date().toISOString(),url:share.origin+'/ai.html',steps:[],errors:[]};
await page.addInitScript(()=>{
 const original=window.fetch.bind(window);window.__kadrQA=[];
 window.fetch=async(input,options)=>{
  const response=await original(input,options);let op;
  try{if(String(input).includes('/api/ai'))op=JSON.parse(options?.body||'{}').op;}catch{}
  if(['analysis','recognize'].includes(op)){
   const record={op,status:response.status,events:[],done:false};window.__kadrQA.push(record);
   response.clone().text().then(raw=>{record.events=raw.split('\n').filter(Boolean).map(s=>JSON.parse(s));record.done=true;},()=>{record.aborted=true;record.done=true;});
  }return response;
 };
});
page.on('pageerror',e=>evidence.errors.push(e.message));
page.on('response',async response=>{
 try{if(new URL(response.url()).origin!==share.origin||!response.url().includes('/api/ai')||response.request().method()!=='POST')return;
  const b=response.request().postDataJSON();if(!['recognize','analysis'].includes(b?.op))return;
  const raw=await response.text(),events=raw.split('\n').filter(Boolean).map(s=>JSON.parse(s));
  evidence.liveResponses||=[];evidence.liveResponses.push({op:b.op,input:{frames:b.frames?.length,descriptionCharacters:b.description?.length,type:b.type,id:b.id,season:b.season},status:response.status(),events});await save();
 }catch{/* only bounded application outputs are retained */}
});
async function call(body,long=false){
 return page.evaluate(async({body,long})=>{
  const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!long)return {status:r.status,body:await r.json()};
  const reader=r.body.getReader(),decoder=new TextDecoder();let pending='',events=[];
  while(true){const {value,done}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});let i;
   while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);if(line)events.push(JSON.parse(line));}if(done)break;
  }return {status:r.status,events};
 },{body,long});
}
async function save(){await writeFile(out+'/report.json',JSON.stringify(evidence,null,2));}
try{
 await page.goto(share.href,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>!document.querySelector('#ai-health')?.textContent.includes('Проверяем сервер'),null,{timeout:30000});
 evidence.health=await page.evaluate(()=>fetch('/api/ai').then(r=>r.json()));
 if(config.expectedCommit&&evidence.health.commit!==config.expectedCommit)throw Error('Published commit does not match the requested verification version.');
 await page.screenshot({path:out+'/iphone-sized-page.png',fullPage:true});await save();
 if(config.mode==='metadata'){
  const cat=await call({op:'catalog',query:'Sintel'});evidence.steps.push({name:'live-TMDB-search',...cat});
  const film=await call({op:'prepare',type:'movie',id:45745});const fp=film.body.proof;delete film.body.proof;evidence.steps.push({name:'film-prepare',...film});
  const deny=await call({op:'confirm',proof:fp,watched:false});evidence.steps.push({name:'unwatched-denied',...deny});
  const yes=await call({op:'confirm',proof:fp,watched:true});evidence.steps.push({name:'watched-confirmed',status:yes.status,proofReceived:Boolean(yes.body.proof)});
  const season=await call({op:'prepare',type:'tv',id:106379,season:1});delete season.body.proof;evidence.steps.push({name:'season-prepare-current-official-finality',...season});
 }else if(config.mode==='image'){
  const file=config.control||'tests/fixtures/ai-controls/control-01.jpg';
  await page.locator('#ai-files').setInputFiles(file);await page.waitForFunction(()=>document.querySelectorAll('.preview').length===1&&!document.querySelector('#ai-find').disabled);
  if(config.description)await page.locator('#ai-description').fill(config.description);
  await page.locator('#ai-find').click();await page.waitForFunction(()=>!document.querySelector('#ai-cancel').disabled,null,{timeout:5000});
  await page.waitForFunction(()=>document.querySelector('#ai-cancel').disabled,null,{timeout:295000});
  const captured=await page.evaluate(()=>window.__kadrQA.find(r=>r.op==='recognize'));
  evidence.steps.push({name:'real-browser-upload-search',status:await page.locator('#ai-status').innerText(),candidates:await page.locator('#ai-candidates').innerText(),imageCleared:await page.locator('.preview').count()===0,captured});
  evidence.controlDescription=config.description||'';
 }else if(config.mode==='film'||config.mode==='season'){
  const type=config.mode==='film'?'movie':'tv',id=config.mode==='film'?45745:106379,number=config.mode==='film'?undefined:1;
  await page.locator('summary').click();await page.locator('#ai-title-query').fill(config.mode==='film'?'Sintel':'Fallout');await page.locator('#ai-catalog').click();
  const selected=page.locator('.candidate').filter({has:page.locator(`a[href$="/${type}/${id}"]`)});await selected.getByRole('button',{name:'Выбрать эту карточку'}).click();
  if(type==='tv'){await page.locator('#ai-season').selectOption('1');await page.getByRole('button',{name:'Проверить выпуск выбранного сезона'}).click();}
  await page.waitForFunction(()=>document.querySelectorAll('#ai-watched input').length>0,null,{timeout:60000});
  const watches=await page.locator('#ai-watched input').all();for(const input of watches)await input.check();
  evidence.watchedConfirmed=watches.length;evidence.preparation=await page.locator('#ai-gate').innerText();
  const responsePromise=page.waitForResponse(r=>r.url().includes('/api/ai')&&r.request().method()==='POST'&&r.request().postDataJSON()?.op==='analysis',{timeout:15000});
  await page.locator('#ai-analyze').click();await responsePromise;
  await page.waitForFunction(()=>window.__kadrQA.some(r=>r.op==='analysis'&&r.done),null,{timeout:295000});
  const captured=await page.evaluate(()=>window.__kadrQA.find(r=>r.op==='analysis'));
  evidence.steps.push({name:'real-UI-TMDB-scope-watch-sources-generation-review-UI',...captured});
  await page.waitForTimeout(300);evidence.rendered={verdict:await page.locator('#ai-verdict').innerText(),text:await page.locator('#ai-text').innerText(),sources:await page.locator('#ai-sources').innerText(),status:await page.locator('#ai-status').innerText()};
 }
 await page.screenshot({path:out+'/result.png',fullPage:true});await save();
 console.log(JSON.stringify({url:evidence.url,health:evidence.health,steps:evidence.steps.map(s=>({name:s.name,status:s.status,result:s.events?.at(-1)?.result?.status,error:s.events?.at(-1)?.error||s.body?.error,gate:s.body?.finality?.state||s.status})),errors:evidence.errors}));
}catch(e){evidence.failure=e.message;await save();console.log(JSON.stringify({failure:e.message}));process.exitCode=1;}
finally{await browser.close();}
