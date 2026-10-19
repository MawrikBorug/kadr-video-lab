import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const journal=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.v1')));
const prime={info:{title:'Fixture Dune',imdb_id:'tt15239678',tmdb_id:'tt15239678'},servers:[{name:'Fixture Filemoon',audio_language:'en'}]};
test.beforeEach(async({page})=>{await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4173/')?route.continue():route.abort());});
async function boot(page){await page.goto('./');await expect(page.locator('#registry-count')).toContainText('125');await expect(page.locator('#sample option')).toHaveCount(18);await page.check('#access-consent');await page.evaluate(()=>document.querySelectorAll('#batch > details').forEach(d=>d.open=true));}
async function choose(page,modes,subjects){for(const key of modes)await page.check(`input[name="batch-mode"][value="${key}"]`);for(const key of subjects)await page.check(`input[name="batch-subject"][value="${key}"]`);await page.click('#batch-create');}
async function json(page){const waiting=page.waitForEvent('download');await page.click('#export-json');const file=await waiting;return JSON.parse(await readFile(await file.path(),'utf8'));}
test('phone builds a mixed queue, sees missing IDs, saves partial export and requires iframe confirmation',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://primesrc.me/api/**',r=>r.fulfill({json:prime}));
 await page.route('https://yapgrid.com/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic fixture — no film playback.'}));
 await boot(page);await choose(page,['primesrc:catalog','yapgrid:embed'],['dune','t07']);
 await expect(page.locator('#batch-preview-summary')).toContainText('применимо 2, пропусков 2');
 const partial=await json(page);expect(partial.runs[0].queue).toHaveLength(4);expect(partial.records).toHaveLength(0);
 await page.click('#batch-start');await expect(page.locator('#batch-status')).toContainText('Нужно ручное подтверждение');
 const saved=await journal(page);expect(saved.records).toHaveLength(2);expect(saved.records[1].checks.videoStarted).toBe('NOT_RUN');
 await page.check('#main-video-confirmed');await page.click('#confirm-identity');await page.click('#complete-current');
 await expect(page.locator('#batch-status')).toContainText('Диагностика завершена');
 const full=await json(page);expect(full.runs[0].queue.map(i=>i.testId)).toEqual(partial.runs[0].queue.map(i=>i.testId));expect(full.records[1].manualConfirmations.length).toBeGreaterThan(0);expect(full.records[1].evidenceLevel).not.toMatch(/L[345]/);
 await page.reload();await expect(page.locator('#batch-status')).toContainText('Диагностика завершена');await expect(page.locator('video,iframe')).toHaveCount(0);
 expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'artifacts/batch-mobile.png',fullPage:true});
});
test('in-flight pause and reload keep attempts; resume creates a linked attempt without losing results',async({page})=>{
 let release;const gate=new Promise(r=>release=r);let count=0;
 await page.route('https://primesrc.me/api/**',async r=>{if(++count===1)await gate;try{await r.fulfill({json:prime});}catch{}});
 await boot(page);await choose(page,['primesrc:catalog'],['dune']);await page.click('#batch-start');
 await expect.poll(()=>count).toBe(1);await page.click('#batch-pause');release();
 await expect(page.locator('#batch-status')).toContainText('Пауза');await page.reload();
 const before=await journal(page);expect(before.runs[0].queue[0].attempts[0].status).toBe('interrupted');
 await page.click('#batch-start');await expect(page.locator('#batch-status')).toContainText('Диагностика завершена');
 const after=await journal(page),attempts=after.runs[0].queue[0].attempts;expect(attempts).toHaveLength(2);expect(attempts[1].previousAttemptId).toBe(attempts[0].attemptId);expect(after.records).toHaveLength(2);
});
test('app error in HTTP 200 is exported as auth-required and chosen retry gets a new attempt',async({page})=>{
 let calls=0;await page.route('https://primesrc.me/api/**',r=>r.fulfill({json:++calls===1?{error:401,message:'Fixture authorization error'}:prime}));
 await boot(page);await choose(page,['primesrc:catalog'],['dune']);await page.click('#batch-start');await expect(page.locator('#batch-status')).toContainText('Диагностика завершена');
 let data=await journal(page);expect(data.records[0].technical.error).toMatchObject({code:'auth-required',httpStatus:200,appStatus:401});expect(calls).toBe(1);
 await page.locator('#batch-results details summary').click();await page.check('input[name="batch-retry-item"]');await page.click('#batch-retry');await page.click('#batch-start');await expect(page.locator('#batch-status')).toContainText('Диагностика завершена');
 data=await json(page);expect(data.runs[0].queue[0].attempts).toHaveLength(2);expect(data.records[0].attemptId).not.toBe(data.records[1].attemptId);expect(data.records[1].previousAttemptId).toBe(data.records[0].attemptId);
});
test('sound autoplay rejection pauses at a user action and never mutes to fabricate success',async({page})=>{
 await page.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('Synthetic autoplay fixture','NotAllowedError'));};});
 let release;const gate=new Promise(r=>release=r);await page.route('https://download.blender.org/**',async r=>{await gate;try{await r.abort();}catch{}});
 await boot(page);await choose(page,['blender:media'],['blender']);await page.fill('#batch-limit','1');await page.click('#batch-start');
 await expect(page.locator('#batch-status')).toContainText('Нужно касание');expect(await page.locator('video').evaluate(v=>v.muted)).toBe(false);
 const before=await journal(page);expect(before.records[0].measurement.watchSeconds).toBe(0);expect(before.records[0].checks.videoStarted).toBe('NOT_RUN');
 await page.click('#batch-cancel');release();await expect(page.locator('#batch-status')).toContainText('Отменена');
});
test('manual provider, ID, season and fractional anime ordinal remain independent; API candidates require confirmation',async({page})=>{
 await page.route('https://api.filmix.tv/api-fx/list**',r=>r.fulfill({json:{status:'ok',items:[{id:170881,title:'Дюна: Часть вторая',year:2024},{id:1,title:'Другая Дюна',year:1984}]}}));
 await page.route('https://api.filmix.tv/api-fx/post/**',r=>r.fulfill({status:403,json:{error:'Fixture blocked'}}));
 await boot(page);await page.selectOption('#provider','filmix');await page.selectOption('#sample','dune');await page.click('#open-source');
 await expect(page.locator('#api-results button')).toHaveCount(2);expect((await journal(page)).records[0].layers.identity.status).toBe('needs-confirmation');
 await page.locator('#api-results button').first().click();await expect(page.locator('#message')).toContainText('HTTP 403');
 expect((await journal(page)).records[0].manualConfirmations.some(c=>c.field==='identity.filmix')).toBe(true);
 await page.click('#new-session');await page.selectOption('#provider','mikai');await page.selectOption('#sample','custom');await page.fill('#title','Мой эпизод');await page.fill('#content-id','52299');await page.fill('#episode','1.5');await expect(page.locator('#episode')).toHaveValue('1.5');
});
test('Stellar READY binds INIT to the exact frame/origin; events still cannot prove main video',async({page})=>{
 await page.route('https://stellar.rip/**',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><p>Stellar protocol fixture only</p><script>window.addEventListener('message',e=>{if(e.data?.type==='STELLAR_EMBED_INIT')parent.postMessage({type:'PLAYER_EVENT',data:{event:'play',currentTime:1,duration:100,tmdbId:'693134'}},'*');});parent.postMessage({type:'STELLAR_EMBED_READY'},'*');</script>`}));
 await boot(page);await page.selectOption('#provider','stellar');await page.selectOption('#sample','dune');await page.click('#open-source');
 await expect.poll(async()=>Boolean((await journal(page)).records.at(-1).technical.handshake?.readyObserved)).toBe(true);
 await expect.poll(async()=>(await journal(page)).records.at(-1).events.some(e=>e.type==='play'&&e.channel==='postMessage')).toBe(true);
 const data=await journal(page),r=data.records.at(-1);expect(r.technical.handshake.initSent).toBe(true);expect(r.events.some(e=>e.type==='play'&&e.channel==='postMessage')).toBe(true);expect(r.checks.videoStarted).toBe('NOT_RUN');expect(r.layers.mainVideo).toBeUndefined();
});
test('Archive uses the explicit Sintel metadata identifier without substituting an N14 film',async({page})=>{
 await page.route('https://archive.org/metadata/Sintel',r=>r.fulfill({json:{metadata:{identifier:'Sintel',title:'Sintel',year:2010,licenseurl:'https://creativecommons.org/licenses/by/3.0/'},files:[{name:'fixture'}]}}));
 await boot(page);await page.selectOption('#provider','archive');await expect(page.locator('#sample')).toHaveValue('archive-sintel');await expect(page.locator('#namespace')).toHaveValue('archive');await page.click('#open-source');
 await expect(page.locator('#api-results')).toContainText('Метаданные полнометражного Sintel');const r=(await journal(page)).records.at(-1);expect(r.config.id).toBe('Sintel');expect(r.layers.identity.status).toBe('matched');expect(r.checks.videoStarted).toBe('NOT_RUN');
});
test('manual queue skip is distinct from interruption in the record and export',async({page})=>{
 await page.route('https://yapgrid.com/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic iframe fixture.'}));
 await boot(page);await choose(page,['yapgrid:embed'],['dune']);await page.click('#batch-start');await expect(page.locator('#batch-status')).toContainText('Нужно ручное подтверждение');
 await page.fill('#batch-skip-reason','Fixture: no observable content');await page.click('#batch-skip');await expect(page.locator('#batch-status')).toContainText('Диагностика завершена');
 const data=await json(page);expect(data.runs[0].queue[0].status).toBe('skipped');expect(data.records[0].queueStatus).toBe('skipped');expect(data.records[0].technical.interruptionReason.reason).toContain('Fixture');
});
