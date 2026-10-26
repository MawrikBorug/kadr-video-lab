import {cp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
// Add a diagnostic subdirectory to the existing Pages artifact. Root files stay intact.
export async function buildA01(dist,root) {
  const entries=await readdir(dist,{withFileTypes:true});
  if(entries.some(e=>e.name==='a01'))throw Error('Unexpected existing a01 output');
  const target=new URL('a01/',dist); await mkdir(target);
  for(const e of entries)await cp(new URL(e.name,dist),new URL(e.name,target),{recursive:true});
  let harness=await readFile(new URL('harness.mjs',target),'utf8');
  for(const [before,after] of [
    ["import {BUILD} from './build.js';","import {BUILD} from './build.js';\nimport {attachLiftSettingsProbe} from './lift-settings-probe.mjs';"],
    ['let runtime = {}, rejectedPending = 0, rejectedTimer = null;','let runtime = {}, rejectedPending = 0, rejectedTimer = null;\nlet settingsProbe = null;'],
    ['async function detach(closeSearch = true) {','async function detach(closeSearch = true) {\n  settingsProbe?.dispose(); settingsProbe = null;'],
    ["    $('placeholder').hidden = true; $('player-container').append(mounted);","    $('placeholder').hidden = true; $('player-container').append(mounted);\n    settingsProbe = attachLiftSettingsProbe(mounted, generation, () => run.generation);"]
  ]) {if(harness.split(before).length!==2)throw Error('A01 harness integration anchor changed');harness=harness.replace(before,after);}
  await writeFile(new URL('harness.mjs',target),harness);
  await cp(new URL('diagnostics/a01/lift-settings-probe.mjs',root),new URL('lift-settings-probe.mjs',target));
  let html=await readFile(new URL('index.html',target),'utf8');
  html=html.replace('<title>','<title>A01 · ');
  await writeFile(new URL('index.html',target),html);
  const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',target),'utf8'));
  manifest.name='КАДР · диагностика A01';manifest.short_name='КАДР A01';
  await writeFile(new URL('manifest.webmanifest',target),JSON.stringify(manifest)+'\n');
}
