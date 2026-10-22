import {TRACKERS} from './torrent-materials.js';
import {safeDiagnostic} from './collector.mjs';
import {SessionPieceStore} from './piece-store.mjs';

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
        channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data === 'KADR_STREAM_lift-2'); };
        registration.active.postMessage({type:'KADR_STREAM_PING'}, [channel.port2]);
      });
      if (ready) return registration;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('streaming_worker_update_pending_reload_page');
}

export class TorrentSession {
  constructor({video, material, mode, onEvent, onStats, onError, downloadLimit = 524288}) {
    Object.assign(this, {video, material, mode, onEvent, onStats, onError, downloadLimit});
    this.active = true; this.started = performance.now(); this.client = null; this.torrent = null;
    this.streamSession = crypto.randomUUID();
    this.handlers = []; this.bytes = {webrtc:0, http:0, unknown:0}; this.lastSnapshot = 0;
    this.state = {metadataReady:false, metadataSource:'HTTPS .torrent (not media)', webRTCBytes:0, httpBytes:0,
      unknownBytes:0, peersWebRTC:0, webSeedConnections:0, uniqueFileBytes:0, fileSize:material.size,
      actualTransport:'none', playbackBeforeFull:null, firstPlayingMs:null, mode};
    this.state.trackerAnnounces=0;this.state.peersDiscovered=0;
  }
  emit(kind, data = {}) { if (this.active) this.onEvent(kind, data); }
  error(error) { if (this.active) this.onError(safeDiagnostic(error?.message || String(error))); }
  async start() {
    const WebTorrent = await loadWebTorrent();
    if (!this.active) return;
    if (this.mode === 'wt-webrtc' && !WebTorrent.WEBRTC_SUPPORT) throw Error('webrtc_not_supported');
    const registration = await streamingWorker();
    if (!this.active) return;
    const httpOnly = this.mode === 'wt-http';
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
    this.emit('torrent_metadata_requested', {materialId:this.material.id, transportPolicy:httpOnly?'HTTP only; tracker disabled':'WebRTC only; webSeeds disabled', downloadLimit:this.downloadLimit});
    const response = await fetch(this.material.metadata, {cache:'no-store', credentials:'omit'});
    if (!response.ok) throw Error('torrent_metadata_http_' + response.status);
    const metadata = new Uint8Array(await response.arrayBuffer());
    if (!this.active) return;
    this.emit('torrent_metadata_bytes', {bytes:metadata.byteLength, source:'HTTPS metadata, not media'});
    this.torrent = this.client.add(metadata, {announce:httpOnly?[]:TRACKERS,
      urlList:httpOnly && this.material.webseed?[this.material.webseed]:[], maxWebConns:2,
      store:SessionPieceStore, storeCacheSlots:4, storeOpts:{onMode:mode=>{this.state.storageMode=mode;this.emit('piece_storage_mode',{mode});}}, destroyStoreOnDestroy:true});
    const torrent = this.torrent;
    torrent.on('error', e => this.error(e));
    torrent.on('warning', e => this.emit('torrent_warning', {reason:safeDiagnostic(e.message)}));
    torrent.on('trackerAnnounce', () => {this.state.trackerAnnounces++;this.emit('torrent_tracker_announce',{count:this.state.trackerAnnounces});});
    torrent.on('peer', () => {this.state.peersDiscovered++;this.emit('torrent_peer_discovered',{count:this.state.peersDiscovered});});
    torrent.on('wire', wire => {
      const type = wire.type === 'webSeed' ? 'http' : wire.type === 'webrtc' ? 'webrtc' : 'unknown';
      this.emit('torrent_wire', {transport:type});
      if ((httpOnly && type !== 'http') || (!httpOnly && type !== 'webrtc')) {
        wire.destroy(); this.error(Error('unexpected_transport_blocked')); return;
      }
      wire.on('download', bytes => {
        if (this.active && Number.isFinite(bytes) && bytes >= 0) this.bytes[type] += bytes;
      });
    });
    torrent.on('ready', () => {
      if (!this.active) return;
      if (torrent.infoHash !== this.material.infoHash) { this.error(Error('torrent_identity_mismatch')); this.stop(); return; }
      this.file = torrent.files.find(file => file.name === this.material.filename && file.length === this.material.size);
      if (!this.file) { this.error(Error('torrent_file_identity_mismatch')); this.stop(); return; }
      // No whole-file Blob. Only the HTML media element's byte-range streams select pieces.
      torrent.deselect(0, torrent.pieces.length - 1, 0);
      this.state.metadataReady = true; this.state.metadataAt = new Date().toISOString();
      this.state.preexistingBytesAtReady = this.file.downloaded;
      this.emit('torrent_metadata_ready', {infoHash:torrent.infoHash, fileSize:this.file.length, torrentSize:torrent.length,
        container:this.material.container, codecs:this.material.codecs, fileCount:torrent.files.length});
      this.bindVideo();
      // A fresh local URL also isolates the browser's media cache across runs.
      // This is our own SW route, never a provider/signed URL.
      this.video.src = this.file.streamURL + '?kadr_session=' + this.streamSession;
      this.emit('torrent_stream_attached', {method:'file.streamURL via browser service worker Range; fresh session URL; no Blob preload'});
      this.snapshot(); this.timer = setInterval(() => this.snapshot(), 1000);
      this.noPeerTimer = setTimeout(() => {
        if (this.active && !this.bytes.webrtc && !httpOnly) this.emit('torrent_no_media_yet', {reason:'No WebRTC payload in 25 seconds; an active compatible seeder is required. No HTTP fallback.'});
      }, 25000);
    });
  }
  snapshot() {
    if (!this.active || !this.torrent) return;
    const wires = this.torrent.wires;
    Object.assign(this.state, {webRTCBytes:this.bytes.webrtc, httpBytes:this.bytes.http, unknownBytes:this.bytes.unknown,
      peersWebRTC:wires.filter(w=>w.type==='webrtc').length, webSeedConnections:wires.filter(w=>w.type==='webSeed').length,
      uniqueFileBytes:this.file?.downloaded || 0, torrentBytes:this.torrent.downloaded,
      actualTransport:this.bytes.webrtc && this.bytes.http ? 'mixed' : this.bytes.webrtc ? 'WebRTC' : this.bytes.http ? 'HTTP webseed' : 'none'});
    this.onStats({...this.state});
    if (performance.now() - this.lastSnapshot > 5000) { this.lastSnapshot = performance.now(); this.emit('torrent_snapshot', {...this.state}); }
  }
  bindVideo() {
    for (const type of ['loadedmetadata','playing','pause','timeupdate','waiting','stalled','seeking','seeked','ended','error']) {
      const handler = () => {
        if (!this.active) return;
        if(type==='timeupdate') {
          if(performance.now()-(this.lastTimeUpdateAt || 0)<900)return;
          this.lastTimeUpdateAt=performance.now();
        }
        const data = {event:type, time:Number.isFinite(this.video.currentTime)?this.video.currentTime:null,
          duration:Number.isFinite(this.video.duration)?this.video.duration:null,
          readyState:this.video.readyState, downloaded:this.file.downloaded, fileSize:this.file.length};
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
    this.active = false; clearInterval(this.timer); clearTimeout(this.noPeerTimer);
    for (const [type, handler] of this.handlers) this.video.removeEventListener(type, handler);
    this.handlers = []; this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    const client = this.client; this.client = null;
    if (client && !client.destroyed) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('torrent_destroy_timeout')), 8000);
      client.destroy(error => {clearTimeout(timer); error ? reject(error) : resolve();});
    });
  }
}

export async function startDeveloperSeeder(material, onStatus) {
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
    onStatus('Временный браузерный сидер готов. Вкладка должна оставаться открытой; это зависимость контролируемой пробы.');
    torrent.on('wire', () => onStatus('WebRTC-пир подключился к временному браузерному сидеру.'));
  });
  return client;
}
