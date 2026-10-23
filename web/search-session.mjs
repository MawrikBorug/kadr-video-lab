import {BUILD} from './build.js';
import {LIMITS} from './search-config.mjs';
import {LocatorVault,SearchAdapter,candidateKey} from './source-search.mjs';
import {CandidateProbe,SearchBudget} from './source-probe.mjs';
import {now,failure,safeText} from './source-utils.mjs';

export const SEARCH_JOURNAL_KEY='kadr.videoLab.search.v1';
export function safeSearchResult(run) {
  // The runtime vault, raw responses, metadata bytes and direct URLs are never
  // part of a run. Defend release-title/error text before storage as well.
  return JSON.parse(JSON.stringify(run,(key,value)=>typeof value==='string'?safeText(value,Math.max(800,key==='candidateId'?36:0)):value));
}
export class SearchSession {
  constructor({work,onChange=()=>{},onSave=()=>{},mappings=[],packages=[],limits=LIMITS,probeFactory=opts=>new CandidateProbe(opts),sources,
    environment={}}){
    Object.assign(this,{onChange,onSave,mappings,packages,limits,probeFactory,sources});
    this.vault=new LocatorVault();this.budget=new SearchBudget(limits);this.searchAbort=new AbortController();this.visited=new Set();this.resolvedIdentities=new Map();this.metadataCache=new Map();
    this.run={schema:1,runId:crypto.randomUUID(),searchId:crypto.randomUUID(),started:now(),build:BUILD,work:{...work},limits:{...limits},
      environment,hostStates:[],candidates:[],events:[],droppedEvents:0,queueState:'waiting',playback:null,searchState:'requesting',counters:{}};
    this.adapter=new SearchAdapter({vault:this.vault,limits});this.cancelled=false;
  }
  event(kind,details={}) {
    this.run.events.push({utc:now(),kind,...details});if(this.run.events.length>3000){this.run.events.shift();this.run.droppedEvents++;}this.changed();
  }
  changed(){this.run.counters={searchBytes:this.budget.searchBytes,metadataBytes:this.budget.metadataBytes,payloadBytes:this.budget.payloadBytes,reservedPayloadBytes:this.budget.reservedPayloadBytes};this.onChange(this.run);this.onSave(this.run);}
  eligible(candidate){return candidate.identity.match==='exact-id' && (!this.filter || this.filter(candidate));}
  add(candidates) {
    if(this.cancelled)return;
    for(const c of candidates){
      const key=candidateKey(c),existing=this.run.candidates.find(item=>candidateKey(item)===key);
      if(existing){existing.origins=[...new Set([...existing.origins,...c.origins])];this.vault.items.delete(c.candidateId);continue;}
      if(this.run.candidates.length>=this.limits.maxResults)break;this.run.candidates.push(c);
    }
    this.event('found',{totalUnique:this.run.candidates.length});this.queue();
  }
  async start(){
    this.event('search_started',{work:this.run.work,limits:this.limits});
    await this.adapter.primaryThenFallback(this.run.work,{signal:this.searchAbort.signal,
      onState:state=>{const i=this.run.hostStates.findIndex(x=>x.instanceId===state.instanceId);if(i<0)this.run.hostStates.push(state);else this.run.hostStates[i]=state;this.changed();},
      onCandidates:items=>this.add(items),onBytes:n=>this.budget.count('searchBytes',n)},this.sources);
    if(this.cancelled)return;
    this.run.searchState='finished';this.event('search_finished',{count:this.run.candidates.length});this.queue();
  }
  queue(){
    if(this.cancelled || this.queuePaused || this.worker || this.checkedCount>=this.limits.candidates)return;
    this.checkedCount ||= 0;
    if(!this.queueAbort){this.queueAbort=new AbortController();this.queueStarted=performance.now();
      this.queueTimer=setTimeout(()=>{this.run.queueState='time-limit';this.queueAbort.abort({code:'QUEUE_TIME_LIMIT'});this.changed();},this.limits.queueMs);}
    this.worker=this.workQueue().finally(()=>{this.worker=null;
      if(!this.cancelled && !this.queuePaused && !this.queueAbort?.signal.aborted && this.checkedCount<this.limits.candidates && this.nextCandidate())this.queue();
    });
  }
  nextCandidate(){
    return this.run.candidates.filter(c=>this.eligible(c) && !this.visited.has(candidateKey(c)))
      .sort((a,b)=>this.rank(b)-this.rank(a))[0];
  }
  rank(c){return (c.torrent.fileIdx!=null?30:0)+(c.claims.container==='mp4'?20:0)+(['720p','1080p'].includes(c.claims.resolution)?5:0)+(c.claims.languages.includes('ru')?2:0);}
  async workQueue(){
    while(!this.cancelled && !this.queuePaused && !this.queueAbort.signal.aborted && this.checkedCount<this.limits.candidates){
      const candidate=this.nextCandidate();if(!candidate)break;
      this.visited.add(candidateKey(candidate));this.checkedCount++;this.run.queueState='checking';
      const probe=this.activeProbe=this.probeFactory({candidate,vault:this.vault,budget:this.budget,limits:this.limits,mappings:this.mappings,packages:this.packages,
        metadataCache:this.metadataCache,onResolved:c=>{const key=candidateKey(c),previous=this.resolvedIdentities.get(key);if(previous && previous!==c.candidateId)return false;this.resolvedIdentities.set(key,c.candidateId);return true;},
        signal:this.queueAbort.signal,onChange:()=>{if(!this.cancelled)this.changed();},
        onEvent:(kind,details)=>{this.event(kind,{candidateId:candidate.candidateId,...details});}});
      try{await probe.run();}catch(e){candidate.probeReason=failure(e).code;this.event('probe_error',{...failure(e)});}
      this.visited.add(candidateKey(candidate));this.activeProbe=null;
    }
    if(!this.cancelled){this.run.queueState=this.queuePaused?'paused':this.queueAbort.signal.aborted?(this.queueAbort.signal.reason?.code==='QUEUE_TIME_LIMIT'?'time-limit':'stopped'):this.checkedCount>=this.limits.candidates?'batch-complete':'waiting-for-results';
      this.run.checkedCount=this.checkedCount;this.changed();}
    if(this.run.queueState==='batch-complete')clearTimeout(this.queueTimer);
  }
  async stopQueue(reason='user-stop') {
    this.queuePaused=true;clearTimeout(this.queueTimer);this.queueAbort?.abort();
    await this.worker;this.run.queueState='paused';this.event('queue_stopped',{reason});
  }
  async nextBatch(){
    await this.stopQueue('next-batch');if(this.cancelled)return;
    this.checkedCount=0;this.queuePaused=false;this.queueAbort=null;this.queue();
  }
  async cancel(reason='selection-changed'){
    if(this.cancelled)return;this.cancelled=true;this.searchAbort.abort();await this.stopQueue(reason);
    this.run.searchState='cancelled';this.run.finished=now();this.event('search_cancelled',{reason});this.vault.clear();this.metadataCache.clear();
  }
}
