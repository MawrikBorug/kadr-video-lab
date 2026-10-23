// ALL responses/events in this file are SYNTHETIC, not observed Lift playback.
import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const KEY = 'kadr.videoLab.experiments.v1', OLD = 'kadr.videoLab.v1';
const journal = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
async function exported(page) {
  const pending = page.waitForEvent('download'); await page.click('#export');
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}
async function fixture(page, messages = [{event:'playerReady'}, {event:'startWatching'}, {event:'viewProgress',time:24,duration:888}]) {
  let count = 0;
  await page.route('https://api.liftw.ws/info/3637', route => {
    count++;
    return route.fulfill({json:{id:3637,origin_name:'Sintel',year:2010,iframe_uri:'https://embed.liftw.ws/embed/movie/3637?fixture=PRIVATE_FIXTURE'},headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.route('https://embed.liftw.ws/**', route => route.fulfill({contentType:'text/html',body:`<!doctype html><p>SYNTHETIC FIXTURE — not Lift</p><script>
    addEventListener('message',e=>{if(e.data==='ping')e.source.postMessage('pong',e.origin)});
    const events=${JSON.stringify(messages)};events.forEach((data,i)=>setTimeout(()=>parent.postMessage(data,'*'),50+i*30));
  </script>`}));
  return () => count;
}

test('mobile shell loads without external calls or JavaScript errors', async ({page}) => {
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173')) external.push(new URL(r.url()).origin); });
  await page.goto('./'); await expect(page.locator('#run-info')).toContainText('Прогон');
  await expect(page.locator('iframe, video[src]')).toHaveCount(0);
  await expect(page.locator('#environment')).toContainText('не standalone');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('fresh API every reload, real-window source validation, ping and separate restore comparison', async ({page}) => {
  const calls = await fixture(page, [{event:'playerReady'}, {event:'startWatching'}, {event:'viewProgress',time:24,duration:888}, {event:'endedSoon'}, {event:'viewProgress',time:'99',duration:888}]);
  await page.goto('./'); await page.click('#start');
  await expect(page.locator('#position')).toContainText('24.0 / 888.0');
  await expect(page.locator('#end-state')).toContainText('endedSoon');
  await expect(page.locator('#end-state')).toContainText('ещё не подтверждён');
  await page.click('#ping'); await expect(page.locator('#bridge')).toContainText('настоящий pong');
  await page.evaluate(() => {
    dispatchEvent(new MessageEvent('message',{origin:'https://embed.liftw.ws',source:window,data:{event:'viewProgress',time:500,duration:888}}));
    dispatchEvent(new MessageEvent('message',{origin:'https://evil.test',source:document.querySelector('iframe').contentWindow,data:{event:'ended'}}));
  });
  await expect.poll(async () => (await journal(page)).runs[0].rejectedMessages).toBeGreaterThanOrEqual(3);
  await page.click('#reload'); await expect(page.locator('#restore')).toContainText('первое новое событие — 24.0');
  expect(calls()).toBe(2);
  const out = await exported(page), text = JSON.stringify(out);
  expect(text).not.toContain('PRIVATE_FIXTURE'); expect(text).not.toContain('iframe_uri');
  expect(text).not.toContain('"time":500'); expect(out.run.generation).toBe(2);
  expect(out.run.events.some(e => e.kind==='restore_comparison' && e.automaticSeekAttempted===false)).toBe(true);
  expect(out.savedPosition.time).toBe(24); expect(out.environment.userAgentIncluded).toBe(false);
  expect(out.environment.userAgent).toBeUndefined(); expect(out.run.coverage).toBeUndefined();
});

test('HTTP/provider and network failures stay explicit and do not become playback', async ({page}) => {
  await page.route('https://api.liftw.ws/info/3637', route => route.fulfill({status:403,json:{error:'Region US https://private.test/?t=PRIVATE_FIXTURE'},headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.goto('./'); await page.click('#start');
  await expect(page.locator('#status')).toContainText('HTTP 403');
  await expect(page.locator('#status')).toContainText('Region US');
  await expect(page.locator('iframe')).toHaveCount(0);
  const out = await exported(page); expect(JSON.stringify(out)).not.toContain('PRIVATE_FIXTURE');
  expect(out.run.events.some(e=>e.kind==='api_error' && e.httpStatus===403)).toBe(true);
  await page.unroute('https://api.liftw.ws/info/3637');
  await page.route('https://api.liftw.ws/info/3637', route=>route.abort());
  await page.click('#start'); await expect(page.locator('#status')).toContainText('CORS');
  await expect(page.locator('#play-state')).toContainText('Нет реальных');
});

test('journal survives navigation, saves lifecycle/notes, and separates standalone runs', async ({page, context}) => {
  await fixture(page); await page.goto('./'); await page.click('#start');
  await expect(page.locator('#position')).toContainText('24.0');
  const first = (await journal(page)).runs[0].runId;
  await page.selectOption('#note','video_audio');
  await page.fill('#diagnostic','//private.test/?s=PRIVATE_FIXTURE'); await page.click('#mark');
  await page.evaluate(()=>{dispatchEvent(new Event('offline'));document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('online'));});
  await page.reload(); await expect(page.locator('#run-info')).toContainText(first);
  await expect(page.locator('#saved')).toContainText('24.0'); await expect(page.locator('iframe')).toHaveCount(0);
  const out=await exported(page); expect(out.run.events.some(e=>e.kind==='network' && e.online===false)).toBe(true);
  expect(out.run.events.some(e=>e.kind==='visibility')).toBe(true);
  expect(out.run.events.some(e=>e.kind==='manual_observation')).toBe(true);
  expect(JSON.stringify(await journal(page))).not.toContain('PRIVATE_FIXTURE');
  await page.check('#include-ua'); expect((await exported(page)).environment.userAgent).toBeTruthy();
  await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
  await page.reload(); await expect(page.locator('#environment')).toContainText('Экран «Домой»');
  const next=await journal(page); expect(next.runs).toHaveLength(2);
  expect(next.runs.map(r=>r.mode)).toEqual(['browser','standalone']);
});

test('old journal/settings remain byte-identical and export without old credentials', async ({page}) => {
  const old=JSON.stringify({records:[{note:'old observation',url:'https://private.test/?s=PRIVATE_FIXTURE',token:'PRIVATE_FIXTURE'}],runs:[{status:'paused'}]});
  await page.addInitScript(({old,OLD})=>{localStorage.setItem(OLD,old);localStorage.setItem('unrelated-settings','KEEP');},{old,OLD});
  await page.goto('./'); await page.getByText('Данные прежнего стенда',{exact:true}).click();
  await expect(page.locator('#legacy-status')).toContainText('найден');
  const pending=page.waitForEvent('download'); await page.click('#legacy-export');
  const backup=JSON.parse(await readFile(await (await pending).path(),'utf8'));
  expect(backup.data.records[0].note).toBe('old observation');expect(backup.data.runs[0].status).toBe('paused');
  expect(JSON.stringify(backup)).not.toContain('PRIVATE_FIXTURE');
  expect(await page.evaluate(key=>localStorage.getItem(key),OLD)).toBe(old);
  expect(await page.evaluate(()=>localStorage.getItem('unrelated-settings'))).toBe('KEEP');
});

test('corrupt new journal is preserved; observations can still be exported from memory', async ({page}) => {
  await page.addInitScript(key=>{localStorage.setItem(key,'broken-fixture');},KEY);
  await page.goto('./'); await expect(page.locator('#storage-warning')).toBeVisible();
  await page.click('#mark'); const out=await exported(page);
  expect(out.run.events.some(e=>e.kind==='manual_observation')).toBe(true);
  expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe('broken-fixture');
});

test('storage quota failure stays visible and JSON still contains new observations', async ({page}) => {
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError');};});
  await page.goto('./'); await expect(page.locator('#storage-warning')).toContainText('Не удалось сохранить');
  await page.click('#mark'); const out=await exported(page);
  expect(out.run.events.some(e=>e.kind==='manual_observation')).toBe(true);
});

test('actual archived worker updates at same scope; only its shell cache is removed', async ({browser}) => {
  let oldMode=true,releaseLate;const lateStarted=new Promise(resolve=>{globalThis.qaLateStart=resolve;});
  const oldWorker=(await readFile('tests/fixtures/pre-lift-sw.js','utf8')).replace('__BUILD_ID__','abcdef123456');
  const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.webmanifest':'application/manifest+json'};
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(oldMode){
      const script=pathname.endsWith('/sw.js');
      res.writeHead(200,{'Content-Type':script?'text/javascript':'text/html','Cache-Control':'no-store'});
      res.end(script?oldWorker:'<!doctype html><h1>Прежняя оболочка — synthetic fixture</h1>');return;
    }
    if(req.headers['x-kadr-delay']==='1'){releaseLate=()=>{if(res.writableEnded)return;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{}');};globalThis.qaLateStart();return;}
    try{
      const relative=pathname.replace(/^\/kadr-video-lab\//,'')||'index.html';
      const body=await readFile(path.join('dist',relative));
      res.writeHead(200,{'Content-Type':mime[path.extname(relative)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/kadr-video-lab/`;
  const context=await browser.newContext(); const page=await context.newPage();
  try{
    await page.goto(base);
    await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});
    await page.reload();expect(await page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
    await page.evaluate(async()=>{
      localStorage.setItem('kadr.videoLab.v1','KEEP_OLD_JOURNAL');localStorage.setItem('unrelated-settings','KEEP');
      await (await caches.open('another-app')).put('/another-project/data',new Response('KEEP'));
      await (await caches.open('kadr-lab-0123456789ab')).put('/another-project/data',new Response('KEEP'));
    });
    const olderTab=await context.newPage();await olderTab.goto(base);
    oldMode=false;
    await olderTab.evaluate(()=>{window.qaLateDone=false;fetch('./build-info.json',{headers:{'X-Kadr-Delay':'1'}}).then(r=>r.text()).then(()=>window.qaLateDone=true);});await lateStarted;
    await page.reload();await expect(page.locator('h1')).toHaveText('Поиск и проверка источников');
    await expect(page.locator('#search-start')).toBeEnabled();
    // An outstanding fetch can keep the retiring worker alive; do not wait for
    // its replacement while deliberately withholding that response.
    releaseLate();await olderTab.waitForFunction(()=>window.qaLateDone);
    await expect.poll(()=>page.evaluate(()=>caches.keys()),{timeout:15000}).not.toContain('kadr-lab-abcdef123456');
    await olderTab.close();
    const keys=await page.evaluate(()=>caches.keys());expect(keys).toContain('another-app');expect(keys).toContain('kadr-lab-0123456789ab');
    expect(await page.evaluate(()=>localStorage.getItem('kadr.videoLab.v1'))).toBe('KEEP_OLD_JOURNAL');
    expect(await page.evaluate(()=>localStorage.getItem('unrelated-settings'))).toBe('KEEP');
    await page.reload();await expect(page.locator('h1')).toHaveText('Поиск и проверка источников');
  }finally{releaseLate?.();delete globalThis.qaLateStart;await context.close();await new Promise(resolve=>server.close(resolve));}
});
