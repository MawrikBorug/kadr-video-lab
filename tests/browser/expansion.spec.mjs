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

test('all ten owner subjects can open native iframe; catalogue stays a separate action',async({page})=>{
  const catalog=JSON.parse(await readFile('web/catalog.json','utf8')).filter(item=>item.ownerSample);
  await page.route('https://api.liftw.ws/info/*',route=>{
    const id=Number(new URL(route.request().url()).pathname.split('/').at(-1)),item=catalog.find(x=>x.id===id);
    return route.fulfill({json:{id,name:item.providerTitle,origin_name:item.original,year:item.year,type:item.nativeType,quality:'FHD',iframe_uri:`https://embed.liftw.ws/embed/movie/${id}?fixture=PRIVATE_FIXTURE`},headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.route('https://embed.liftw.ws/**',r=>r.fulfill({contentType:'text/html',body:'<p>SYNTHETIC iframe, not media proof</p>'}));
  await page.goto('./');
  for(const item of catalog){
    await page.selectOption('#material',String(item.id));await waitSelection(page);
    await expect(page.locator('#start')).toBeEnabled();await page.click('#catalog-test');await expect(page.locator('#status')).toContainText('Каталожная проверка завершена');
    await expect(page.locator('iframe,video[src]')).toHaveCount(0);
    const run=(await journal(page)).runs.at(-1);expect(run.subject.materialId).toBe(item.id);
    expect(run.catalog.found).toBe(true);expect(run.catalog.iframeReceived).toBe(true);
    expect(run.media.ruAudio).toBe('NOT_RUN');expect(run.media.mainVideo).toBe('NOT_RUN');expect(run.lastPosition).toBe(null);
    await page.click('#start');await expect(page.locator('iframe')).toHaveCount(1);
  }
  expect(catalog).toHaveLength(10);await page.click('#compare');expect(await page.locator('#comparison-body tr').count()).toBeGreaterThanOrEqual(10);
});

test('episode plan, native changeEpisode confirmation and saved positions remain separate',async({page})=>{
 const catalog=JSON.parse(await readFile('web/catalog.json','utf8'));const item=catalog.find(m=>m.id===76436),s2=item.snapshot.seasons.find(s=>s.season===2),ep=s2.episodes[1];
 await page.route('https://api.liftw.ws/info/76436',r=>r.fulfill({json:{id:76436,origin_name:item.original,year:2024,type:7,iframe_uri:'https://embed.liftw.ws/embed/movie/76436?fixture=PRIVATE_FIXTURE'},headers:{'Access-Control-Allow-Origin':'*'}}));
 await page.route('https://embed.liftw.ws/**',r=>r.fulfill({contentType:'text/html',body:`<p>SYNTHETIC playlist bridge</p><script>addEventListener('message',e=>{if(e.data==='playlist hook')parent.postMessage('playlist hooked','*');if(e.data?.event==='playlist go') {parent.postMessage({event:'viewProgress',time:60,duration:1500},'*');parent.postMessage({event:'changeEpisode',season:e.data.season,episode:e.data.episode,id:${ep.providerId}},'*');parent.postMessage({event:'viewProgress',time:70,duration:1500,id:${ep.providerId+7}},'*');}})</script>`}));
 await page.goto('./');await page.selectOption('#material','76436');await waitSelection(page);await page.selectOption('#season','2');await waitSelection(page);await page.selectOption('#episode',String(ep.providerId));await waitSelection(page);
 const runBefore=(await journal(page)).runs.at(-1);expect(runBefore.subject).toMatchObject({materialId:76436,season:2,episode:ep.episode,episodeProviderId:ep.providerId});
 await page.click('#start');await expect(page.locator('#episode-status')).toContainText('подтвердил changeEpisode');await expect(page.locator('#position')).toContainText('70.0');
 const after=(await journal(page)).runs.at(-1);expect(after.unattributedProgress.time).toBe(60);expect(after.lastPosition.time).toBe(70);expect(after.episodeEvidence.confirmed).toBe(true);
 await page.selectOption('#episode',String(s2.episodes[2].providerId));await waitSelection(page);await expect(page.locator('#saved')).toContainText('нет');await expect(page.locator('iframe')).toHaveCount(0);
});

test('manual phase/visible time never substitutes real Lift progress',async({page})=>{
 await page.goto('./');await page.locator('#progress-diagnostic > summary').click();await page.fill('#visible-time','180');await page.click('#phase-mark');
 const run=(await journal(page)).runs.at(-1);expect(run.lastPosition).toBe(null);expect(run.diagnostics.progressAccepted).toBe(0);expect(run.events.some(e=>e.kind==='progress_observation'&&e.visibleTime===180)).toBe(true);
 await expect(page.locator('#position')).toContainText('неизвестна');
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

test('WebRTC zero payload reaches a terminal timeout, closes client and offers retry',async({page})=>{
 await localTorrentFixture(page);await page.clock.install();await page.goto('./');await page.selectOption('#connection','wt-webrtc');await waitSelection(page);await page.click('#start');
 await expect(page.locator('#transport-state')).toContainText('Metadata: готовы');await page.clock.fastForward(46000);
 await expect(page.locator('#status')).toContainText('Соединения закрываются');
 const run=(await journal(page)).runs.at(-1);expect(run.transport.timedOut).toBe(true);expect(run.transport.httpBytes).toBe(0);expect(run.transport.webRTCBytes).toBe(0);expect(run.events.some(e=>e.kind==='transport_timeout')).toBe(true);await expect(page.locator('#start')).toBeEnabled();
 await page.click('#start');await expect.poll(async()=>(await journal(page)).runs.at(-1).generation).toBe(2);await page.click('#stop');
});

test('an open lift-2 run is preserved and a new build starts its own run',async({page})=>{
 const id='11111111-2222-4333-8444-555555555555';
 const old={runId:id,started:'2026-10-22T06:10:00Z',mode:'browser',build:{version:'lift-2',commit:'731735f55df9919202e359ecfa38bb0880e6afc8'},subject:{connection:'lift',materialId:3637,season:null,episode:null},generation:1,droppedEvents:0,rejectedMessages:0,diagnostics:{trusted:1,accepted:1,rejected:{},progressReceived:1,progressAccepted:1,arrivalGapsMs:[]},events:[{kind:'manual_observation',utc:'2026-10-22T06:10:00Z',code:'old'}],lastPosition:{time:60,duration:888,utc:'2026-10-22T06:10:00Z'},observations:{},media:{},ended:null};
 const data={schema:3,runs:[old],positions:{},currentByMode:{'browser|lift:3637:-:-':id}};
 await page.addInitScript(({KEY,data})=>localStorage.setItem(KEY,JSON.stringify(data)),{KEY,data});await page.goto('./');
 await expect(page.locator('#run-info')).toContainText('сохранено прогонов: 2');
 const now=await journal(page);expect(now.runs).toHaveLength(2);expect(now.runs[0]).toEqual(old);expect(now.runs[1].build.version).toBe('search-2');
});
