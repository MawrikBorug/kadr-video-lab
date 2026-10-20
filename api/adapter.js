import {createAdapter} from '../server/adapter.mjs';
const adapter=createAdapter();
export const config={maxDuration:20};
export default async function handler(req,res){
 const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
 let body='';
 if(req.method==='POST'){
  if(req.body!==undefined)body=typeof req.body==='string'?req.body:JSON.stringify(req.body);
  else for await(const chunk of req){body+=chunk;if(body.length>4096)break;}
  if(body.length>4096){res.statusCode=413;res.setHeader('cache-control','no-store');res.end('{"code":"request-too-large"}');return;}
 }
 const request=new Request('https://private-lab.invalid/v1/check',{method:req.method,headers,...(body?{body}: {})});
 const response=await adapter(request);res.statusCode=response.status;for(const [k,v] of response.headers)res.setHeader(k,v);res.end(await response.text());
}
