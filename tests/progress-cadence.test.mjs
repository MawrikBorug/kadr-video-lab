// Source model from player-venom 0.3.6, not real Lift or phone events.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitize as oldSanitize} from './fixtures/pre-expansion-collector.mjs';
import {positionFor,scopeKey,makeRun,exportResult,OLD_LIFT_KEY,POSITION_KEY} from '../web/journal.mjs';

function trackerModel(initial = 0, interval = 9) {
  let last=initial,lastSeek=initial,lastEmit=initial,lastSaved=initial;
  const events=[],saved=[];
  return {events,saved,update(time){
    const n=Math.floor(time), distance=value=>Math.abs(n-value), delta=distance(last);
    if(!delta)return;last=n;
    if(delta>4){lastSeek=n;return;}
    if(distance(lastSeek)<60)return;
    if(distance(lastSaved)>10){lastSaved=n;saved.push(n);}
    if(distance(lastEmit)>interval){lastEmit=n;events.push(n);}
  }};
}
test('Lift source model: first progress at 60, then 10 media seconds; these are synthetic inputs',()=>{
  const model=trackerModel();for(let t=0;t<=151;t++)model.update(t);
  assert.deepEqual(model.events,[60,70,80,90,100,110,120,130,140,150]);
  for(const time of model.events)assert.deepEqual(oldSanitize({event:'viewProgress',time,duration:888}),{event:'viewProgress',time,duration:888});
});
test('reload within 60 seconds after provider restore can retain the same provider position',()=>{
  for(let session=0;session<6;session++){
    const model=trackerModel(60);for(let t=60;t<=119;t++)model.update(t);
    assert.deepEqual(model.events,[]);assert.deepEqual(model.saved,[]);
  }
  const continuous=trackerModel(60);for(let t=60;t<=130;t++)continuous.update(t);
  assert.deepEqual(continuous.events,[120,130]);
});
test('a seek or timeupdate gaps above four seconds restart the source suppression window',()=>{
  const model=trackerModel();for(let t=0;t<=70;t++)model.update(t);
  model.update(200);for(let t=201;t<=259;t++)model.update(t);
  assert.deepEqual(model.events,[60,70]);model.update(260);assert.deepEqual(model.events,[60,70,260]);
  const gaps=trackerModel();for(let t=0;t<180;t+=5)gaps.update(t);assert.deepEqual(gaps.events,[]);
});
test('legacy position is confined to Lift Sintel; connection, material and episode scopes differ',()=>{
  const original={connection:'lift',materialId:3637,season:null,episode:null};
  const journal={schema:3,runs:[],currentByMode:{},positions:{}};
  const old={time:60,duration:888,utc:'2026-10-22T05:00:00Z',runId:'126bdadb-c16f-4870-aa63-56a1743bd71a'};
  const values=new Map([[POSITION_KEY,JSON.stringify(old)],[OLD_LIFT_KEY,'keep old bytes']]);const storage={getItem:key=>values.get(key)??null};
  assert.equal(positionFor(journal,original,storage).time,60);
  for(const subject of [{...original,materialId:180},{...original,season:1,episode:1},{...original,connection:'wt-webrtc',materialId:'sintel-public'}])assert.equal(positionFor(journal,subject,storage),null);
  assert.notEqual(scopeKey({...original,season:1,episode:1}),scopeKey({...original,season:1,episode:2}));
  const run=makeRun('browser',{},original);journal.runs.push(run);exportResult(journal,run,{},old);
  assert.equal(values.get(OLD_LIFT_KEY),'keep old bytes');assert.equal(values.get(POSITION_KEY),JSON.stringify(old));
});
