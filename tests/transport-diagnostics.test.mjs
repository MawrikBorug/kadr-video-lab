import test from 'node:test';import assert from 'node:assert/strict';
import {transportTimeout} from '../web/transport-diagnostics.mjs';import {sanitize,savedPosition} from '../web/collector.mjs';
test('timeout separates missing stages, local ICE policy symptoms, signal failure, absent candidates and absent payload',()=>{
 const ready={steps:{library:'ready',worker:'ready'},metadataReady:true,trackerAnnounces:2,peersDiscovered:1,peersWebRTC:0};
 assert.equal(transportTimeout({}).code,'LIBRARY_NOT_READY');
 assert.equal(transportTimeout({steps:{library:'ready'}}).code,'WORKER_NOT_READY');
 assert.equal(transportTimeout({...ready,metadataReady:false}).code,'METADATA_NOT_READY');
 assert.equal(transportTimeout({...ready,nativeIceComplete:true,nativeIceCandidates:0}).code,'LOCAL_ICE_NO_CANDIDATES');
 assert.equal(transportTimeout({...ready,iceFailures:1}).code,'ICE_OR_RTC_FAILED');
 assert.equal(transportTimeout({...ready,trackerAnnounces:0}).code,'NO_TRACKER_RESPONSE');
 assert.equal(transportTimeout({...ready,peersDiscovered:0}).code,'NO_COMPATIBLE_PEER_OBSERVED');
 assert.equal(transportTimeout(ready).code,'RTC_NOT_CONNECTED');
 assert.equal(transportTimeout({...ready,peersWebRTC:1}).code,'RTC_NO_PAYLOAD');
 assert.equal(transportTimeout({...ready,webSeedConnections:1},true).code,'WEBSEED_NO_PAYLOAD');
});
test('only native playlist bridge events and bounded numeric episode identifiers are retained',()=>{
 assert.deepEqual(sanitize('playlist hooked'),{event:'playlist hooked'});
 assert.deepEqual(sanitize({event:'changeEpisode',season:'2',episode:'3',id:123,url:'https://private.invalid/?token=PRIVATE_FIXTURE'}),{event:'changeEpisode',season:2,episode:3,id:123});
 assert.deepEqual(sanitize({event:'lastEpisode',season:'1',episode:'0'}),{event:'lastEpisode',season:1,episode:0});
 assert.equal(sanitize({event:'changeEpisode',season:'bad',episode:1}),null);
 assert.equal(sanitize('playlist go'),null);
 assert.equal(savedPosition({materialId:'big-buck-bunny',time:12,duration:634,utc:new Date().toISOString()}).materialId,'big-buck-bunny');
});
