import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
const forbidden=['CANARY_PRIVATE_VALUE','FIXTURE_PRIVATE_UPSTREAM_VALUE','fixture-lab-password'];
async function walk(path){for(const item of await readdir(path,{withFileTypes:true})){const full=path+'/'+item.name;if(item.isDirectory())await walk(full);else{
 assert.ok(!/\.env|\.pem$|\.key$|adapter\.mjs$|start\.mjs$/.test(full),'Server or secret file in public build');
 if(/\.(?:js|json|html|md|txt|csv)$/.test(full)){const text=await readFile(full,'utf8');for(const secret of forbidden)assert.ok(!text.includes(secret),'Credential canary in public build');}
}}}
await walk('dist');
const index=await readFile('dist/index.html','utf8');assert.ok(!index.includes("connect-src *")&&!index.includes("frame-src *"));
const build=JSON.parse(await readFile('dist/build-info.json'));assert.match(build.commit,/^[a-f0-9]{40}$/);
console.log('Public build scan PASS: finite origins, no server files or credential canaries.');
