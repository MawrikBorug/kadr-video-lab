import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const token='b'.repeat(32),origin='https://tv-1-kinoserial.net';
const journal=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.v1')));
async function exported(p){const pending=p.waitForEvent('download');await p.click('#export-json');return JSON.parse(await readFile(await (await pending).path(),'utf8'));}
async function boot(p){await p.goto('./');await expect(p.locator('#build-info')).toContainText('commit');}
async function direct(p){await p.locator('#videoseed-search-panel details summary').click();await p.fill('#videoseed-player-token',token);await p.selectOption('#provider-mode','embed');await p.selectOption('#sample','custom');await p.fill('#title','Synthetic permitted fixture');await p.fill('#release-year','2024');await p.selectOption('#namespace','videoseed');await p.fill('#content-id','123');await p.check('#access-consent');}
test.beforeEach(async({page})=>{await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4173/')?r.continue():r.abort());});
test('clean primary set, moderation blocker and separate technical controls',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await boot(page);
 expect(await page.locator('#provider option').evaluateAll(xs=>xs.map(x=>x.value))).toEqual(['apple','blender','videoseed']);await expect(page.locator('#provider')).toHaveValue('videoseed');await expect(page.locator('input[name="batch-mode"]')).toHaveCount(1);
 await expect(page.locator('#videoseed-access-state')).toContainText('модерации');await page.fill('#videoseed-query','Synthetic search');await page.click('#videoseed-search');await expect(page.locator('#videoseed-search-status')).toContainText('закрытого адаптера');await expect(page.locator('iframe,video')).toHaveCount(0);
 await page.locator('#technical-checks summary').click();await page.click('#technical-blender');await expect(page.locator('#provider')).toHaveValue('blender');await expect(page.locator('#content-id')).toHaveValue('blender');expect(errors).toEqual([]);
});
test('direct official iframe, manual evidence and export never reveal player token',async({page})=>{
 await page.route(origin+'/**',r=>r.fulfill({contentType:'text/html',body:'<p>Synthetic frame only — no actual movie.</p><script>parent.postMessage({type:"play"},"*")</script>'}));await boot(page);await direct(page);await page.click('#open-source');await expect(page.locator('iframe')).toHaveAttribute('sandbox','allow-scripts allow-same-origin');
 let j=await exported(page);expect(j.records[0].evidence.manualMainVideo).toBe(false);expect(j.records[0].evidenceLevel).toBe('L0');await page.check('#main-video-confirmed');await page.selectOption('#ru-audio','yes');await page.fill('#obs-details-notes',token);
 j=await exported(page);expect(j.records[0].evidence.manualMainVideo).toBe(true);expect(JSON.stringify(j)).not.toContain(token);expect(JSON.stringify(await journal(page))).not.toContain(token);
 await page.click('#videoseed-forget');await expect(page.locator('iframe')).toHaveCount(0);await expect(page.locator('#videoseed-player-token')).toHaveValue('');
});
test('new Videoseed queue saves, interrupts and resumes one linked attempt',async({page})=>{
 await page.route(origin+'/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic iframe, no real playback.'}));await boot(page);await direct(page);await page.evaluate(()=>document.querySelectorAll('#batch > details').forEach(d=>d.open=true));await page.click('#batch-ready');await page.check('#batch-custom');await page.click('#batch-create');await expect(page.locator('#batch-preview-summary')).toContainText('применимо 1');await page.click('#batch-start');await expect(page.locator('#batch-status')).toContainText('Нужно ручное подтверждение');await page.click('#batch-pause');await expect(page.locator('iframe')).toHaveCount(0);await page.click('#batch-start');await expect(page.locator('#batch-status')).toContainText('Нужно ручное подтверждение');
 const j=await exported(page);expect(j.runs[0].queue[0].attempts).toHaveLength(2);expect(j.records[1].previousAttemptId).toBe(j.records[0].attemptId);expect(j.records[1].evidence.manualMainVideo).toBe(false);expect(JSON.stringify(j)).not.toContain(token);await page.click('#batch-cancel');
});
test('legacy queue stays archived after reload and cannot silently launch adapters',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('kadr.videoLab.v1',JSON.stringify({schemaVersion:2,records:[],runs:[{runId:'old-run',createdAt:'2026-10-20T00:00:00Z',status:'paused',queue:[{testId:'old-test',modeKey:'collaps:embed',config:{provider:'collaps',title:'Old fixture'},refId:'X04',status:'pending',attempts:[]}]}]})));
 await boot(page);await expect(page.locator('#batch-status')).toContainText('Архивная очередь');await expect(page.locator('#batch-start')).toBeDisabled();await expect(page.locator('#batch-retry')).toBeDisabled();await expect(page.locator('iframe,video')).toHaveCount(0);const j=await exported(page);expect(j.runs[0].queue[0].config.provider).toBe('collaps');
});
test('real search UI renders server results and selects a specific work, year, voice and episode',async({page})=>{
 await page.route('**/data/backend.json',r=>r.fulfill({json:{endpoint:'https://kadr-video-lab-adapter.vercel.app/api/adapter'}}));
 await page.route('https://kadr-video-lab-adapter.vercel.app/**',r=>r.fulfill({headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:{results:[{id:'123',title:'Synthetic catalog result',year:2024,type:'tv',kp:'555',choices:[{translation:'RU fixture',season:2,episode:3,embedURL:origin+'/embed/123?token='+token}]}]}}));
 await page.route(origin+'/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic episode fixture only.'}));await boot(page);await page.locator('#batch > details').first().locator('summary').click();await page.fill('#adapter-access','fixture-lab-password');await page.fill('#videoseed-query','Synthetic');await page.fill('#videoseed-year','2024');await page.selectOption('#videoseed-type','tv');await page.fill('#season','2');await page.fill('#episode','3');await page.check('#access-consent');await page.click('#videoseed-search');
 await expect(page.locator('#videoseed-results')).toContainText('Synthetic catalog result (2024)');await page.locator('#videoseed-results button').click();await expect(page.locator('iframe')).toHaveCount(1);const j=await exported(page);expect(j.records[0].config.title).toBe('Synthetic catalog result');expect(j.records[0].config.season).toBe('2');expect(j.records[0].config.episode).toBe('3');expect(j.records[0].evidence.manualMainVideo).toBe(false);expect(JSON.stringify(j)).not.toContain(token);
});
