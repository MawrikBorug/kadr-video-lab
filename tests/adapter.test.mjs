import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdapter} from '../server/adapter.mjs';
const env={KADR_ALLOWED_ORIGIN:'https://mawrikborug.github.io',KADR_ADAPTER_ACCESS_TOKEN:'fixture-lab-password',VOKINO_API_TOKEN:'FIXTURE_PRIVATE_UPSTREAM_VALUE'};
const request=(body,headers={})=>new Request('https://private.example/v1/check',{method:'POST',headers:{origin:env.KADR_ALLOWED_ORIGIN,authorization:'Bearer '+env.KADR_ADAPTER_ACCESS_TOKEN,...headers},body:JSON.stringify(body)});
test('server adapter gates origin, lab auth and arbitrary upstream fields before fetching',async()=>{
 let calls=0;const handler=createAdapter({env,fetcher:()=>{calls++;throw new Error();}});
 assert.equal((await handler(request({provider:'vokino',operation:'online',id:4540126},{origin:'https://other.example'}))).status,403);
 assert.equal((await handler(request({provider:'vokino',operation:'online',id:4540126},{authorization:'Bearer wrong'}))).status,401);
 assert.equal((await handler(request({provider:'vokino',operation:'online',id:4540126,url:'https://arbitrary.example'}))).status,400);
 assert.equal(calls,0);
});
test('own key stays in the server request; app 401 inside HTTP 200 remains auth error',async()=>{
 let upstream;const handler=createAdapter({env,fetcher:async u=>{upstream=String(u);return new Response(JSON.stringify({error:401,privateDump:env.VOKINO_API_TOKEN}),{headers:{'content-type':'application/json'}});}});
 const result=await handler(request({provider:'vokino',operation:'online',id:4540126}));
 assert.equal(result.status,403);assert.ok(upstream.includes(env.VOKINO_API_TOKEN));const body=await result.text();assert.ok(!body.includes(env.VOKINO_API_TOKEN));assert.match(body,/auth-required/);
});
test('successful summaries also exclude arbitrary secret fields; adapter has a hard request budget',async()=>{
 let calls=0;const handler=createAdapter({env,fetcher:async()=>{calls++;return new Response(JSON.stringify({results:[{unusual:env.VOKINO_API_TOKEN}],nested:{url:'https://cdn.example/?token=hidden'}}));}});
 for(let i=0;i<10;i++){const r=await handler(request({provider:'vokino',operation:'online',id:4540126}));assert.equal(r.status,200);assert.ok(!(await r.text()).includes(env.VOKINO_API_TOKEN));}
 assert.equal((await handler(request({provider:'vokino',operation:'online',id:4540126}))).status,429);assert.equal(calls,10);
});
