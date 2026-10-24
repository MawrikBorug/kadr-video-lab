// Bounded native torrent-cache capability survey from the published browser origin.
import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
const base='https://mawrikborug.github.io/kadr-video-lab/';
const output=process.env.METADATA_SURVEY_DIR || 'artifacts/metadata-survey';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}});
try {
 const page=await browser.newPage();await page.goto(base+'fixtures/README.txt');
 const hashes=['f288db0e01560e7989b105a494a1d8e3674faaa8','7eebe91290da5dc0e209296e654a71d0aa8d73e2','13978ae18c7b67fba9ee4ea2863d832943c955c2'];
 const caches=[['itorrents.org',h=>`https://itorrents.org/torrent/${h.toUpperCase()}.torrent`],['itorrents.net',h=>`https://itorrents.net/torrent/${h.toUpperCase()}.torrent`],['torrage.info',h=>`https://torrage.info/torrent.php?h=${h}`],['btcache.me',h=>`https://btcache.me/torrent/${h.toUpperCase()}`]];
 const rows=[];
 for(const [host,url] of caches){
  const results=await Promise.all(hashes.map(infoHash=>page.evaluate(async({url,infoHash,host,base})=>{
   const {requestBytes,failure}=await import(base+'source-utils.mjs'),{parseMetadata}=await import(base+'torrent-metadata.mjs');
   const started=performance.now();let received=0;
   try{const {bytes,response}=await requestBytes(url,{signal:AbortSignal.timeout(10000),ms:9000,max:1048576,onBytes:n=>received+=n});
    const meta=await parseMetadata(bytes,infoHash);return {host,infoHash,status:response.status,received,elapsedMs:Math.round(performance.now()-started),hashVerified:true,fileCount:meta.files.length,files:meta.files.map(({fileIdx,path,length,video})=>({fileIdx,path,length,video})),webseeds:meta.webseeds.length};
   }catch(e){return {host,infoHash,received,elapsedMs:Math.round(performance.now()-started),error:failure(e)};}
  },{url:url(infoHash),infoHash,host,base})));
  rows.push(...results);await writeFile(output+'/metadata-survey.json',JSON.stringify({utc:new Date().toISOString(),base,rows},null,2)+'\n');
  for(const r of results)console.log(r.host,r.infoHash,r.hashVerified || r.error.code,r.received,r.fileCount || '');
 }
}finally{await browser.close();}
