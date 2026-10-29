import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import {buildA01} from './build-a01.mjs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(new URL('web/', root), dist, { recursive: true });
let commit = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
if (!commit) { try { const {execFileSync}=await import('node:child_process');commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(); } catch {} }
if (!commit) {
  try {
    const head = (await readFile(new URL('.git/HEAD',root),'utf8')).trim();
    commit = head.startsWith('ref: ') ? (await readFile(new URL('.git/'+head.slice(5),root),'utf8')).trim() : head;
  } catch { commit = JSON.parse(await readFile(new URL('RELEASE.json',root),'utf8')).commit; }
}
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Build commit is missing or invalid');
const builtAt = new Date().toISOString();
await writeFile(new URL('build.js',dist),(await readFile(new URL('build.js',dist),'utf8')).replace('__COMMIT__',commit).replace('__BUILT_AT__',builtAt));
await writeFile(new URL('build-info.json',dist),JSON.stringify({version:'search-2',commit,builtAt})+'\n');
await mkdir(new URL('vendor/',dist),{recursive:true});
let webtorrentBundle=await readFile(new URL('node_modules/webtorrent/dist/webtorrent.min.js',root),'utf8');
// Pinned upstream fsa-chunk-store has an unconditional origin-wide `chunks` wipe.
// We use SessionPieceStore instead; remove only that import-time destructive side effect.
const unsafeCleanup='globalThis.navigator?.storage?.getDirectory&&navigator.storage.getDirectory().then(e=>{e.removeEntry("chunks",{recursive:!0}).catch(()=>{})});';
if(webtorrentBundle.split(unsafeCleanup).length!==2)throw Error('Review WebTorrent startup-storage cleanup patch for the pinned bundle');
webtorrentBundle=webtorrentBundle.replace(unsafeCleanup,'');
await writeFile(new URL('vendor/webtorrent.min.js',dist),webtorrentBundle);
await writeFile(new URL('vendor/NOTICE.txt',dist),'WebTorrent 3.0.21 official browser ESM bundle. Only the unconditional fsa-chunk-store startup deletion of generic OPFS/chunks was removed. Standard store option selects our isolated per-session chunk store. Network/BitTorrent/WebRTC implementations are unchanged. See WebTorrent.LICENSE.\n');
await cp(new URL('node_modules/webtorrent/dist/sw.min.js',root),new URL('vendor/webtorrent.sw.min.js',dist));
await cp(new URL('node_modules/webtorrent/LICENSE',root),new URL('vendor/WebTorrent.LICENSE',dist));
// Only the Lift shell is deployed. Historical registries and evidence stay in Git.

// Deterministic PNG application icons, no external asset requests.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
function icon(size) {
  const raw = Buffer.alloc((1 + size * 3) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = x / size, b = y / size;
    const cornerX = (a >= .225 && a <= .275) || (a >= .725 && a <= .775);
    const cornerY = (b >= .265 && b <= .42) || (b >= .58 && b <= .735);
    const barX = (a >= .225 && a <= .385) || (a >= .615 && a <= .775);
    const barY = (b >= .265 && b <= .315) || (b >= .685 && b <= .735);
    const triangle = a >= .435 && a <= .61 && Math.abs(b - .5) <= (.61 - a) * .64;
    const rgb = ((cornerX && cornerY) || (barX && barY) || triangle) ? [180, 217, 208] : [16, 44, 53];
    const offset = y * (size * 3 + 1) + 1 + x * 3; raw.set(rgb, offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [filename, size] of [['icon-192.png',192], ['icon-512.png',512], ['apple-touch-icon.png',180]]) await writeFile(new URL(`icons/${filename}`, dist), icon(size));
async function hashFiles(dir) {
  const hash = createHash('sha256');
  async function walk(current) {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const name = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(name); else { hash.update(name.slice(dir.length)); hash.update(await readFile(name)); }
    }
  }
  await walk(dir); return hash.digest('hex').slice(0, 12);
}
await buildA01(dist, root);
const buildId = await hashFiles(dist.pathname);
await writeFile(new URL('.nojekyll', dist), '');
console.log(`Static build ready: dist/ (${buildId})`);
