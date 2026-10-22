import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
const allowed = new Set(['index.html','harness.mjs','collector.mjs','lift-api.mjs','journal.mjs','legacy.mjs','config.js','build.js','build-info.json','style.css','sw.js','manifest.webmanifest','.nojekyll','icons']);
for (const item of await readdir('dist')) assert.ok(allowed.has(item), `Unexpected public asset: ${item}`);
for (const item of await readdir('dist')) {
  if (item === 'icons') continue;
  const text = await readFile(`dist/${item}`, 'utf8');
  assert.ok(!/embed\.liftw\.ws\/embed\/movie\/3637\?/.test(text), 'Signed iframe in build');
  assert.ok(!/videoseed|batch-ui|hls\.js|kadr-video-lab-adapter/i.test(text), 'Old provider code in build');
  assert.ok(!/CANARY_PRIVATE_VALUE|PRIVATE_FIXTURE/.test(text), 'Test secret in build');
}
const build = JSON.parse(await readFile('dist/build-info.json'));
assert.match(build.commit, /^[a-f0-9]{40}$/); assert.equal(build.version, 'lift-1');
const worker = await readFile('dist/sw.js', 'utf8');
assert.ok(!worker.includes('caches.delete(key)') || worker.includes('requests.every'));
assert.ok(!worker.includes("addEventListener('fetch'"));
console.log('Public Lift build PASS: only allowed assets; no old providers, backend or signed iframe URL.');
