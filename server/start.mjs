import http from 'node:http';
import {createAdapter} from './adapter.mjs';
const handler=createAdapter();
http.createServer(async(req,res)=>{
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>4096){res.writeHead(413);res.end();return;}chunks.push(chunk);}
 const request=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
 const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
}).listen(Number(process.env.PORT||8787),process.env.KADR_BIND_HOST||'127.0.0.1',()=>process.stdout.write('Private lab adapter ready; credentials are server-only.\n'));
