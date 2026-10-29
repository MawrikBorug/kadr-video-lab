import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
const allowed = new Set(['index.html','ai.html','ai.css','ai.mjs','ai-images.mjs','harness.mjs','collector.mjs','lift-api.mjs','journal.mjs','legacy.mjs','config.js','build.js','build-info.json','style.css','sw.js','manifest.webmanifest','.nojekyll','icons','catalog.json','torrent.mjs','torrent-materials.js','piece-store.mjs','transport-diagnostics.mjs','fixtures','vendor','search-config.mjs','source-utils.mjs','source-search.mjs','torrent-metadata.mjs','source-probe.mjs','search-session.mjs','search-ui.mjs','search-fixtures']);
for (const dir of ['dist','dist/a01']) {
for (const item of await readdir(dir)) assert.ok(allowed.has(item) || (dir==='dist' && item==='a01') || (dir==='dist/a01' && ['lift-settings-probe.mjs','resume-query.mjs'].includes(item)), `Unexpected public asset: ${item}`);
for (const item of await readdir(dir)) {
  if (['icons','vendor','fixtures','search-fixtures','a01'].includes(item)) continue;
  const text = await readFile(`${dir}/${item}`, 'utf8');
  assert.ok(!/embed\.liftw\.ws\/embed\/movie\/\d+\?/.test(text), 'Signed iframe in build');
  assert.ok(!/videoseed|batch-ui|hls\.js|kadr-video-lab-adapter/i.test(text), 'Old provider code in build');
  assert.ok(!/CANARY_PRIVATE_VALUE|PRIVATE_FIXTURE/.test(text), 'Test secret in build');
}
}
const build = JSON.parse(await readFile('dist/build-info.json'));
assert.match(build.commit, /^[a-f0-9]{40}$/); assert.equal(build.version, 'search-2');
const worker = await readFile('dist/sw.js', 'utf8');
assert.ok(!worker.includes('caches.delete(key)') || worker.includes('requests.every'));
assert.ok(!worker.includes("addEventListener('fetch'"));
assert.ok(worker.includes("importScripts('./vendor/webtorrent.sw.min.js')"));
assert.deepEqual((await readdir('dist/vendor')).sort(), ['WebTorrent.LICENSE','NOTICE.txt','webtorrent.min.js','webtorrent.sw.min.js'].sort());
assert.ok(!(await readFile('dist/vendor/webtorrent.min.js','utf8')).includes('removeEntry("chunks",{recursive:!0})'));
const catalog=JSON.parse(await readFile('dist/catalog.json'));
assert.equal(catalog.filter(item=>item.ownerSample).length,10);
assert.ok(catalog.filter(item=>item.ownerSample).every(item=>item.access==='native-player-user-selected'));
assert.ok(!(await readFile('dist/harness.mjs','utf8')).includes('mediaPermission'));
console.log('Public build PASS: Lift + isolated browser WebTorrent + AI client; no provider credentials, private controls or signed iframe URL.');

assert.equal(await readFile('dist/harness.mjs','utf8'),await readFile('web/harness.mjs','utf8'));
assert.ok((await readFile('dist/a01/harness.mjs','utf8')).includes('attachLiftSettingsProbe'));
assert.ok(!(await readFile('dist/harness.mjs','utf8')).includes('attachLiftSettingsProbe'));
for(const f of ['collector.mjs','journal.mjs','sw.js','search-ui.mjs','build.js'])assert.equal(await readFile('dist/'+f,'utf8'),await readFile('dist/a01/'+f,'utf8'));
const diagnosticBase=new URL('https://example.test/kadr-video-lab/a01/');
const manifest=JSON.parse(await readFile('dist/a01/manifest.webmanifest','utf8'));
for(const key of ['id','start_url','scope'])assert.equal(new URL(manifest[key],diagnosticBase).href,diagnosticBase.href);
const diagnosticWorker=await readFile('dist/a01/sw.js','utf8');
assert.ok(diagnosticWorker.includes('requests.every(request => request.url.startsWith(BASE.href))'));
assert.ok(diagnosticWorker.includes("const BASE = new URL('./', self.location.href)"));
assert.ok(!diagnosticWorker.includes("addEventListener('fetch'"));
