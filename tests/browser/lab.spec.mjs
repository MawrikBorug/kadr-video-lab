import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { passedE1, completedE2 } from '../fixtures.mjs';
const journal = page => page.evaluate(() => JSON.parse(localStorage.getItem('kadr.videoLab.v1')));
const fixtureRelease = { name:{main:'Synthetic fixture — not a real playback result'}, episodes:[{ordinal:1,name:'Fixture',duration:1200,hls_480:'https://cache.libria.fun/fixture.m3u8?isWithVideoAds=1&isWithVideoAdsAlways=1'}] };

test.beforeEach(async ({ page }) => {
  // All external traffic is denied unless a test explicitly provides a fixture.
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4173/') ? route.continue() : route.abort());
});
async function boot(page) { await page.goto('./'); await expect(page.locator('#sample option')).toHaveCount(18); }
async function chooseYap(page) { await page.selectOption('#provider','yapgrid'); await page.selectOption('#sample','dune'); await page.check('#access-consent'); }
async function chooseBlocked(page) { await page.selectOption('#provider','ezvidapi'); await page.check('#access-consent'); await page.click('#open-source'); await expect(page.locator('#message')).toContainText('Источник не подтвердился'); }
async function jsonDownload(page) {
  const waiting=page.waitForEvent('download'); await page.click('#export-json'); const file=await waiting; return JSON.parse(await readFile(await file.path(),'utf8'));
}

test('mobile UI loads without external calls; blocked source is explicit and exported',async({page})=>{
  const errors=[]; page.on('pageerror',error=>errors.push(error.message)); const external=[]; page.on('request',request=>{if(request.url().startsWith('https://'))external.push(request.url());});
  await boot(page); await expect(page.locator('h1')).toContainText('Фиксируем факты'); expect(external).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await chooseBlocked(page); await expect(page.locator('iframe,video')).toHaveCount(0);
  const data=await jsonDownload(page); expect(data.records).toHaveLength(1); expect(data.records[0].status).toBe('INCONCLUSIVE'); expect(data.records[0].checks.videoStarted).toBe('NOT_RUN'); expect(data.records[0].technical.blocked).toBe('unknown-contract');
  expect(errors).toEqual([]); expect(external).toEqual([]);
  await page.screenshot({path:'artifacts/mobile-lab.png',fullPage:true});
});

test('real iframe boundary keeps sandbox and rejects even correctly sourced undocumented messages',async({page,context})=>{
  await page.route('https://yapgrid.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><p>Synthetic iframe fixture, not YapGrid playback.</p><button id="try">Try windows</button><script>parent.postMessage({type:"playing",currentTime:1,duration:10},"*");document.getElementById("try").onclick=()=>{window.open("https://blocked.example/","_blank");try{top.location="https://blocked.example/"}catch{}}</script>'}));
  await boot(page); await chooseYap(page); await page.click('#open-source');
  await expect(page.locator('iframe')).toHaveAttribute('sandbox','allow-scripts allow-same-origin'); await expect(page.locator('iframe')).toHaveAttribute('referrerpolicy','strict-origin-when-cross-origin');
  await expect(page.locator('#message')).toContainText('событие загрузки iframe');
  await expect.poll(async()=> (await journal(page)).records[0].rejectedMessages).toBeGreaterThan(0);
  expect((await journal(page)).records[0].checks.videoStarted).toBe('NOT_RUN');
  await page.frameLocator('iframe').locator('#try').click(); expect(context.pages()).toHaveLength(1); await expect(page).toHaveURL(/\/kadr-video-lab\/$/);
  const data=await jsonDownload(page); expect(data.records[0].events.some(e=>e.channel==='postMessage')).toBe(false);
});

test('without-sandbox comparison needs acknowledgement; conditions stay fixed within a session',async({page})=>{
  await page.route('https://yapgrid.com/**',route=>route.fulfill({contentType:'text/html',body:'Synthetic fixture only.'}));
  await boot(page); await chooseYap(page); await page.selectOption('#sandbox','documented'); await page.click('#open-source'); await expect(page.locator('#message')).toContainText('подтвердите предупреждение'); await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#sandbox-warning')).toContainText('Не используйте этот режим первым тестом на личном iPhone');
  await page.check('#unrestricted-consent'); await page.click('#open-source'); await expect(page.locator('#message')).toContainText('чистая тестовая сессия'); await expect(page.locator('iframe')).toHaveCount(0);
  await page.check('#clean-session-consent'); await page.click('#open-source'); await expect(page.locator('iframe')).not.toHaveAttribute('sandbox');
  await expect(page.locator('#provider')).toBeDisabled(); await page.click('#new-session'); await expect(page.locator('iframe')).toHaveCount(0); await expect(page.locator('#provider')).toBeEnabled();
  await expect(page.locator('#sandbox')).toHaveValue('strict'); await expect(page.locator('#clean-session-consent')).not.toBeChecked(); await expect(page.locator('#sandbox-warning')).toBeHidden();
  await chooseBlocked(page); const data=await jsonDownload(page); expect(data.records).toHaveLength(2); expect(data.records[0].config.provider).toBe('yapgrid'); expect(data.records[1].config.provider).toBe('ezvidapi');
});

async function seedManualFixture(page, records) {
  await page.addInitScript(records=>{if(!localStorage.getItem('kadr.videoLab.v1'))localStorage.setItem('kadr.videoLab.v1',JSON.stringify({schemaVersion:1,records}));},records);
}
async function fixtureFrame(page) { await page.route('https://yapgrid.com/**',route=>route.fulfill({contentType:'text/html',body:'Synthetic fixture only; no actual playback.'})); }
async function e2Checks(page) { for(const key of ['pageOpened','exactTitle','videoStarted','pause'])await page.selectOption(`#obs-checks-${key}`,'PASS'); }
async function noAds(page) { for(const key of ['preRoll','midRoll','postRoll','overlay','popup','navigation'])await page.selectOption(`#obs-ads-${key}`,'NOT_OBSERVED'); }

test('audit regression: E2 without E1 stays preliminary and blank-ad smoke cannot pass',async({page})=>{
  await fixtureFrame(page); await boot(page); await chooseYap(page); await page.selectOption('#stage','E2'); await expect(page.locator('#e1-warning')).toContainText('E1 не подтверждён');
  await page.selectOption('#device','iphone-safari');await page.selectOption('#country','RU');await page.selectOption('#network','home');await page.click('#open-source');await e2Checks(page);await page.selectOption('#outcome','PASS');
  await expect(page.locator('#outcome')).toHaveValue('INCONCLUSIVE');await expect(page.locator('#consistency')).toContainText('рекламные категории');await expect(page.locator('#e2-assessment')).not.toContainText('без рекламы: PASS');
  const data=await jsonDownload(page);const r=data.records[0];expect(r.assessment.statusMeaning).toBe('E2_FULL_SESSION_AD_FREE_AND_BASIC_CONTROL');expect(r.assessment.eligibilityIssues.join(' ')).toContain('E1 не подтверждён');expect(r.config.e1RecordId).toBeNull();
});

test('audit regression: completed smoke has a distinct observation result with linked E1 across networks',async({page})=>{
  const e1=passedE1();await seedManualFixture(page,[e1]);await fixtureFrame(page);await boot(page);await page.click('#new-session');await chooseYap(page);await page.selectOption('#stage','E2');
  await expect(page.locator('#e1-record')).toHaveValue(e1.id);await page.selectOption('#network','mobile');await page.click('#open-source');await e2Checks(page);await noAds(page);await page.fill('#obs-details-watchMinutes','30');await page.click('#stop');await page.selectOption('#outcome','PASS');
  await expect(page.locator('#outcome')).toHaveValue('INCONCLUSIVE');await expect(page.locator('#e2-assessment')).toContainText('Проба наблюдений: PASS');await expect(page.locator('#e2-assessment')).toContainText('без рекламы: INCONCLUSIVE');
  await page.reload();await expect(page.locator('#e2-assessment')).toContainText('Проба наблюдений: PASS');const data=await jsonDownload(page);expect(data.records[1].config.e1RecordId).toBe(e1.id);expect(data.records[1].assessment.probeStatus).toBe('PASS');expect(data.records[1].status).toBe('INCONCLUSIVE');
});

test('audit regression: full E2 passes only after ad observations, video end and explicit session close',async({page})=>{
  const e1=passedE1();await seedManualFixture(page,[e1]);await fixtureFrame(page);await boot(page);await page.click('#new-session');await chooseYap(page);await page.selectOption('#stage','E2');await page.selectOption('#watch-scope','full');await page.click('#open-source');await e2Checks(page);
  await page.selectOption('#obs-checks-ended','PASS');await page.selectOption('#obs-checks-fullNoAds','PASS');await expect(page.locator('#obs-checks-fullNoAds')).toHaveValue('INCONCLUSIVE');
  await noAds(page);await page.selectOption('#obs-checks-fullNoAds','PASS');await expect(page.locator('#obs-checks-fullNoAds')).toHaveValue('INCONCLUSIVE');await page.click('#stop');await page.selectOption('#obs-checks-fullNoAds','PASS');await page.selectOption('#outcome','PASS');await expect(page.locator('#outcome')).toHaveValue('PASS');
  const clean=await jsonDownload(page);expect(clean.records[1].assessment.adFreeSessionStatus).toBe('PASS');expect(clean.records[1].assessment.e1RecordId).toBe(e1.id);expect(clean.records[1].endedAt).not.toBeNull();
  await page.selectOption('#obs-ads-overlay','OBSERVED');await expect(page.locator('#outcome')).toHaveValue('INCONCLUSIVE');const changed=await jsonDownload(page);expect(changed.records[1].assessment.probeStatus).toBe('PASS');expect(changed.records[1].assessment.adFreeSessionStatus).toBe('FAIL');
});

test('audit regression: old unsupported E2 PASS cannot survive reload or export',async({page})=>{
  const legacy=completedE2();delete legacy.config.e1RecordId;delete legacy.details.watchMinutes;await seedManualFixture(page,[legacy]);await boot(page);await expect(page.locator('#outcome')).toHaveValue('INCONCLUSIVE');await expect(page.locator('#e1-warning')).toContainText('E1 не подтверждён');
  const data=await jsonDownload(page);expect(data.records[0].status).toBe('INCONCLUSIVE');expect(data.records[0].assessment.eligibilityIssues).not.toEqual([]);
});

test('real API response shape flows to HLS; ad flags survive and URL never enters journal',async({page})=>{
  await page.route('https://api.anilibria.app/api/v1/anime/releases/**',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(fixtureRelease)}));
  const mediaRequests=[]; await page.route('https://cache.libria.fun/**',route=>{mediaRequests.push(route.request().url());return route.fulfill({contentType:'application/vnd.apple.mpegurl',headers:{'access-control-allow-origin':'*'},body:'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ENDLIST\n'});});
  await boot(page); await page.selectOption('#provider-mode','media'); await page.check('#access-consent'); await page.click('#open-source'); await expect(page.locator('video')).toHaveCount(1); await expect(page.locator('#provenance')).toContainText('Synthetic fixture');
  await page.fill('#obs-details-voice','Русский, fixture только для проверки формы'); await page.fill('#obs-details-notes','Наблюдение, "кавычки"\nвторая строка'); await page.selectOption('#obs-ads-midRoll','OBSERVED');
  await page.selectOption('#obs-checks-fullNoAds','PASS'); await expect(page.locator('#obs-checks-fullNoAds')).toHaveValue('INCONCLUSIVE');
  const data=await jsonDownload(page); expect(data.records[0].technical.mediaOrigin).toBe('https://cache.libria.fun'); expect(JSON.stringify(data)).not.toContain('fixture.m3u8'); expect(data.records[0].checks.exactTitle).toBe('NOT_RUN');
  // Hls.js browsers fetch the original URL; native HLS may wait for a manual Play.
  for(const url of mediaRequests){expect(url).toContain('isWithVideoAds=1');expect(url).toContain('isWithVideoAdsAlways=1');}
  await page.reload(); await expect(page.locator('#message')).toContainText('Журнал восстановлен'); await expect(page.locator('video,iframe')).toHaveCount(0); await expect(page.locator('#obs-details-notes')).toHaveValue('Наблюдение, "кавычки"\nвторая строка');
});

test('wrong API content is an explicit error, never an availability PASS',async({page})=>{
  await page.route('https://api.anilibria.app/**',route=>route.fulfill({contentType:'text/html',headers:{'access-control-allow-origin':'*'},body:'<p>Error page fixture</p>'}));
  await boot(page); await page.check('#access-consent'); await page.click('#open-source'); await expect(page.locator('#message')).toContainText('API вернул не JSON'); await expect(page.locator('video,iframe')).toHaveCount(0);
  expect((await journal(page)).records[0].checks.exactTitle).toBe('NOT_RUN');
});

test('aborted old API request cannot mutate a newer session',async({page})=>{
  let release; const gate=new Promise(resolve=>{release=resolve;});
  await page.route('https://api.anilibria.app/**',async route=>{await gate;try{await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(fixtureRelease)});}catch{/*request was cancelled*/}});
  await boot(page); await page.check('#access-consent'); await page.click('#open-source'); await expect(page.locator('#provider')).toBeDisabled(); await page.click('#new-session'); await chooseBlocked(page); release();
  const data=await jsonDownload(page); expect(data.records).toHaveLength(2); expect(data.records[1].technical.blocked).toBe('unknown-contract'); await expect(page.locator('video')).toHaveCount(0);
});

test('quota failure stays visible and in-memory JSON / CSV downloads preserve observations',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new DOMException('fixture quota','QuotaExceededError');};});
  await boot(page); await chooseBlocked(page); await page.fill('#obs-details-notes','=1+1\n"text", заметка'); await expect(page.locator('#storage-warning')).toContainText('экспортируйте JSON');
  const data=await jsonDownload(page); expect(data.records[0].details.notes).toBe('=1+1\n"text", заметка');
  const waiting=page.waitForEvent('download'); await page.click('#export-csv'); const file=await waiting; const csv=await readFile(await file.path(),'utf8'); expect(csv).toContain("'=1+1"); expect(csv).toContain('""text""');
});

test('corrupted journal is preserved and can be downloaded for recovery',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('kadr.videoLab.v1','broken-fixture'));
  await boot(page); await expect(page.locator('#storage-warning')).toContainText('не перезаписываются'); await chooseBlocked(page); expect(await page.evaluate(()=>localStorage.getItem('kadr.videoLab.v1'))).toBe('broken-fixture');
  const waiting=page.waitForEvent('download'); await page.click('#export-recovery'); const file=await waiting; expect(await readFile(await file.path(),'utf8')).toBe('broken-fixture');
});

test('PWA shell works at repository subpath offline and cache contains no external media',async({page,context})=>{
  await boot(page); await page.evaluate(()=>navigator.serviceWorker.ready); await page.reload(); await expect(page.locator('#sample option')).toHaveCount(18);
  const urls=await page.evaluate(async()=>{const out=[];for(const key of await caches.keys()){const cache=await caches.open(key);out.push(...(await cache.keys()).map(r=>r.url));}return out;});
  expect(urls.length).toBeGreaterThan(10); expect(urls.every(url=>url.startsWith('http://127.0.0.1:4173/kadr-video-lab/'))).toBe(true); expect(urls.some(url=>url.includes('.m3u8')||url.endsWith('.ts'))).toBe(false);
  await context.setOffline(true); await page.reload(); await expect(page.locator('#sample option')).toHaveCount(18); await expect(page.locator('#offline')).toBeVisible();
});
