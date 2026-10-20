import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdapter} from '../server/adapter.mjs';
import {videoseedFrame,videoseedSearch} from '../web/videoseed.js';
import {PROVIDERS,configForSample} from '../web/providers.js';
import {createRun,QueueRunner} from '../web/queue.js';
import {exportJSON,makeRecord} from '../web/core.js';
import {protectValue} from '../web/security.js';
const player='a'.repeat(32),base='FIXTURE_PRIVATE_UPSTREAM_VALUE';
const env={KADR_ALLOWED_ORIGIN:'https://mawrikborug.github.io',KADR_ADAPTER_ACCESS_TOKEN:'fixture-lab-password',VIDEOSEED_CONTENT_API_KEY:base,VIDEOSEED_PLAYER_TOKEN:player,VIDEOSEED_CONTRACT_CONFIRMED:'true'};
const req=b=>new Request('https://private.example/v1/check',{method:'POST',headers:{origin:env.KADR_ALLOWED_ORIGIN,authorization:'Bearer '+env.KADR_ADAPTER_ACCESS_TOKEN},body:JSON.stringify(b)});
const query={provider:'videoseed',operation:'search',title:'Synthetic contract fixture',type:'tv',year:2024,season:2,episode:3};
test('Videoseed owned content key is server-only; player token goes only to the official embed',async()=>{
 let url;const handler=createAdapter({env,fetcher:async u=>{url=new URL(u);return new Response(JSON.stringify({status:'success',data:[{id:12,title:'Synthetic contract fixture',year:2024,kp:55,seasons:{2:{videos:{3:{translation_iframe:{ru:{short_name:'RU fixture',iframe:'https://tv-1-kinoserial.net/embed/123?token=old'}}}}}}}]}));}});
 const r=await handler(req(query)),b=await r.json();assert.equal(r.status,200);assert.equal(url.searchParams.get('token'),base);assert.equal(url.searchParams.get('q'),query.title);assert.equal(url.searchParams.get('release_year_from'),'2024');
 const choice=b.results[0].choices[0];assert.equal(choice.season,2);assert.equal(choice.episode,3);assert.equal(new URL(choice.embedURL).searchParams.get('token'),player);assert.ok(!JSON.stringify(b).includes(base));assert.equal(b.mediaSessionConfirmed,false);
 protectValue(player);const record=makeRecord({provider:'videoseed',title:'fixture',stage:'E1',namespace:'videoseed',id:'12'},{});record.details.notes='Unlabelled '+player;record.technical.selected={embedURL:choice.embedURL};assert.ok(!exportJSON([record]).includes(player));
});
test('Videoseed rejects error-in-200, missing contract, altered response and arbitrary upstream',async()=>{
 const invalid=createAdapter({env,fetcher:async()=>new Response('{"status":"error","error_info":"invalid token"}')});assert.equal((await invalid(req(query))).status,403);
 const gated=createAdapter({env:{...env,VIDEOSEED_CONTRACT_CONFIRMED:'false'},fetcher:()=>{throw new Error('must not fetch');}});assert.equal((await gated(req(query))).status,409);
 const unknown=createAdapter({env,fetcher:async()=>new Response('{"status":"ok","data":[{"unknown":true}]}')});assert.equal((await unknown(req(query))).status,502);
 const arbitrary=await invalid(req({...query,url:'https://other.example'}));assert.equal(arbitrary.status,400);
});
test('direct Videoseed address never mistakes KP for provider ID; TV needs manual episode confirmation',()=>{
 assert.throws(()=>videoseedFrame({id:12,namespace:'kp'},player),e=>e.code==='no-address');
 assert.throws(()=>videoseedFrame({id:12,namespace:'videoseed'},''),e=>e.code==='auth-required');
 const f=videoseedFrame({id:12,namespace:'videoseed',type:'tv',season:2,episode:3},player);assert.equal(f.sandbox,'allow-scripts allow-same-origin');assert.equal(f.episodeSelection.source,'manual-in-player');assert.ok(!f.url.includes('season='));
 const c=configForSample('videoseed','embed',{key:'own',videoseed:'12',title:'Own fixture',type:'movie'});assert.equal(c.namespace,'videoseed');assert.equal(c.id,'12');assert.ok(PROVIDERS.vidzee&&PROVIDERS.collaps,'archived adapter code retained');
});
test('old queues stay reviewable but cannot execute after cleanup',async()=>{
 const run=createRun([]);delete run.selectionEdition;let executed=0;const runner=new QueueRunner({execute:async()=>executed++});await assert.rejects(runner.start(run),/Архивная очередь/);assert.equal(executed,0);
});
test('client search never sends database or player key and distinguishes backend rejection',async()=>{
 let payload;await assert.rejects(videoseedSearch({title:'Fixture',type:'movie',year:2024},{endpoint:'https://private.example',accessToken:'fixture-lab-password',fetcher:async(_url,o)=>{payload=JSON.parse(o.body);return new Response('{"code":"own-content-key-rejected"}',{status:403});}}),e=>e.code==='auth-required');assert.equal(payload.provider,'videoseed');assert.ok(!JSON.stringify(payload).includes(base));assert.ok(!JSON.stringify(payload).includes(player));
});
