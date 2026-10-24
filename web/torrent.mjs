import {TRACKERS} from './torrent-materials.js';
import {safeDiagnostic} from './collector.mjs';
import {SessionPieceStore} from './piece-store.mjs';
import {transportTimeout} from './transport-diagnostics.mjs';
import {requestBytes} from './source-utils.mjs';

let library;
export function loadWebTorrent() {
  if (!library) library = import('./vendor/webtorrent.min.js').then(module => module.default);
  return library;
}

async function streamingWorker() {
  if (!('serviceWorker' in navigator)) throw Error('service_worker_unavailable');
  const registration = await navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'});
  await registration.update();
  for (let attempt = 0; attempt < 12; attempt++) {
    if (registration.active && navigator.serviceWorker.controller) {
      const ready = await new Promise(resolve => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 500);
        channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data === 'KADR_STREAM_lift-3'); };
        registration.active.postMessage({type:'KADR_STREAM_PING'}, [channel.port2]);
      });
      if (ready) return registration;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('streaming_worker_update_pending_reload_page');
}

export class TorrentSession {
  constructor({video, material, mode, onEvent, onStats, onError, downloadLimit = 524288, timeoutMs = 45000}) {
    Object.assign(this, {video, material, mode, onEvent, onStats, onError, downloadLimit, timeoutMs});
    this.active = true; this.started = performance.now(); this.client = null; this.torrent = null;
    this.streamSession = crypto.randomUUID();
    this.handlers = []; this.bytes = {webrtc:0, http:0, unknown:0}; this.lastSnapshot = 0;
    this.state = {metadataReady:false, metadataSource:material.metadataBuffer?(material.metadataSource || 'Reused hash-verified metadata; no new network request'):'HTTPS .torrent (not media)', webRTCBytes:0, httpBytes:0,
      unknownBytes:0, peersWebRTC:0, webSeedConnections:0, uniqueFileBytes:0, fileSize:material.size,
      actualTransport:'none', playbackBeforeFull:null, firstPlayingMs:null, mode};
    this.state.trackerAnnounces=0;this.state.peersDiscovered=0;this.state.nativeIceCandidates=0;this.state.iceFailures=0;this.state.steps={library:'waiting',worker:'waiting',metadata:'waiting',signal:'waiting',rtc:'waiting',payload:'waiting',stream:'waiting'};
  }
  emit(kind, data = {}) { if (this.active) this.onEvent(kind, data); }
  error(error) { if (this.active) this.onError(safeDiagnostic(error?.message || String(error))); }
  stage(name,value){if(!this.active)return;this.state.steps={...this.state.steps,[name]:value};this.emit('torrent_stage',{stage:name,state:value,ms:Math.round(performance.now()-this.started)});this.onStats({...this.state});}
  async timeout(){
    if(!this.active || this.bytes.webrtc || this.bytes.http)return;
    const failure=transportTimeout(this.state,this.mode==='wt-http');this.state.failureCode=failure.code;this.state.timedOut=true;
    this.snapshot();this.emit('transport_timeout',{...failure,timeoutMs:this.timeoutMs});this.error(Error(`${failure.code}: ${failure.label}. Соединения закрываются. Повтор — кнопкой подготовки.`));
    await this.stop().catch(()=>{});
  }
  probeLocalICE(){
    if(typeof RTCPeerConnection!=='function')return;
    try{
      const pc=this.iceProbe=new RTCPeerConnection({iceServers:[]});pc.createDataChannel('local-diagnostic');
      pc.addEventListener('icecandidate',e=>{if(this.active && e.candidate)this.state.nativeIceCandidates++;});
      pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete' && this.active){this.state.nativeIceComplete=true;this.emit('local_ice_probe',{gathering:'complete',candidateCount:this.state.nativeIceCandidates,scope:'local candidates only; not a torrent connection or seed count'});this.snapshot();pc.close();}});
      pc.setLocalDescription().catch(e=>this.emit('local_ice_probe_error',{reason:safeDiagnostic(e.name)}));
    }catch(e){this.emit('local_ice_probe_error',{reason:safeDiagnostic(e.name)});}
  }
  async start() {
    this.timeoutTimer=setTimeout(()=>this.timeout(),this.timeoutMs);
    this.timer=setInterval(()=>this.snapshot(),1000);
    this.stage('library','loading');
    const WebTorrent = await loadWebTorrent();
    this.stage('library','ready');
    if (!this.active) return;
    if (this.mode === 'wt-webrtc' && !WebTorrent.WEBRTC_SUPPORT) throw Error('webrtc_not_supported');
    this.stage('worker','loading');
    const registration = await streamingWorker();
    this.stage('worker','ready');
    if (!this.active) return;
    const httpOnly = this.mode === 'wt-http';
    this.stage('signal',httpOnly?'disabled':'starting');
    this.stage('rtc',httpOnly?'disabled':'waiting');
    if(!httpOnly)this.probeLocalICE();
    this.client = new WebTorrent({tracker:httpOnly ? false : {announce:TRACKERS}, webSeeds:httpOnly,
      dht:false, lsd:false, utp:false, utPex:false, natUpnp:false, natPmp:false,
      downloadLimit:this.downloadLimit, uploadLimit:65536, maxConns:8});
    this.client.on('error', e => this.error(e));
    this.client.on('warning', e => this.emit('torrent_warning', {reason:safeDiagnostic(e.message)}));
    this.server = this.client.createServer({controller:registration});
    const onRequest = this.server.onRequest.bind(this.server);
    this.server.onRequest = (request, respond) => {
      // The upstream worker broadcasts to all tabs. Only this run may answer its URL.
      if (new URL(request.url, location.href).searchParams.get('kadr_session') !== this.streamSession) return;
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers?.range || '');
      if (range && this.file && this.active) {
        const start = Number(range[1]), end = range[2] ? Number(range[2]) : this.file.length - 1;
        const pieceIndex = Math.floor((this.file.offset + start) / this.torrent.pieceLength);
        const piece = this.torrent.pieces[pieceIndex];
        const verified = this.torrent.bitfield.get(pieceIndex);
        const empty = !verified && !!piece && piece.missing === piece.length;
        this.emit('media_range_request', {startByte:start, endByte:end, firstPieceVerified:verified,
          firstPieceHadNoBytes:empty, afterSeek:!!this.pendingSeek && performance.now()-this.pendingSeek.at<10000,
          ...(this.pendingSeek ? {seekTargetTime:this.pendingSeek.time} : {})});
      }
      onRequest(request, respond);
    };
    this.emit(this.material.metadataBuffer?'torrent_metadata_reused':'torrent_metadata_requested', {materialId:this.material.id, metadataSource:this.state.metadataSource, transportPolicy:httpOnly?'HTTP only; tracker disabled':'WebRTC only; webSeeds disabled', downloadLimit:this.downloadLimit});
    this.stage('metadata','loading');this.metadataAbort=new AbortController();
    const metadata = this.material.metadataBuffer || (await requestBytes(this.material.metadata,
      {signal:this.metadataAbort.signal,ms:this.timeoutMs,max:1048576})).bytes;
    if (!this.active) return;
    if(metadata.byteLength>1048576)throw Error('torrent_metadata_too_large');
    this.emit('torrent_metadata_bytes', {bytes:metadata.byteLength, networkBytes:this.material.metadataBuffer?0:metadata.byteLength, source:this.state.metadataSource});
    this.torrent = this.client.add(metadata, {announce:httpOnly?[]:TRACKERS,deselect:true,
      urlList:httpOnly && this.material.webseed?[this.material.webseed]:[], maxWebConns:2,
      store:SessionPieceStore, storeCacheSlots:4, storeOpts:{onMode:mode=>{this.state.storageMode=mode;this.emit('piece_storage_mode',{mode});}}, destroyStoreOnDestroy:true});
    const torrent = this.torrent;
    torrent.on('error', e => this.error(e));
    torrent.on('warning', e => this.emit('torrent_warning', {reason:safeDiagnostic(e.message)}));
    torrent.on('trackerAnnounce', () => {this.state.trackerAnnounces++;this.stage('signal','response');this.emit('torrent_tracker_announce',{count:this.state.trackerAnnounces});});
    torrent.on('peer', peer => {
      if(httpOnly)return; // A webseed is not a discovered WebRTC candidate.
      this.state.peersDiscovered++;this.emit('torrent_peer_discovered',{count:this.state.peersDiscovered});
      if(typeof peer==='object' && peer?.on){
        peer.on('iceStateChange',(connection,gathering)=>{if(!this.active)return;if(connection==='failed')this.state.iceFailures++;this.emit('torrent_ice_state',{connection,gathering});});
        peer.on('error',error=>{if(!this.active)return;this.state.iceFailures++;this.emit('torrent_peer_error',{code:safeDiagnostic(error.code || 'RTC_ERROR'),reason:safeDiagnostic(error.message)});});
        peer.on('connect',()=>{this.stage('rtc','datachannel-connected');});
      }
    });
    torrent.on('wire', wire => {
      const type = wire.type === 'webSeed' ? 'http' : wire.type === 'webrtc' ? 'webrtc' : 'unknown';
      this.emit('torrent_wire', {transport:type});if(type==='webrtc')this.stage('rtc','bittorrent-wire');
      if ((httpOnly && type !== 'http') || (!httpOnly && type !== 'webrtc')) {
        wire.destroy(); this.error(Error('unexpected_transport_blocked')); return;
      }
      wire.on('download', bytes => {
        if (this.active && Number.isFinite(bytes) && bytes > 0) {const first=!this.bytes[type];this.bytes[type]+=bytes;if(first){this.stage('payload',type);clearTimeout(this.timeoutTimer);}}
      });
    });
    torrent.on('ready', () => {
      if (!this.active) return;
      if (torrent.infoHash !== this.material.infoHash) { this.error(Error('torrent_identity_mismatch')); this.stop(); return; }
      this.file = Number.isInteger(this.material.fileIdx)?torrent.files[this.material.fileIdx]:torrent.files.find(file => file.name === this.material.filename && file.length === this.material.size);
      if(this.file && (this.file.length!==this.material.size || (this.material.filePath && this.file.path!==this.material.filePath)))this.file=null;
      if (!this.file) { this.error(Error('torrent_file_identity_mismatch')); this.stop(); return; }
      // No whole-file Blob. Only the HTML media element's byte-range streams select pieces.
      torrent.deselect(0, torrent.pieces.length - 1, 0);
      this.state.metadataReady = true;this.stage('metadata','ready'); this.state.metadataAt = new Date().toISOString();
      this.state.preexistingBytesAtReady = this.file.downloaded;
      this.emit('torrent_metadata_ready', {infoHash:torrent.infoHash, fileSize:this.file.length, torrentSize:torrent.length,
        container:this.material.container, codecs:this.material.codecs, fileCount:torrent.files.length});
      this.bindVideo();
      // A fresh local URL also isolates the browser's media cache across runs.
      // This is our own SW route, never a provider/signed URL.
      this.video.src = this.file.streamURL + '?kadr_session=' + this.streamSession;
      this.stage('stream','attached');
      this.emit('torrent_stream_attached', {method:'file.streamURL via browser service worker Range; fresh session URL; no Blob preload'});
      this.snapshot();
    });
  }
  snapshot() {
    if (!this.active) return;
    if(!this.torrent){this.onStats({...this.state});return;}
    const wires = this.torrent.wires;
    Object.assign(this.state, {webRTCBytes:this.bytes.webrtc, httpBytes:this.bytes.http, unknownBytes:this.bytes.unknown,
      peersWebRTC:wires.filter(w=>w.type==='webrtc').length, webSeedConnections:wires.filter(w=>w.type==='webSeed').length,
      uniqueFileBytes:this.file?.downloaded || 0, torrentBytes:this.torrent.downloaded,
      actualTransport:this.bytes.webrtc && this.bytes.http ? 'mixed' : this.bytes.webrtc ? 'WebRTC' : this.bytes.http ? 'HTTP webseed' : 'none'});
    this.onStats({...this.state});
    if (performance.now() - this.lastSnapshot > 5000) { this.lastSnapshot = performance.now(); this.emit('torrent_snapshot', {...this.state}); }
  }
  bindVideo() {
    for (const type of ['loadedmetadata','playing','pause','timeupdate','waiting','stalled','seeking','seeked','ended','error','resize']) {
      const handler = event => {
        if (!this.active) return;
        if(type==='timeupdate') {
          if(performance.now()-(this.lastTimeUpdateAt || 0)<900)return;
          this.lastTimeUpdateAt=performance.now();
        }
        const data = {event:type, trusted:event.isTrusted, time:Number.isFinite(this.video.currentTime)?this.video.currentTime:null,
          duration:Number.isFinite(this.video.duration)?this.video.duration:null,
          readyState:this.video.readyState,videoWidth:this.video.videoWidth,videoHeight:this.video.videoHeight, downloaded:this.file.downloaded, fileSize:this.file.length};
        Object.assign(this.state,{videoWidth:this.video.videoWidth,videoHeight:this.video.videoHeight,
          audioTracksExposed:this.video.audioTracks?.length ?? null});
        if(type==='loadedmetadata')this.stage('stream','loadedmetadata');
        if(type==='playing')this.stage('stream','playing');
        if(type==='error')this.stage('stream','media-error');
        if (type === 'playing' && this.state.firstPlayingMs === null) {
          this.state.firstPlayingMs = Math.round(performance.now() - this.started);
          this.state.playbackBeforeFull = this.file.downloaded < this.file.length;
          data.startMs = this.state.firstPlayingMs; data.beforeFull = this.state.playbackBeforeFull;
        }
        if (type === 'seeking') {
          this.pendingSeek = {time:data.time, at:performance.now()};
          const ranges = this.video.buffered;
          let buffered = false;
          for (let i=0;i<ranges.length;i++) if (data.time>=ranges.start(i) && data.time<=ranges.end(i)) buffered=true;
          // This is a buffer observation, not a byte-to-time proof for variable bitrate media.
          data.targetInMediaBuffer = buffered; data.incompleteFile = this.file.downloaded < this.file.length;
        }
        if (type === 'error') data.mediaErrorCode = this.video.error?.code || 0;
        this.emit('native_video', data); this.snapshot();
      };
      this.video.addEventListener(type, handler); this.handlers.push([type, handler]);
    }
  }
  restore(time) {
    if (!this.active || !Number.isFinite(time) || time < 0 || !Number.isFinite(this.video.duration) || time > this.video.duration) return false;
    this.emit('native_restore_requested', {time}); this.video.currentTime = time; return true;
  }
  async stop() {
    if (!this.active && !this.client) return;
    this.active = false;clearTimeout(this.timeoutTimer);this.metadataAbort?.abort();this.iceProbe?.close();clearInterval(this.timer); clearTimeout(this.noPeerTimer);
    for (const [type, handler] of this.handlers) this.video.removeEventListener(type, handler);
    this.handlers = []; this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    const client = this.client; this.client = null;
    if (client && !client.destroyed) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('torrent_destroy_timeout')), 8000);
      client.destroy(error => {clearTimeout(timer); error ? reject(error) : resolve();});
    });
  }
}

export async function startDeveloperSeeder(material, onStatus, onDiagnostic=()=>{}) {
  const WebTorrent = await loadWebTorrent();
  const response = await fetch(material.seedFile, {cache:'no-store'});
  if (!response.ok) throw Error('seed_fixture_unavailable');
  // Full File belongs only to this explicitly labelled temporary seeder, never the viewer.
  const file = new File([await response.arrayBuffer()], material.filename, {type:'video/mp4'});
  const client = new WebTorrent({webSeeds:false, dht:false, lsd:false, utp:false, utPex:false, maxConns:6});
  client.on('error', e => onStatus('Ошибка сидера: '+safeDiagnostic(e.message)));
  client.on('warning', e => onStatus('Сигнализация сидера: '+safeDiagnostic(e.message)));
  client.seed(file, {name:material.filename, pieceLength:32768, announce:TRACKERS, urlList:[],
    store:SessionPieceStore, storeCacheSlots:4, destroyStoreOnDestroy:true}, torrent => {
    if (torrent.infoHash !== material.infoHash) {onStatus('ID раздачи не совпал; сидер остановлен.');client.destroy();return;}
    onDiagnostic({kind:'seed_ready',infoHash:torrent.infoHash});
    onStatus('Временный браузерный сидер готов. Вкладка должна оставаться открытой; это зависимость контролируемой пробы.');
    torrent.on('trackerAnnounce',()=>onDiagnostic({kind:'seed_tracker_response'}));
    torrent.on('peer',peer=>{onDiagnostic({kind:'seed_peer_candidate'});if(peer?.on){peer.on('iceStateChange',(connection,gathering)=>onDiagnostic({kind:'seed_ice',connection,gathering}));peer.on('error',e=>onDiagnostic({kind:'seed_peer_error',code:safeDiagnostic(e.code || 'RTC_ERROR')}));}});
    torrent.on('wire', wire => {
      if(wire.type!=='webrtc'){wire.destroy();onDiagnostic({kind:'seed_transport_blocked'});return;}
      onDiagnostic({kind:'seed_wire',transport:wire.type});
      wire.on('upload',bytes=>onDiagnostic({kind:'seed_payload_sent',bytes}));
      onStatus('WebRTC-пир подключился к временному браузерному сидеру.');
    });
  });
  return client;
}
