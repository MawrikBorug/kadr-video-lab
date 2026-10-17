import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';

const observed = process.env.PUBLISHED_URL;
assert.ok(observed, 'No URL returned by deployment; publication is not verified.');
const base = new URL(observed);
assert.ok(base.protocol === 'https:' && base.hostname.endsWith('.github.io') && !base.username && !base.password && !base.search && !base.hash, 'Unexpected deployment URL.');
if (!base.pathname.endsWith('/')) base.pathname += '/';

async function read(relative) {
  const url = new URL(relative, base);
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect:'error' });
  assert.equal(response.status, 200, `${relative}: HTTP ${response.status}`);
  return response.text();
}
const html = await read('./');
assert.ok(html.includes('КАДР 3.3 — лаборатория видео') && html.includes('id="export-json"'), 'Wrong page or incomplete deployment.');
const manifest = JSON.parse(await read('manifest.webmanifest'));
assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './');
const worker = await read('sw.js'); assert.ok(worker.includes('kadr-lab-') && !worker.includes('__BUILD_ID__'));
const samples = JSON.parse(await read('data/samples.json')); assert.equal(samples.length, 12);
assert.ok((await read('app.js')).includes('exportJSON(records)'));
const result = `Verified public static assets: ${base.href}\nCommit: ${process.env.GITHUB_SHA || 'unknown'}\nChecked: ${new Date().toISOString()}\nPhysical iPhone / RU playback and advertising remain NOT_RUN.\n`;
console.log(result);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, result);
