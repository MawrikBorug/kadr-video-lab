import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
const allowed = new Set(['index.html','harness.mjs','collector.mjs','lift-api.mjs','journal.mjs','legacy.mjs','config.js','build.js','build-info.json','style.css','sw.js','manifest.webmanifest','.nojekyll','icons','catalog.json','torrent.mjs','torrent-materials.js','piece-store.mjs','transport-diagnostics.mjs','fixtures','vendor','search-config.mjs','source-utils.mjs','source-search.mjs','torrent-metadata.mjs','source-probe.mjs','search-session.mjs','search-ui.mjs','search-fixtures']);
for (const item of await readdir('dist')) assert.ok(allowed.has(item), `Unexpected public asset: ${item}`);
for (const item of await readdir('dist')) {
  if (['icons','vendor','fixtures','search-fixtures'].includes(item)) continue;
  const text = await readFile(`dist/${item}`, 'utf8');
  assert.ok(!/embed\.liftw\.ws\/embed\/movie\/\d+\?/.test(text), 'Signed iframe in build');
  assert.ok(!/videoseed|batch-ui|hls\.js|kadr-video-lab-adapter/i.test(text), 'Old provider code in build');
  assert.ok(!/CANARY_PRIVATE_VALUE|PRIVATE_FIXTURE/.test(text), 'Test secret in build');
}
const build = JSON.parse(await readFile('dist/build-info.json'));
assert.match(build.commit, /^[a-f0-9]{40}$/); assert.equal(build.version, 'search-1');
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
console.log('Public build PASS: Lift + isolated browser WebTorrent; no old providers, remote backend or signed iframe URL.');
