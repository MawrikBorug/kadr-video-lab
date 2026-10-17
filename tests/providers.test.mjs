import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, selectEpisode, SANDBOX, PROVIDERS } from '../web/providers.js';
const yap = { provider:'yapgrid', namespace:'tmdb', id:'693134', type:'movie', season:'1', episode:'1', sandbox:'strict' };
test('YapGrid builds only documented TMDB movie / episode paths',()=>{
  assert.equal(buildRequest(yap).url,'https://yapgrid.com/embed/movie/693134');
  assert.equal(buildRequest({...yap,type:'tv',id:'106379',season:'1',episode:'2'}).url,'https://yapgrid.com/embed/tv/106379/1/2');
  assert.equal(buildRequest(yap).sandbox,SANDBOX.strict);
});
test('invalid IDs, IMDb substitution, script URLs and invented content types never build',()=>{
  for(const id of ['tt15239678','0','-1','1/../../evil','javascript:alert(1)','<script>'])assert.throws(()=>buildRequest({...yap,id}));
  assert.throws(()=>buildRequest({...yap,namespace:'imdb'})); assert.throws(()=>buildRequest({...yap,type:'anime'}));
  for(const episode of ['0','1.5','1/2','-1'])assert.throws(()=>buildRequest({...yap,type:'tv',episode}));
});
test('unconfirmed candidates have no executable endpoints',()=>{
  for(const provider of ['stellar','mapple','ezvidapi','unknown'])assert.throws(()=>buildRequest({...yap,provider}),/Источник не подтвердился/);
  assert.equal(Object.values(PROVIDERS).filter(p=>p.enabled).length,2);
});
test('sandbox comparison without isolation needs explicit acknowledgement',()=>{
  assert.throws(()=>buildRequest({...yap,sandbox:'documented'}));
  assert.throws(()=>buildRequest({...yap,sandbox:'documented',unrestrictedConsent:true}),/чистая тестовая сессия/);
  assert.equal(buildRequest({...yap,sandbox:'documented',unrestrictedConsent:true,cleanSessionConsent:true}).sandbox,null);
  assert.throws(()=>buildRequest({...yap,sandbox:'invented'}));
  assert.ok(!SANDBOX.strict.includes('allow-popups')); assert.ok(!SANDBOX.popups.includes('top-navigation'));
});
test('AniLiberty uses release ID / alias and exact ordinal; no TMDB or season conversion',()=>{
  const input={provider:'aniliberty',namespace:'aniliberty',type:'tv',id:'sousou-no-frieren',episode:'12.5',quality:'480'};
  assert.equal(buildRequest(input).url,'https://anilibria.top/api/v1/anime/releases/sousou-no-frieren');
  assert.throws(()=>buildRequest({...input,type:'movie'})); assert.throws(()=>buildRequest({...input,namespace:'tmdb'})); assert.throws(()=>buildRequest({...input,id:'https://evil.example'}));
});
test('HLS is used verbatim, preserving all advertising query flags',()=>{
  const raw='https://cache.libria.fun/video/episode.m3u8?isWithVideoAds=1&isWithVideoAdsAlways=1&countryIso=US';
  const release={name:{main:'Тест'},episodes:[{ordinal:1,hls_480:raw,duration:1200}]};
  assert.equal(selectEpisode(release,'1','480').url,raw);
  assert.throws(()=>selectEpisode(release,'2','480')); assert.throws(()=>selectEpisode(release,'1','720'));
  for(const url of ['http://cache.libria.fun/test','https://cache.libria.fun.evil/test','https://user:secret@cache.libria.fun/test','https://127.0.0.1/test','javascript:evil()'])assert.throws(()=>selectEpisode({name:{main:'x'},episodes:[{ordinal:1,hls_480:url}]},1,'480'));
});
