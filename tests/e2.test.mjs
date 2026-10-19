import test from 'node:test';
import assert from 'node:assert/strict';
import { e1Candidates, e2PrerequisiteIssues, resultIssues, reconcileRecord, assessRecord, exportJSON, exportCSV, loadJournal, saveJournal } from '../web/core.js';
import { passedE1, completedE2 } from './fixtures.mjs';

test('audit #1: original E2 smoke / blank-ad exploit is rejected even with valid E1', () => {
  const e1=passedE1(), e2=completedE2(e1); e2.config.watchScope='smoke'; e2.checks.fullNoAds='NOT_RUN';
  for(const key of Object.keys(e2.ads))e2.ads[key]='NOT_RUN';
  assert.ok(resultIssues(e2,[e1,e2]).some(text=>text.includes('рекламные категории')));
  reconcileRecord(e2,[e1,e2]); assert.equal(e2.status,'INCONCLUSIVE'); assert.notEqual(e2.assessment.adFreeSessionStatus,'PASS'); assert.notEqual(e2.assessment.probeStatus,'PASS');
});
test('a completed smoke observation may pass its probe, never the full ad-free E2 verdict', () => {
  const e1=passedE1(), e2=completedE2(e1); e2.config.watchScope='smoke'; e2.details.watchMinutes='30'; e2.checks.fullNoAds='NOT_RUN';
  reconcileRecord(e2,[e1,e2]); assert.equal(e2.status,'INCONCLUSIVE'); assert.equal(e2.assessment.probeStatus,'PASS'); assert.equal(e2.assessment.adFreeSessionStatus,'INCONCLUSIVE');
  e2.details.watchMinutes='29.9'; assert.equal(assessRecord(e2,[e1,e2]).probeStatus,'INCONCLUSIVE');
});
test('full E2 needs all five decisive ad observations, ended video, closed session and manual claim', () => {
  const e1=passedE1(), good=completedE2(e1); assert.deepEqual(resultIssues(good,[e1,good]),[]); assert.equal(assessRecord(good,[e1,good]).adFreeSessionStatus,'PASS');
  const variants=[r=>r.endedAt=null,r=>r.checks.ended='NOT_RUN',r=>r.checks.fullNoAds='NOT_RUN',r=>r.config.watchScope='smoke',...Object.keys(good.ads).flatMap(key=>[r=>r.ads[key]='NOT_RUN',r=>r.ads[key]='INCONCLUSIVE'])];
  for(const change of variants){const r=completedE2(e1);change(r);reconcileRecord(r,[e1,r]);assert.equal(r.status,'INCONCLUSIVE');assert.notEqual(r.assessment.adFreeSessionStatus,'PASS');}
});
test('observed ads fail ad-free verdict while completed observations remain useful; tracking is separate', () => {
  const e1=passedE1(), e2=completedE2(e1); e2.ads.midRoll='OBSERVED'; reconcileRecord(e2,[e1,e2]);
  assert.equal(e2.status,'INCONCLUSIVE'); assert.equal(e2.assessment.probeStatus,'PASS'); assert.equal(e2.assessment.adFreeSessionStatus,'FAIL');
  const clean=completedE2(e1); clean.tracking='OBSERVED'; assert.equal(assessRecord(clean,[e1,clean]).adFreeSessionStatus,'PASS');
  clean.checks.pause='FAIL'; assert.equal(assessRecord(clean,[e1,clean]).adFreeSessionStatus,'PASS'); assert.equal(assessRecord(clean,[e1,clean]).probeStatus,'FAIL'); assert.ok(resultIssues(clean,[e1,clean]).length);
});
test('audit #2: E2 references only a previous completed valid E1 for the same work, not the same network', () => {
  const e1=passedE1(), e2=completedE2(e1); assert.equal(e1.environment.network,'home'); assert.equal(e2.environment.network,'mobile'); assert.deepEqual(e2PrerequisiteIssues(e2,[e1,e2]),[]);
  assert.ok(e2PrerequisiteIssues({...e2,config:{...e2.config,e1RecordId:null}},[e1]).length);
  assert.ok(e2PrerequisiteIssues(e2,[]).length);
  for(const change of [r=>r.status='FAIL',r=>r.endedAt=null,r=>r.endedAt='2026-10-18T00:00:00Z',r=>r.config.provider='aniliberty',r=>r.config.id='933260',r=>r.details.startSeconds='31',r=>r.checks.fiveMinutes='NOT_RUN']){
    const invalid=passedE1();change(invalid);assert.ok(e2PrerequisiteIssues(e2,[invalid]).length);
  }
  const episodeE1=passedE1();Object.assign(episodeE1.config,{type:'tv',id:'106379',season:'1',episode:'1'});const episodeE2=completedE2(episodeE1);
  assert.equal(e1Candidates(episodeE2.config,[episodeE1]).length,1);
  for(const key of ['season','episode']){const config={...episodeE2.config,[key]:'2'};assert.equal(e1Candidates(config,[episodeE1]).length,0);}
});
test('legacy false E2 PASS is downgraded on load, save and JSON/CSV export, preserving notes and reasons', () => {
  const e2=completedE2();delete e2.config.e1RecordId;delete e2.details.watchMinutes;e2.details.notes='Original manual note';
  const raw=JSON.stringify({schemaVersion:1,records:[e2]});const storage={getItem:()=>raw};const loaded=loadJournal(storage);
  assert.equal(loaded.error,null);assert.equal(loaded.records[0].status,'INCONCLUSIVE');assert.equal(loaded.records[0].details.notes,'Original manual note');assert.ok(loaded.records[0].assessment.eligibilityIssues[0].includes('E1 не подтверждён'));
  const exported=JSON.parse(exportJSON([e2])).records[0];assert.equal(exported.status,'INCONCLUSIVE');assert.equal(exported.assessment.statusMeaning,'E2_FULL_SESSION_AD_FREE_AND_BASIC_CONTROL');assert.ok(exported.assessment.eligibilityIssues.length);
  assert.equal(e2.status,'PASS'); // Export validation does not mutate the original evidence.
  let saved;assert.equal(saveJournal({setItem:(_key,value)=>{saved=JSON.parse(value);}},[e2]),null);assert.equal(saved.records[0].status,'INCONCLUSIVE');
  const csv=exportCSV([e2]);for(const column of ['statusMeaning','probeStatus','adFreeSessionStatus','e1RecordId','eligibilityIssues'])assert.ok(csv.includes(`"${column}"`));assert.ok(csv.includes('E1 не подтверждён'));
});
test('JSON export preserves traceable valid E1 and disambiguates each E2 verdict', () => {
  const e1=passedE1(),e2=completedE2(e1);const exported=JSON.parse(exportJSON([e1,e2]));assert.equal(exported.assessmentVersion,2);
  assert.equal(exported.records[1].assessment.e1RecordId,e1.id);assert.equal(exported.records[1].status,'PASS');assert.equal(exported.records[1].assessment.adFreeScope,'SINGLE_SESSION_MANUAL_OBSERVATION');
  assert.equal(JSON.parse(exportJSON([e2])).records[0].status,'INCONCLUSIVE');
});
test('unconfirmed source cannot pass either E2 assessment through manual marks', () => {
  const e1=passedE1(),e2=completedE2(e1);e2.technical.blocked='unconfirmed-contract';reconcileRecord(e2,[e1,e2]);
  assert.equal(e2.status,'INCONCLUSIVE');assert.equal(e2.assessment.probeStatus,'INCONCLUSIVE');assert.notEqual(e2.assessment.adFreeSessionStatus,'PASS');
});
