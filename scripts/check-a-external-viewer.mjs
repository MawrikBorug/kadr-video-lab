// Managed browser viewer against the separately proven temporary CI seeder.
import {chromium} from '@playwright/test';import {mkdir,writeFile} from 'node:fs/promises';
const base='https://mawrikborug.github.io/kadr-video-lab/',output=process.env.EXTERNAL_EVIDENCE_DIR || 'artifacts/external-viewer';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
try{
 const page=await browser.newPage();await page.goto(base+'fixtures/README.txt');
 const result=await page.evaluate(async({base,run})=>{
  const {CandidateProbe,SearchBudget}=await import(base+'source-probe.mjs'),{LocatorVault,normalizeStream}=await import(base+'source-search.mjs'),{WORKS,workQuery}=await import(base+'search-config.mjs');
  const vault=new LocatorVault(),c=normalizeStream({infoHash:'05b36bedda4c62b73af236553176141c51912689',name:'OWNED CONTROL; remote temporary seeder; synthetic search identity'},workQuery(WORKS.find(w=>w.type==='movie')),{id:'external-control',label:'External CI developer seeder'},vault);
  const events=[],probe=new CandidateProbe({candidate:c,vault,budget:new SearchBudget(),signal:new AbortController().signal,onChange:()=>{},onEvent:(kind,details)=>events.push({utc:new Date().toISOString(),kind,...details})});
  await probe.run();return {utc:new Date().toISOString(),seederWorkflowRun:run,build:await(await fetch(base+'build-info.json',{cache:'no-store'})).json(),stats:probe.stats,candidate:c,events,
   scope:'System managed Chromium; no local seeder, no policy changes, no HTTP metadata or media fallback; correlate timestamps with CI externalWindow'};
 },{base,run:process.env.SEEDER_RUN_ID || 'unrecorded'});
 await writeFile(output+'/viewer.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({build:result.build,stats:result.stats}));
}finally{await browser.close();}
