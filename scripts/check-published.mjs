import assert from 'node:assert/strict';
import {appendFile} from 'node:fs/promises';
assert.equal(new URL(process.env.PUBLISHED_URL).href, 'https://mawrikborug.github.io/kadr-video-lab/');
const base = process.env.PUBLISHED_URL;
async function read(path) {
  const r = await fetch(new URL(path, base), {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000)});
  assert.equal(r.status, 200, `Asset ${path}: HTTP ${r.status}`); return r.text();
}
const html = await read('./');
assert.ok(html.includes('Проверка Lift') && html.includes('id="export"'));
const build = JSON.parse(await read('build-info.json'));
assert.equal(build.version, 'search-1'); assert.equal(build.commit, process.env.GITHUB_SHA);
const config = await read('config.js');
assert.ok(config.includes('https://api.liftw.ws/info/') && !config.includes('embedUrl'));
const worker = await read('sw.js');
assert.ok(worker.includes('requests.every') && !worker.includes("addEventListener('fetch'"));
assert.ok(worker.includes("importScripts('./vendor/webtorrent.sw.min.js')"));
assert.ok((await read('vendor/webtorrent.sw.min.js')).includes('ReadableStream'));
const catalog=JSON.parse(await read('catalog.json'));assert.equal(catalog.filter(item=>item.ownerSample).length,10);
assert.ok(html.includes('value="wt-webrtc"') && html.includes('value="wt-http"'));
const manifest = JSON.parse(await read('manifest.webmanifest'));
assert.equal(manifest.scope, './'); assert.equal(manifest.start_url, './');
const result = `Published Lift shell verified: ${base}\nCommit: ${build.commit}\nUTC: ${new Date().toISOString()}\nPhysical iPhone and full advertising observation: pending.\n`;
console.log(result);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, result);
