// Catalogue/telemetry inputs below are synthetic. The HTTP fixture test uses the real
// browser WebTorrent implementation and real owned media bytes, not public P2P evidence.
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const KEY='kadr.videoLab.experiments.v1', OLD='kadr.lift.journal.v1', POSITION='kadr-lift-experiment-position';
const journal=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
const waitSelection=page=>page.waitForFunction(()=>!document.querySelector('#connection').disabled && !document.querySelector('#material').disabled);

test('old Lift logs/60-second position remain intact; new load does not show them as current progress',async({page})=>{
  const position={time:60,duration:888,utc:'2026-10-22T05:00:00Z',runId:'126bdadb-c16f-4870-aa63-56a1743bd71a'};
  const old=JSON.stringify({schema:2,runs:[{...position,runId:position.runId,mode:'browser',events:[],lastPosition:position}],currentByMode:{browser:position.runId}});
  await page.addInitScript(({OLD,POSITION,old,position})=>{localStorage.setItem(OLD,old);localStorage.setItem(POSITION,JSON.stringify(position));},{OLD,POSITION,old,position});
  await page.route('https://api.liftw.ws/info/3637',r=>r.fulfill({json:{id:3637,origin_name:'Sintel',year:2010,type:2,iframe_uri:'https://embed.liftw.ws/embed/movie/3637?fixture=PRIVATE_FIXTURE'},headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.route('https://embed.liftw.ws/**',r=>r.fulfill({contentType:'text/html',body:'<p>SYNTHETIC no-progress iframe</p><script>parent.postMessage({event:"playerReady"},"*")</script>'}));
  await page.goto('./');await expect(page.locator('#saved')).toContainText('60.0 / 888.0');
  await page.click('#start');await expect(page.locator('#ready-state')).toContainText('playerReady');
  await expect(page.locator('#position')).toContainText('Текущая позиция неизвестна');
  await expect(page.locator('#saved')).toContainText('2026-10-22T05:00:00Z');
  await page.click('#reload');await expect(page.locator('#position')).toContainText('Текущая позиция неизвестна');
  expect(await page.evaluate(k=>localStorage.getItem(k),OLD)).toBe(old);
  expect(await page.evaluate(k=>localStorage.getItem(k),POSITION)).toBe(JSON.stringify(position));
  await page.click('#compare');await expect(page.locator('#comparison-body')).toContainText('архив');
});

test('valid progress is not discarded by the former 30-message threshold; invalid data has a reason',async({page})=>{
  await page.route('https://api.liftw.ws/info/3637',r=>r.fulfill({json:{id:3637,origin_name:'Sintel',year:2010,iframe_uri:'https://embed.liftw.ws/embed/movie/3637?fixture=PRIVATE_FIXTURE'},headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.route('https://embed.liftw.ws/**',r=>r.fulfill({contentType:'text/html',body:`<p>SYNTHETIC telemetry burst, not Lift</p><script>setTimeout(()=>{for(let time=1;time<=80;time++)parent.postMessage({event:'viewProgress',time,duration:888},'*');parent.postMessage({event:'viewProgress',time:'bad',duration:888},'*')},50)</script>`}));
  await page.goto('./');await page.click('#start');await expect(page.locator('#position')).toContainText('80.0 / 888.0');
  await expect.poll(async()=>{const j=await journal(page);return j.runs.at(-1).diagnostics.progressAccepted;}).toBe(80);
  await expect.poll(async()=>{const j=await journal(page);return j.runs.at(-1).diagnostics.progressReceived;}).toBe(81);
  const run=(await journal(page)).runs.at(-1);
  expect(run.diagnostics.progressReceived).toBe(81);expect(run.diagnostics.rejected.invalid_progress_numbers).toBe(1);
  expect(run.events.filter(e=>e.kind==='iframe_message' && e.event==='viewProgress')).toHaveLength(80);
});

test('six exact catalogue subjects are independent, with blocked unlicensed media and explicit untested fields',async({page})=>{
  const catalog=JSON.parse(await readFile('web/catalog.json','utf8')).filter(item=>item.group!=='control');
  await page.route('https://api.liftw.ws/info/*',route=>{
    const id=Number(new URL(route.request().url()).pathname.split('/').at(-1)),item=catalog.find(x=>x.id===id);
    return route.fulfill({json:{id,origin_name:item.original,year:item.year,type:item.nativeType,quality:'FHD',iframe_uri:`https://embed.liftw.ws/embed/movie/${id}?fixture=PRIVATE_FIXTURE`},headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.goto('./');
  for(const item of catalog){
    await page.selectOption('#material',String(item.id));await waitSelection(page);
    await expect(page.locator('#start')).toBeDisabled();await page.click('#catalog-test');await expect(page.locator('#status')).toContainText('Каталожная проверка завершена');
    await expect(page.locator('iframe,video[src]')).toHaveCount(0);
    const run=(await journal(page)).runs.at(-1);expect(run.subject.materialId).toBe(item.id);
    expect(run.subject.season).toBe(item.plannedSeason);expect(run.subject.episode).toBe(item.plannedEpisode);
    expect(run.catalog.found).toBe(true);expect(run.catalog.iframeReceived).toBe(true);
    expect(run.media.ruAudio).toBe('NOT_RUN');expect(run.media.mainVideo).toBe('NOT_RUN');expect(run.lastPosition).toBe(null);
  }
  await page.click('#compare');expect(await page.locator('#comparison-body tr').count()).toBeGreaterThanOrEqual(6);
});

async function localTorrentFixture(page){
  await page.route('**/torrent-materials.js',r=>r.fulfill({contentType:'text/javascript',body:`export const TRACKERS=[];export const TORRENT_MATERIALS=[{id:'kadr-control',title:'CI owned HTTP fixture (not public swarm)',infoHash:'05b36bedda4c62b73af236553176141c51912689',metadata:'fixtures/kadr-control-60s.torrent',webseed:'http://127.0.0.1:4173/kadr-video-lab/fixtures/kadr-control-60s.mp4',filename:'kadr-control-60s.mp4',size:572719,container:'MP4',codecs:'H264/AAC',source:'CI local fixture',license:'owned synthetic',dependency:'test only',allowed:['wt-http','wt-webrtc']}];`}));
}

test('real browser HTTP stream starts before full load, seeks to an empty piece and closes on source switch',async({page})=>{
  test.setTimeout(60000);await localTorrentFixture(page);await page.goto('./');
  await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();const old=await root.getDirectoryHandle('chunks',{create:true});await old.getFileHandle('KEEP_UNRELATED_CHUNK',{create:true});});
  await page.selectOption('#connection','wt-http');await waitSelection(page);await page.click('#start');
  await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
  await page.click('video');await page.locator('video').evaluate(v=>v.play());
  await expect.poll(async()=>((await journal(page)).runs.at(-1).transport?.firstPlayingMs)).not.toBe(null);
  await page.waitForFunction(()=>document.querySelector('video').currentTime>0.5);
  await page.locator('video').evaluate(v=>{v.currentTime=45});
  await page.waitForFunction(()=>document.querySelector('video').currentTime>45 && !document.querySelector('video').seeking);
  const before=(await journal(page)).runs.at(-1);
  const beforeStream=await page.locator('video').getAttribute('src');
  expect(before.transport.playbackBeforeFull).toBe(true);expect(before.transport.httpBytes).toBeGreaterThan(0);expect(before.transport.webRTCBytes).toBe(0);
  expect(before.events.some(e=>e.kind==='media_range_request' && e.afterSeek && e.firstPieceHadNoBytes)).toBe(true);
  await page.click('#reload');await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
  expect(await page.locator('video').getAttribute('src')).not.toBe(beforeStream);
  await expect.poll(async()=>((await journal(page)).runs.at(-1).transport.httpBytes)).toBeGreaterThan(0);
  await expect(page.locator('#restore-position')).toContainText('45.');await page.click('#restore-position');
  await page.waitForFunction(()=>document.querySelector('video').currentTime>=45 && !document.querySelector('video').seeking);
  const restored=(await journal(page)).runs.at(-1);expect(restored.events.some(e=>e.kind==='native_restore_requested' && e.time>=45)).toBe(true);
  expect(restored.transport.preexistingBytesAtReady).toBe(0);
  await page.selectOption('#connection','lift');await waitSelection(page);
  await expect(page.locator('video')).not.toHaveAttribute('src',/./);await expect(page.locator('#position')).toContainText('Текущая позиция неизвестна');
  const after=await journal(page);expect(after.runs.find(r=>r.runId===before.runId).events.some(e=>e.kind==='torrent_connections_closed')).toBe(true);
  expect(after.runs.at(-1).subject.connection).toBe('lift');expect(after.runs.at(-1).lastPosition).toBe(null);
  expect(await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();await (await root.getDirectoryHandle('chunks')).getFileHandle('KEEP_UNRELATED_CHUNK');return true;})).toBe(true);
});

test('WebRTC-only mode ignores even a supplied HTTP webseed and cannot silently fall back',async({page})=>{
  await localTorrentFixture(page);let mediaRequests=0;
  page.on('request',r=>{if(r.url().endsWith('/fixtures/kadr-control-60s.mp4'))mediaRequests++;});
  await page.goto('./');await page.selectOption('#connection','wt-webrtc');await waitSelection(page);await page.click('#start');
  await expect(page.locator('#transport-state')).toContainText('Metadata: готовы');await page.waitForTimeout(1000);
  const run=(await journal(page)).runs.at(-1);expect(run.transport.httpBytes).toBe(0);expect(run.transport.webSeedConnections).toBe(0);expect(mediaRequests).toBe(0);
  await page.click('#stop');await expect(page.locator('#status')).toContainText('Источник закрыт');
});
