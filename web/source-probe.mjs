import {LIMITS} from './search-config.mjs';
import {SourceError,requestBytes,linkedSignal,failure,safeOrigin,now} from './source-utils.mjs';
import {parseMetadata,resolveFile,sha1,webseedFileURL,explicitFileAllowed} from './torrent-metadata.mjs';
import {loadWebTorrent} from './torrent.mjs';
import {TRACKERS} from './torrent-materials.js';
import {SessionPieceStore} from './piece-store.mjs';

export class SearchBudget {
  constructor(limits=LIMITS){this.limits=limits;this.searchBytes=0;this.metadataBytes=0;this.payloadBytes=0;this.reservedPayloadBytes=0;}
  count(kind,n){this[kind]+=n;const max=kind==='searchBytes'?this.limits.searchTotalBytes:kind==='metadataBytes'?this.limits.metadataTotalBytes:this.limits.payloadBytes;if(this[kind]>max)throw new SourceError(kind==='payloadBytes'?'PAYLOAD_BUDGET':'METADATA_OR_SEARCH_BUDGET');}
  reserve(n){if(n>this.limits.payloadBytes-this.reservedPayloadBytes)throw new SourceError('PAYLOAD_BUDGET');this.reservedPayloadBytes+=n;}
  remaining(){return this.limits.payloadBytes-this.reservedPayloadBytes;}
}
export function applyFile(candidate,meta,mappings,locator) {
  const selected=resolveFile(meta,candidate.work,locator.claimedIdx,mappings);
  const index=Number.isInteger(locator.explicitFileIdx)?locator.explicitFileIdx:selected.index;
  const file=meta.files[index];
  if(file && !explicitFileAllowed(meta,file,candidate.work,mappings))throw new SourceError('WRONG_EPISODE');
  Object.assign(candidate.torrent,{metadataHashVerified:true,fileIdx:file?.fileIdx ?? null,filePath:file?.path ?? null,fileLength:file?.length ?? null,
    packageKind:meta.files.filter(f=>f.video).length>1?'season':'single'});
  candidate.identity.episodeMatch=file?'file-verified':'unresolved';candidate.identity.reason=locator.explicitFileIdx!=null?'explicit user selection of torrent path':selected.basis;
  candidate.states.file=file?'verified':'unresolved';
  if(!file)throw new SourceError('FILE_UNRESOLVED');if(!file.video)throw new SourceError('FILE_NOT_VIDEO');return file;
}
export class CandidateProbe {
  constructor({candidate,vault,budget,limits=LIMITS,mappings=[],packages=[],signal,onChange,onEvent=()=>{},onResolved=()=>true,metadataCache}){
    Object.assign(this,{candidate,vault,budget,limits,mappings,packages,onChange,onEvent,onResolved,metadataCache});
    this.scope=linkedSignal(signal,limits.candidateMs);this.signal=this.scope.signal;this.probeId=crypto.randomUUID();
    this.stats={probeId:this.probeId,started:now(),webrtcBytes:0,httpBytes:0,verifiedBytes:0,metadataBytes:0,trackerResponses:0,peerCandidates:0,localICE:0,connectedWires:0,iceFailures:0};
  }
  emit(kind,details={}){this.onEvent(kind,{probeId:this.probeId,...details});}
  change(){this.candidate.probe={...this.stats};this.onChange();}
  metadataBytes(n){this.stats.metadataBytes+=n;this.budget.count('metadataBytes',n);}
  async metadata() {
    const c=this.candidate,locator=this.vault.get(c);
    if(locator.metadata && locator.meta)return locator.meta;
    const cached=this.metadataCache?.get(c.torrent.infoHash);
    if(cached){Object.assign(locator,{metadata:cached.metadata,meta:cached.meta});c.metadataProvenance={...cached.provenance,reusedInSearch:true};
      this.emit('metadata_reused',{infoHash:c.torrent.infoHash,source:'same search; hash-verified metadata'});return locator.meta;}
    const known=this.packages.find(p=>p.infohash===c.torrent.infoHash);
    const urls=[...locator.metadataURLs.slice(0,1).map(url=>({url,host:safeOrigin(url),mode:'live-metadata'})),
      ...(known?[{url:known.fixture,host:'same-origin verified metadata snapshot',mode:known.dataMode || 'offline-metadata-verified-hash'}]:[])];
    for(const source of urls){
      try {
        this.emit('metadata_requested',{host:source.host,dataMode:source.mode,infoHash:c.torrent.infoHash});
        const {bytes}=await requestBytes(source.url,{signal:this.signal,max:this.limits.metadataBytes,ms:this.limits.metadataRequestMs,onBytes:n=>this.metadataBytes(n)});
        const meta=await parseMetadata(bytes,c.torrent.infoHash,{maxBytes:this.limits.metadataBytes,maxFiles:this.limits.maxFiles});
        if(this.signal.aborted)throw new SourceError('CANCELLED');
        locator.metadata=bytes;locator.meta=meta;
        c.metadataProvenance={host:source.host,dataMode:source.mode,checkedAt:now(),infoHash:meta.infoHash,bytes:bytes.length,
          ...(known?.retrievedAt && source.mode!=='live-metadata'?{snapshotRetrievedAt:known.retrievedAt}:{})};
        this.metadataCache?.set(c.torrent.infoHash,{metadata:bytes,meta,provenance:c.metadataProvenance});
        this.emit('metadata_verified',{...c.metadataProvenance,fileCount:meta.files.length});return meta;
      }catch(e){this.emit('metadata_failure',{host:source.host,...failure(e)});if(this.signal.aborted || /BUDGET|SIZE_LIMIT/.test(e.code))throw e;}
    }
    this.emit('metadata_deferred',{code:'BEP9_OR_LOCAL_TORRENT_REQUIRED',infoHash:c.torrent.infoHash});
    return null; // No working native HTTPS source: try BEP9, or explicit local import.
  }
  async run() {
    const c=this.candidate;c.states.transport='checking';this.change();this.emit('probe_started',{limits:this.limits});
    try {
      if(!c.torrent.infoHash){await this.direct();return;}
      let meta=await this.metadata();
      if(meta){
        let file;
        try{file=applyFile(c,meta,this.mappings,this.vault.get(c));if(!this.onResolved(c))throw new SourceError('DUPLICATE_RESOLVED_FILE');}catch(e){
          c.states.B=meta.webseeds.length?'file-unresolved':'webseed-not-found';throw e;
        }
        if(meta.webseeds.length){
          try{await this.webseed(meta,file);c.states.A='not-run-B-selected';return;}catch(e){c.states.B=failure(e).code;this.emit('B_failure',failure(e));if(this.signal.aborted || /BUDGET|SIZE_LIMIT/.test(e.code))throw e;}
        }else {c.states.B=meta.httpSeeds || 'webseed-not-found';this.emit('B_unavailable',{code:c.states.B,scope:'Webseed not found in available metadata; not a global absence claim'});}
      }else c.states.B='metadata-unavailable';
      await this.webrtc(meta);
    } catch(e) {
      const code=this.scope.timedOut?'CANDIDATE_TIME_LIMIT':this.signal.reason?.code==='QUEUE_TIME_LIMIT'?'QUEUE_TIME_LIMIT':failure(e).code;
      c.states.transport=code==='CANCELLED'?'cancelled':'finished';c.probeReason=code;
      if(c.states.A==='checking')c.states.A=this.stats.localICE===0 && this.stats.localICEComplete?'LOCAL_ICE_NO_CANDIDATES':code==='CANDIDATE_TIME_LIMIT'?'NO_WEBRTC_BYTES_IN_WINDOW':code;
      if(c.states.direct==='checking')c.states.direct=code;
      this.emit('probe_finished',{code,stats:{...this.stats}});
    } finally {
      await this.close();this.stats.finished=now();this.stats.resourcesClosed=true;c.states.transport='finished';
      this.emit('probe_resources_closed',{clientDestroyed:true});this.change();
    }
  }
  async webseed(meta,file) {
    const c=this.candidate;c.states.B='checking';this.change();
    // Verify one complete global piece overlapping the selected file, including
    // its neighbours in multifile torrents. No byte from a different encode.
    const piece=Math.floor(file.offset/meta.pieceLength),start=piece*meta.pieceLength,end=Math.min(meta.length,start+meta.pieceLength)-1,length=end-start+1;
    if(length>this.budget.remaining())throw new SourceError('PAYLOAD_BUDGET');
    const fragments=[];
    for(const part of meta.files.filter(f=>f.offset<=end && f.offset+f.length>start)){
      const from=Math.max(start,part.offset)-part.offset,to=Math.min(end,part.offset+part.length-1)-part.offset;
      const url=webseedFileURL(meta.webseeds[0],meta,part),size=to-from+1;
      this.budget.reserve(size);
      const {bytes,response}=await requestBytes(url,{signal:this.signal,ms:this.limits.candidateMs,max:size,range:true,headers:{Range:`bytes=${from}-${to}`},
        onBytes:n=>{this.stats.httpBytes+=n;this.budget.count('payloadBytes',n);}});
      if(response.headers.get('content-range')!==`bytes ${from}-${to}/${part.length}` || bytes.length!==size)throw new SourceError('CONTENT_RANGE_MISMATCH');
      if(/text\/html/i.test(response.headers.get('content-type') || ''))throw new SourceError('HTML_INSTEAD_OF_MEDIA');fragments.push(bytes);
    }
    const bytes=new Uint8Array(length);let offset=0;for(const f of fragments){bytes.set(f,offset);offset+=f.length;}
    const expected=Array.from(meta.pieces.subarray(piece*20,piece*20+20),v=>v.toString(16).padStart(2,'0')).join('');
    if(await sha1(bytes)!==expected)throw new SourceError('PIECE_HASH_MISMATCH');
    if(this.signal.aborted)throw new SourceError('CANCELLED');
    this.stats.verifiedBytes=length;c.states.B='bytes-received';c.delivery.state='bytes-received';c.delivery.kind='webseed';
    c.delivery.webseed={urlRef:'session-metadata',pieceHashMatched:true};c.delivery.range='verified-206';c.delivery.cors='readable';
    this.emit('bytes_verified',{transport:'B',piece,bytes:length,fileIdx:file.fileIdx,globalOffset:start});
  }
  async webrtc(meta) {
    const c=this.candidate,locator=this.vault.get(c);c.states.A='checking';this.change();
    const WebTorrent=await loadWebTorrent();if(this.signal.aborted)throw new SourceError('CANCELLED');
    if(!WebTorrent.WEBRTC_SUPPORT)throw new SourceError('WEBRTC_UNSUPPORTED');
    try {
      const pc=this.ice=new RTCPeerConnection({iceServers:[]});pc.createDataChannel('local-diagnostic');
      pc.onicecandidate=e=>{if(e.candidate)this.stats.localICE++;};
      pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete'){this.stats.localICEComplete=true;this.change();pc.close();}};
      pc.setLocalDescription().catch(()=>{});
    }catch{/* WebTorrent records its own connection failure too. */}
    const client=this.client=new WebTorrent({tracker:{announce:TRACKERS},webSeeds:false,dht:false,lsd:false,utp:false,utPex:false,natUpnp:false,natPmp:false,
      maxConns:1,downloadLimit:262144,uploadLimit:16384});
    await new Promise((resolve,reject)=>{
      const stop=()=>reject(new SourceError(this.scope.timedOut?'CANDIDATE_TIME_LIMIT':'CANCELLED'));
      this.signal.addEventListener('abort',stop,{once:true});if(this.signal.aborted){stop();return;}
      this.removeAbort=()=>this.signal.removeEventListener('abort',stop);
      client.on('error',reject);
      const torrent=this.torrent=client.add(locator.metadata || locator.magnet,{announce:TRACKERS,urlList:[],deselect:true,
        store:SessionPieceStore,storeCacheSlots:1,storeOpts:{useMemory:true},destroyStoreOnDestroy:true});
      torrent.on('error',reject);torrent.on('warning',()=>{});
      torrent.on('trackerAnnounce',()=>{this.stats.trackerResponses++;this.change();});
      torrent.on('peer',peer=>{
        this.stats.peerCandidates++;this.change();
        if(peer?.on){peer.on('iceStateChange',(connection,gathering)=>{if(this.signal.aborted)return;if(connection==='failed')this.stats.iceFailures++;
          this.emit('WebRTC_ice_state',{connection,gathering});});
          peer.on('error',()=>{if(!this.signal.aborted){this.stats.iceFailures++;this.emit('WebRTC_peer_failure',{code:'RTC_PEER_ERROR'});}});}
      });
      torrent.on('wire',wire=>{
        if(wire.type!=='webrtc'){wire.destroy();reject(new SourceError('UNEXPECTED_TRANSPORT_BLOCKED'));return;}
        this.stats.connectedWires++;this.change();
        const request=wire.request.bind(wire);
        wire.request=(index,offset,length,callback)=>{
          try{this.budget.reserve(length);return request(index,offset,length,callback);}catch(e){wire.destroy();reject(e);callback?.(e);}
        };
        wire.on('download',n=>{try{this.stats.webrtcBytes+=n;this.budget.count('payloadBytes',n);}catch(e){wire.destroy();reject(e);}});
        if(wire.ut_metadata){
          const handshake=wire.ut_metadata.onExtendedHandshake.bind(wire.ut_metadata),message=wire.ut_metadata.onMessage.bind(wire.ut_metadata);
          wire.ut_metadata.onExtendedHandshake=h=>{if(h.metadata_size>this.limits.metadataBytes){wire.destroy();reject(new SourceError('METADATA_SIZE_LIMIT'));return;}handshake(h);};
          wire.ut_metadata.onMessage=bytes=>{try{this.metadataBytes(bytes.length);message(bytes);}catch(e){wire.destroy();reject(e);}};
        }
      });
      torrent.on('ready',async()=>{
        try{
          if(this.signal.aborted || torrent.destroyed)return;
          if(!meta){
            const bytes=new Uint8Array(torrent.torrentFile);meta=await parseMetadata(bytes,c.torrent.infoHash,{maxBytes:this.limits.metadataBytes,maxFiles:this.limits.maxFiles});
            if(this.signal.aborted || torrent.destroyed)return;
            locator.meta=meta;locator.metadata=bytes;c.metadataProvenance={host:'WebRTC BEP9',dataMode:'live-metadata',checkedAt:now(),infoHash:meta.infoHash,bytes:bytes.length};
            this.metadataCache?.set(c.torrent.infoHash,{metadata:bytes,meta,provenance:c.metadataProvenance});
            c.states.B=meta.webseeds.length?'available-not-probed':'webseed-not-found';this.emit('metadata_verified',{...c.metadataProvenance,fileCount:meta.files.length});
          }
          const file=applyFile(c,meta,this.mappings,locator),piece=Math.floor(file.offset/meta.pieceLength);
          if(!this.onResolved(c))throw new SourceError('DUPLICATE_RESOLVED_FILE');
          const length=Math.min(meta.pieceLength,meta.length-piece*meta.pieceLength);
          if(length>this.budget.remaining())throw new SourceError('PAYLOAD_BUDGET');
          this.selectedPiece=piece;this.selectedPieceLength=length;torrent.select(piece,piece,10);this.change();
        }catch(e){reject(e);}
      });
      torrent.on('verified',piece=>{
        if(piece!==this.selectedPiece || this.signal.aborted)return;
        this.stats.verifiedBytes=this.selectedPieceLength;c.states.A='bytes-received';c.delivery.kind='webrtc';c.delivery.state='bytes-received';
        c.delivery.webrtc={trackerPeers:this.stats.peerCandidates,connectedPeers:this.stats.connectedWires,receivedBytes:this.stats.webrtcBytes};
        this.emit('bytes_verified',{transport:'A',piece,bytes:this.selectedPieceLength,fileIdx:c.torrent.fileIdx});resolve();
      });
    });
  }
  async direct() {
    const c=this.candidate;c.states.direct='checking';this.change();
    if(new URL(this.vault.get(c).direct).protocol!=='https:')throw new SourceError('DIRECT_INSECURE_HTTP');
    if(c.delivery.requiresHeaders.length)throw new SourceError('DIRECT_REQUIRES_HEADERS');
    if(c.delivery.kind==='dash')throw new SourceError('DASH_NATIVE_UNSUPPORTED');
    if(c.delivery.kind==='hls'){c.states.direct='HLS_REQUIRES_EXPLICIT_PLAY';return;}
    const size=Math.min(65536,this.budget.remaining());if(!size)throw new SourceError('PAYLOAD_BUDGET');this.budget.reserve(size);
    const {bytes,response}=await requestBytes(this.vault.get(c).direct,{signal:this.signal,max:size,range:true,headers:{Range:`bytes=0-${size-1}`},
      onBytes:n=>{this.stats.httpBytes+=n;this.budget.count('payloadBytes',n);}});
    if(/text\/html|application\/json/i.test(response.headers.get('content-type') || '') || /^\s*</.test(new TextDecoder().decode(bytes.subarray(0,50))))throw new SourceError('DIRECT_NOT_MEDIA');
    c.states.direct='bytes-received';c.delivery.state='bytes-received';c.delivery.cors='readable';c.delivery.range='206-observed';
    this.emit('bytes_received',{transport:'direct',bytes:bytes.length,hashVerified:false});
  }
  async close() {
    this.removeAbort?.();this.scope.close();this.ice?.close();
    const client=this.client;this.client=null;
    if(client && !client.destroyed)await new Promise(resolve=>{const timer=setTimeout(resolve,8000);client.destroy(()=>{clearTimeout(timer);resolve();});});
  }
}
