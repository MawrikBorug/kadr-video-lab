import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const journal=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('kadr.videoLab.v1')));
async function boot(page){await page.goto('./');await expect(page.locator('#build-info')).toContainText('commit');await page.check('#access-consent');}
async function manual(page,provider='vidlink'){await page.selectOption('#provider',provider);await page.selectOption('#sample','dune');await page.click('#open-source');}
async function batch(page,modes,subjects,profile='quick'){
 await page.evaluate(()=>document.querySelectorAll('#batch > details').forEach(d=>d.open=true));
 for(const key of modes)await page.check(`input[name="batch-mode"][value="${key}"]`);
 for(const key of subjects)await page.check(`input[name="batch-subject"][value="${key}"]`);
 await page.selectOption('#batch-profile',profile);await page.click('#batch-create');await page.click('#batch-start');await expect(page.locator('#batch-status')).toContainText('Нужно ручное подтверждение');
}
async function exported(page){const waiting=page.waitForEvent('download');await page.click('#export-json');const f=await waiting;return JSON.parse(await readFile(await f.path(),'utf8'));}
test.beforeEach(async({context})=>{await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4173/')?r.continue():r.abort());});
test('sandbox error plus play message never becomes video evidence; manual observation and changed VPN are separate',async({page})=>{
 await page.route('https://vidlink.pro/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><p>Please disable sandbox. Synthetic regression fixture.</p><script>parent.postMessage({type:"PLAYER_EVENT",event:"play",currentTime:1,duration:100},"*")</script>'}));
 await boot(page);await manual(page);await expect.poll(async()=> (await journal(page)).records[0].events.some(e=>e.channel==='postMessage')).toBe(true);
 let j=await exported(page);expect(j.records[0].evidence.manualMainVideo).toBe(false);expect(j.records[0].evidenceLevel).toBe('L0');
 await page.check('#main-video-confirmed');await page.selectOption('#ru-audio','no');await expect(page.locator('#evidence-summary')).toContainText('подтверждено вручную');
 const before=(await journal(page)).records[0];await page.locator('#phone-conditions summary').click();await page.selectOption('#next-vpn','on');await page.selectOption('#next-network','mobile');await page.click('#conditions-apply');await page.click('#retry-conditions');
 j=await exported(page);expect(j.records).toHaveLength(2);expect(j.records[0].environment).toEqual(before.environment);expect(j.records[0].environment.vpn).toBe('unknown');expect(j.records[1].environment.vpn).toBe('on');expect(j.records[1].previousAttemptId).toBe(before.attemptId);expect(j.records[1].testId).toBe(before.testId);expect(j.records[0].evidence.manualMainVideo).toBe(true);expect(j.records[1].evidence.manualMainVideo).toBe(false);
});
test('diagnostic iframe requires an explicit choice and keeps the protected original attempt',async({page})=>{
 await page.route('https://vaplayer.ru/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic sandbox incompatibility fixture; no film.'}));
 await boot(page);await manual(page,'vidapi');await expect(page.locator('iframe')).toHaveAttribute('sandbox','allow-scripts allow-same-origin');
 await page.click('#diagnostic-show');await page.click('#diagnostic-start');await expect(page.locator('iframe')).toHaveAttribute('sandbox','allow-scripts allow-same-origin');
 await page.check('#diagnostic-ack');await page.click('#diagnostic-start');await expect(page.locator('iframe')).not.toHaveAttribute('sandbox');
 const j=await journal(page);expect(j.records).toHaveLength(2);expect(j.records[0].config.sandbox).toBe('strict');expect(j.records[1].config.diagnosticConsentVersion).toBe(2);expect(j.records[1].previousAttemptId).toBe(j.records[0].attemptId);expect(j.records[1].checks.videoStarted).toBe('NOT_RUN');
});
test('one reported sandbox blocker suppresses later titles for that mode while preserving an explicit retry',async({page})=>{
 await page.route('https://vidlink.pro/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic sandbox error'}));await boot(page);await batch(page,['vidlink:embed'],['dune','fallout']);
 await page.selectOption('#attempt-diagnosis','lab-sandbox');await page.fill('#diagnosis-note','Synthetic Please disable sandbox');await page.click('#complete-current');await expect(page.locator('#batch-status')).toContainText('Диагностика завершена');
 const j=await journal(page);expect(j.records).toHaveLength(1);expect(j.runs[0].queue[0].status).toBe('failed');expect(j.runs[0].queue[1].status).toBe('skipped');expect(j.runs[0].queue[1].reason.code).toBe('mode-stopped');
 await page.locator('#batch-results details').nth(1).locator('summary').click();await page.locator('#batch-results details').nth(1).locator('input').check();await page.click('#batch-retry');expect((await journal(page)).runs[0].queue[1].status).toBe('pending');
});
test('Mikai exact fresh episode opens only the selected upstream and keeps embed URL out of journal',async({page})=>{
 await page.route('https://api.mikai.me/**',r=>r.fulfill({json:{ok:true,result:{anime:{ids:{mal:52299},year:2024,titles:'Synthetic Solo fixture'},releases:[{id:77,kind:'voice',teams:[{name:'Fixture team'}],episodes:[{number:1,sources:[{provider:'Ashdi',embedUrl:'https://ashdi.vip/private-fixture-path'},{provider:'MoonAnime',embedUrl:'https://moonanime.art/second-fixture'}]}]}]}}}));
 await page.route('https://ashdi.vip/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic upstream; no actual media.'}));
 await boot(page);await page.selectOption('#provider','mikai');await page.selectOption('#provider-mode','embed');await page.selectOption('#sample','solo');await page.click('#open-source');await page.locator('#api-results button').filter({hasText:'Ashdi'}).click();
 await expect(page.locator('iframe')).toHaveAttribute('src','https://ashdi.vip/private-fixture-path');await expect(page.locator('#api-results button')).toHaveCount(2);for(const b of await page.locator('#api-results button').all())await expect(b).toBeDisabled();const j=await exported(page);expect(j.records[0].config.upstream).toBe('https://ashdi.vip');expect(j.records[0].technical.selectedVariant.episode).toBe(1);expect(JSON.stringify(j)).not.toContain('private-fixture-path');expect(j.records[0].evidenceLevel).toBe('L2');
 await page.click('#diagnostic-show');await page.check('#diagnostic-ack');await page.click('#diagnostic-external');await expect(page.locator('iframe')).toHaveCount(0);await expect(page.locator('.external-launch')).toHaveAttribute('href','https://ashdi.vip/private-fixture-path');const next=await exported(page);expect(next.records[1].previousAttemptId).toBe(next.records[0].attemptId);expect(next.records[1].config.upstream).toBe('https://ashdi.vip');expect(JSON.stringify(next)).not.toContain('private-fixture-path');
});
test('external page returns to the same queued attempt and cannot continue without closure confirmation',async({page,context})=>{
 await context.route('https://tubitv.com/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic external viewer; no film.'}));
 await boot(page);await batch(page,['sitetubi:site'],['dune']);const before=(await journal(page)).records[0].attemptId;
 const popup=context.waitForEvent('page');await page.locator('.external-launch').click();const external=await popup;await external.waitForLoadState('domcontentloaded');
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('#batch-status')).toContainText('Нужно ручное подтверждение');expect((await journal(page)).records[0].attemptId).toBe(before);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.click('#complete-current');await expect(page.locator('#message')).toContainText('закройте внешний плеер');await external.close();await page.check('#external-closed');await page.check('#main-video-confirmed');await page.click('#complete-current');await expect(page.locator('#batch-status')).toContainText('Диагностика завершена');
 const j=await exported(page);expect(j.records[0].technical.externalClosed.confirmed).toBe(true);expect(j.records[0].evidence.manualMainVideo).toBe(true);expect(j.records[0].measurement).toBeUndefined();
});
test('five-minute iframe profile requires actual manual duration; rejected completion remains pausable',async({page})=>{
 await page.route('https://vidlink.pro/**',r=>r.fulfill({contentType:'text/html',body:'Synthetic manual-duration fixture'}));await boot(page);await batch(page,['vidlink:embed'],['dune'],'five');
 await page.check('#main-video-confirmed');await page.fill('#obs-details-watchMinutes','0.1');await page.click('#complete-current');await expect(page.locator('#message')).toContainText('не менее 5');await page.click('#batch-pause');await expect(page.locator('#batch-status')).toContainText('Пауза');await expect(page.locator('#batch-start')).toBeEnabled();
 expect((await journal(page)).records[0].queueStatus).toBe('interrupted');
});
