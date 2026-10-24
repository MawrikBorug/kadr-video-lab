// Routed Stremio replies are SYNTHETIC. Torrent/Range/player checks below use
// real owned media bytes and real browser WebTorrent, not a public library claim.
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import bencode from 'bencode';
const KEY='kadr.videoLab.search.v1';
const journal=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
const ready=page=>expect(page.locator('#search-start')).toBeEnabled();
const manifest={id:'synthetic-search-test',name:'SYNTHETIC TEST ONLY',version:'1',resources:['stream'],types:['series','movie']};
async function routes(page,streams,{primaryEmpty=false}={}){
 await page.route('https://comet.feels.legal/**',route=>route.fulfill({json:route.request().url().includes('manifest')?manifest:{streams:primaryEmpty?[]:streams},headers:{'Access-Control-Allow-Origin':'*'}}));
 await page.route('https://torrentsdb.com/**',route=>route.fulfill({json:route.request().url().includes('manifest')?manifest:{streams},headers:{'Access-Control-Allow-Origin':'*'}}));
}
test('one click shows first results and automatically checks delivery; fallback and duplicate packages are visible',async({page})=>{
 const streams=[{name:'SYNTHETIC research metadata mapping, not live search',infoHash:'7496e402a9bde1d042505f297979b11830e4b19b',fileIdx:19}];
 await routes(page,[...streams,...streams],{primaryEmpty:true});await page.goto('./');await ready(page);await page.click('#search-start');
 await expect(page.locator('.source-result')).toHaveCount(1);
 await expect.poll(async()=>((await journal(page)).runs.at(-1).candidates[0].torrent.metadataHashVerified)).toBe(true);
 const run=(await journal(page)).runs.at(-1);expect(run.hostStates.map(s=>s.state)).toEqual(['empty','success']);
 expect(run.events.some(e=>e.kind==='probe_started')).toBe(true);expect(run.candidates[0].torrent.fileIdx).toBe(19);
 expect(run.candidates[0].states.playback).toBe('unverified');expect(run.candidates[0].states.B).toBe('webseed-not-found');
 expect(run.counters.payloadBytes).toBe(0);expect(run.counters.metadataBytes).toBeGreaterThan(0);
 await page.click('#search-stop');await expect(page.locator('#search-status')).toContainText('остановлена');
 expect((await journal(page)).runs.at(-1).events.some(e=>e.kind==='probe_resources_closed' && e.clientDestroyed)).toBe(true);
});
test('old host responses cannot replace a new title/episode; old journals remain intact',async({page})=>{
 let release;const gate=new Promise(r=>release=r);let requested=false;
 await page.route('https://comet.feels.legal/**',async route=>{
  if(route.request().url().includes('manifest'))return route.fulfill({json:manifest});
  requested=true;await gate;try{await route.fulfill({json:{streams:[{infoHash:'1'.repeat(40),name:'SYNTHETIC stale response'}]}});}catch{/* aborted request */}
 });
 await page.goto('./');await ready(page);await page.evaluate(()=>{localStorage.setItem('foreign.setting','KEEP');localStorage.setItem('kadr.videoLab.v1','KEEP_OLD');});
 await page.click('#search-start');await expect.poll(()=>requested).toBe(true);await page.selectOption('#search-episode','2');release();
 await expect(page.locator('#search-status')).toContainText('Выбор изменён');await expect(page.locator('.source-result')).toHaveCount(0);
 expect((await journal(page)).runs.at(-1).searchState).toBe('cancelled');
 expect(await page.evaluate(()=>[localStorage.getItem('foreign.setting'),localStorage.getItem('kadr.videoLab.v1')])).toEqual(['KEEP','KEEP_OLD']);
});
test('ambiguous metadata never starts an adjacent episode; explicit choices retain original file index',async({page})=>{
 await routes(page,[{infoHash:'ac90e5631f8d78d8932c167743386762369eb545',fileIdx:0,name:'SYNTHETIC season 2 package in season 1 query'}]);
 await page.goto('./');await ready(page);await page.click('#search-start');await expect.poll(async()=>((await journal(page)).runs.at(-1).candidates[0]?.probeReason)).toBe('FILE_UNRESOLVED');
 await page.click('.source-result button');await expect(page.locator('#search-file-status')).toContainText('unresolved');
 await expect(page.locator('video')).not.toHaveAttribute('src',/./);expect((await journal(page)).runs.at(-1).candidates[0].states.playback).toBe('unverified');
});
async function ownedSearch(page){
 const raw=bencode.decode(await readFile('web/fixtures/kadr-control-60s.torrent'));
 raw['url-list']=['http://127.0.0.1:4173/kadr-video-lab/fixtures/kadr-control-60s.mp4'];const bytes=Buffer.from(bencode.encode(raw));
 await page.route('https://metadata.fixture.invalid/control.torrent',route=>route.fulfill({body:bytes,contentType:'application/x-bittorrent',headers:{'Access-Control-Allow-Origin':'*'}}));
 await routes(page,[{name:'SYNTHETIC owned control, not the queried movie',infoHash:'05b36bedda4c62b73af236553176141c51912689',fileIdx:0,sources:['https://metadata.fixture.invalid/control.torrent']}]);
 await page.goto('./');await ready(page);await page.selectOption('#search-work','interstellar');await page.click('#search-start');
}
test('closed results stay read-only after a legacy source switch, even for already captured callbacks',async({page})=>{
 await ownedSearch(page);await expect.poll(async()=>((await journal(page)).runs.at(-1).candidates[0]?.states.B)).toBe('bytes-received');
 await page.click('.source-result button');
 await page.evaluate(()=>{window.stalePick=document.querySelector('.source-result button').onclick;window.stalePlay=document.querySelector('#search-play-a').onclick;window.staleProbe=document.querySelector('#search-reprobe').onclick;});
 const before=(await journal(page)).runs.at(-1);
 await page.selectOption('#connection','wt-webrtc');await expect(page.locator('#search-status')).toContainText('Поиск закрыт');
 await expect(page.locator('.source-result button')).toBeDisabled();await expect(page.locator('#search-selected')).toBeHidden();
 await page.evaluate(async()=>{window.stalePick();await window.stalePlay();await window.staleProbe();});
 const closed=(await journal(page)).runs.at(-1);expect(closed.searchId).toBe(before.searchId);expect(closed.searchState).toBe('cancelled');
 expect(closed.events.filter(e=>e.kind==='play_requested' || e.kind==='manual_probe_requested')).toHaveLength(0);
 expect(closed.events.filter(e=>e.kind==='probe_started')).toHaveLength(before.events.filter(e=>e.kind==='probe_started').length);
 await expect(page.locator('video')).not.toHaveAttribute('src',/./);
 await page.click('#search-start');await expect.poll(async()=>((await journal(page)).runs.length)).toBe(2);
 await page.evaluate(()=>window.stalePick());await expect(page.locator('#search-selected')).toBeHidden();
 expect((await journal(page)).runs[0].candidates).toHaveLength(1);
});
test('local torrent import verifies magnet hash and shows the full list without starting playback',async({page})=>{
 const hash='05b36bedda4c62b73af236553176141c51912689';let cacheRequests=0;
 await page.route('https://itorrents.org/**',route=>{cacheRequests++;return route.abort();});
 await routes(page,[{name:'SYNTHETIC owned magnet, no HTTPS metadata',infoHash:hash,fileIdx:17}]);
 await page.goto('./');await ready(page);await page.selectOption('#search-work','interstellar');await page.click('#search-start');
 await expect(page.locator('.source-result')).toHaveCount(1);await page.click('#search-stop');await page.click('.source-result button');
 await page.locator('#search-metadata-file').setInputFiles('web/search-fixtures/ac90e5631f8d78d8932c167743386762369eb545.torrent');
 await expect(page.locator('#search-metadata-status')).toContainText('INFOHASH_MISMATCH');
 expect((await journal(page)).runs.at(-1).candidates[0].torrent.metadataHashVerified).toBe(false);
 await page.locator('#search-metadata-file').setInputFiles('web/fixtures/kadr-control-60s.torrent');
 await expect(page.locator('#search-metadata-status')).toContainText('SHA-1 совпал');await expect(page.locator('#search-file option')).toHaveCount(2);
 const run=(await journal(page)).runs.at(-1);expect(run.candidates[0].torrent.fileIdx).toBe(0);expect(run.candidates[0].torrent.metadataHashVerified).toBe(true);
 expect(run.candidates[0].metadataProvenance.dataMode).toBe('user-imported-metadata');expect(run.candidates[0].states.playback).toBe('unverified');
 expect(run.events.filter(e=>e.kind==='play_requested')).toHaveLength(0);expect(cacheRequests).toBe(0);
 await expect(page.locator('video')).not.toHaveAttribute('src',/./);
});
test('automatic B verifies bytes without claiming playback, then selected file plays, seeks and restores without full Blob',async({page})=>{
 test.setTimeout(60000);await ownedSearch(page);
 await expect.poll(async()=>((await journal(page)).runs.at(-1).candidates[0]?.states.B)).toBe('bytes-received');
 let run=(await journal(page)).runs.at(-1);expect(run.candidates[0].states.playback).toBe('unverified');expect(run.candidates[0].probe.webrtcBytes).toBe(0);
 await page.click('.source-result button');await page.click('#search-play-b');
 await page.waitForFunction(()=>document.querySelector('video').readyState>=1);await page.locator('video').evaluate(v=>v.play());
 await expect(page.locator('#material-title')).toContainText('Поиск · Интерстеллар');await expect(page.locator('#control-license-note')).toBeHidden();
 await expect(page.locator('#search-play-status')).toContainText('Воспроизведение подтверждено');
 await page.locator('video').evaluate(v=>{v.currentTime=45;});await page.waitForFunction(()=>document.querySelector('video').currentTime>45 && !document.querySelector('video').seeking);
 run=(await journal(page)).runs.at(-1);expect(run.candidates[0].playerTransport.playbackBeforeFull).toBe(true);
 expect(run.events.some(e=>e.kind==='torrent_metadata_reused')).toBe(true);expect(run.events.find(e=>e.kind==='torrent_metadata_bytes').networkBytes).toBe(0);
 expect(run.candidates[0].playerTransport.webRTCBytes).toBe(0);expect(run.candidates[0].playerTransport.httpBytes).toBeGreaterThan(0);
 expect(run.events.some(e=>e.kind==='media_range_request' && e.afterSeek && e.firstPieceHadNoBytes)).toBe(true);
 expect(run.queueState).toBe('paused');const uri=await page.locator('video').getAttribute('src');
 await page.click('#search-player-stop');await page.click('#search-play-b');await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
 expect(await page.locator('video').getAttribute('src')).not.toBe(uri);await expect(page.locator('#search-restore')).toBeEnabled();await page.click('#search-restore');
 await page.waitForFunction(()=>document.querySelector('video').currentTime>=45 && !document.querySelector('video').seeking);
 await page.click('#search-player-stop');await expect(page.locator('video')).not.toHaveAttribute('src',/./);
});
test('automatic A reaches its deadline, closes the real client and receives no HTTP media',async({page})=>{
 await ownedSearch(page);await expect.poll(async()=>((await journal(page)).runs.at(-1).candidates[0]?.states.B)).toBe('bytes-received');
 // A separate session via module allows a short deadline without slowing all CI.
 const result=await page.evaluate(async()=>{
  const {CandidateProbe,SearchBudget}=await import('./source-probe.mjs'),{LocatorVault,normalizeStream}=await import('./source-search.mjs'),{WORKS,workQuery,LIMITS}=await import('./search-config.mjs');
  const {parseMetadata}=await import('./torrent-metadata.mjs');const bytes=new Uint8Array(await (await fetch('fixtures/kadr-control-60s.torrent')).arrayBuffer());
  const vault=new LocatorVault(),candidate=normalizeStream({infoHash:'05b36bedda4c62b73af236553176141c51912689'},workQuery(WORKS.find(w=>w.type==='movie')),{id:'SYNTHETIC',label:'SYNTHETIC'},vault);
  const meta=await parseMetadata(bytes);Object.assign(vault.get(candidate),{metadata:bytes,meta});
  const probe=new CandidateProbe({candidate,vault,budget:new SearchBudget(),limits:{...LIMITS,candidateMs:800},signal:new AbortController().signal,onChange:()=>{}});await probe.run();
  return {candidate,closed:probe.client===null};
 });
 expect(result.closed).toBe(true);expect(result.candidate.probe.httpBytes).toBe(0);expect(result.candidate.probe.webrtcBytes).toBe(0);expect(result.candidate.states.A).not.toBe('bytes-received');
});
