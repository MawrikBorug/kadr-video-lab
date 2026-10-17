import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const journal = page => page.evaluate(() => JSON.parse(localStorage.getItem('kadr.videoLab.v1')));
const fixtureRelease = { name:{main:'Synthetic fixture — not a real playback result'}, episodes:[{ordinal:1,name:'Fixture',duration:1200,hls_480:'https://cache.libria.fun/fixture.m3u8?isWithVideoAds=1&isWithVideoAdsAlways=1'}] };

test.beforeEach(async ({ page }) => {
  // All external traffic is denied unless a test explicitly provides a fixture.
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4173/') ? route.continue() : route.abort());
});
async function boot(page) { await page.goto('./'); await expect(page.locator('#sample option')).toHaveCount(13); }
async function chooseYap(page) { await page.selectOption('#provider','yapgrid'); await page.selectOption('#sample','dune'); await page.check('#access-consent'); }
async function chooseBlocked(page) { await page.selectOption('#provider','stellar'); await page.check('#access-consent'); await page.click('#open-source'); await expect(page.locator('#message')).toContainText('Источник не подтвердился'); }
async function jsonDownload(page) {
  const waiting=page.waitForEvent('download'); await page.click('#export-json'); const file=await waiting; return JSON.parse(await readFile(await file.path(),'utf8'));
}

test('mobile UI loads without external calls; blocked source is explicit and exported',async({page})=>{
  const errors=[]; page.on('pageerror',error=>errors.push(error.message)); const external=[]; page.on('request',request=>{if(request.url().startsWith('https://'))external.push(request.url());});
  await boot(page); await expect(page.locator('h1')).toContainText('Фиксируем факты'); expect(external).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await chooseBlocked(page); await expect(page.locator('iframe,video')).toHaveCount(0);
  const data=await jsonDownload(page); expect(data.records).toHaveLength(1); expect(data.records[0].status).toBe('INCONCLUSIVE'); expect(data.records[0].checks.videoStarted).toBe('NOT_RUN'); expect(data.records[0].technical.blocked).toBe('unconfirmed-contract');
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
  await page.check('#unrestricted-consent'); await page.click('#open-source'); await expect(page.locator('iframe')).not.toHaveAttribute('sandbox');
  await expect(page.locator('#provider')).toBeDisabled(); await page.click('#new-session'); await expect(page.locator('iframe')).toHaveCount(0); await expect(page.locator('#provider')).toBeEnabled();
  await chooseBlocked(page); const data=await jsonDownload(page); expect(data.records).toHaveLength(2); expect(data.records[0].config.provider).toBe('yapgrid'); expect(data.records[1].config.provider).toBe('stellar');
});

test('real API response shape flows to HLS; ad flags survive and URL never enters journal',async({page})=>{
  await page.route('https://anilibria.top/api/v1/anime/releases/**',route=>route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(fixtureRelease)}));
  const mediaRequests=[]; await page.route('https://cache.libria.fun/**',route=>{mediaRequests.push(route.request().url());return route.fulfill({contentType:'application/vnd.apple.mpegurl',headers:{'access-control-allow-origin':'*'},body:'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ENDLIST\n'});});
  await boot(page); await page.check('#access-consent'); await page.click('#open-source'); await expect(page.locator('video')).toHaveCount(1); await expect(page.locator('#provenance')).toContainText('Synthetic fixture');
  await page.fill('#obs-details-voice','Русский, fixture только для проверки формы'); await page.fill('#obs-details-notes','Наблюдение, "кавычки"\nвторая строка'); await page.selectOption('#obs-ads-midRoll','OBSERVED');
  await page.selectOption('#obs-checks-fullNoAds','PASS'); await expect(page.locator('#obs-checks-fullNoAds')).toHaveValue('INCONCLUSIVE');
  const data=await jsonDownload(page); expect(data.records[0].technical.mediaOrigin).toBe('https://cache.libria.fun'); expect(JSON.stringify(data)).not.toContain('fixture.m3u8'); expect(data.records[0].checks.exactTitle).toBe('NOT_RUN');
  // Hls.js browsers fetch the original URL; native HLS may wait for a manual Play.
  for(const url of mediaRequests){expect(url).toContain('isWithVideoAds=1');expect(url).toContain('isWithVideoAdsAlways=1');}
  await page.reload(); await expect(page.locator('#message')).toContainText('Журнал восстановлен'); await expect(page.locator('video,iframe')).toHaveCount(0); await expect(page.locator('#obs-details-notes')).toHaveValue('Наблюдение, "кавычки"\nвторая строка');
});

test('wrong API content is an explicit error, never an availability PASS',async({page})=>{
  await page.route('https://anilibria.top/**',route=>route.fulfill({contentType:'text/html',headers:{'access-control-allow-origin':'*'},body:'<p>Error page fixture</p>'}));
  await boot(page); await page.check('#access-consent'); await page.click('#open-source'); await expect(page.locator('#message')).toContainText('API вернул не JSON'); await expect(page.locator('video,iframe')).toHaveCount(0);
  expect((await journal(page)).records[0].checks.exactTitle).toBe('NOT_RUN');
});

test('aborted old API request cannot mutate a newer session',async({page})=>{
  let release; const gate=new Promise(resolve=>{release=resolve;});
  await page.route('https://anilibria.top/**',async route=>{await gate;try{await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(fixtureRelease)});}catch{/*request was cancelled*/}});
  await boot(page); await page.check('#access-consent'); await page.click('#open-source'); await expect(page.locator('#provider')).toBeDisabled(); await page.click('#new-session'); await chooseBlocked(page); release();
  const data=await jsonDownload(page); expect(data.records).toHaveLength(2); expect(data.records[1].technical).toEqual({blocked:'unconfirmed-contract'}); await expect(page.locator('video')).toHaveCount(0);
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
  await boot(page); await page.evaluate(()=>navigator.serviceWorker.ready); await page.reload(); await expect(page.locator('#sample option')).toHaveCount(13);
  const urls=await page.evaluate(async()=>{const out=[];for(const key of await caches.keys()){const cache=await caches.open(key);out.push(...(await cache.keys()).map(r=>r.url));}return out;});
  expect(urls.length).toBeGreaterThan(10); expect(urls.every(url=>url.startsWith('http://127.0.0.1:4173/kadr-video-lab/'))).toBe(true); expect(urls.some(url=>url.includes('.m3u8')||url.endsWith('.ts'))).toBe(false);
  await context.setOffline(true); await page.reload(); await expect(page.locator('#sample option')).toHaveCount(13); await expect(page.locator('#offline')).toBeVisible();
});
