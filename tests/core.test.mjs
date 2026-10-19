import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, acceptPostMessage, appendEvent, exportJSON, exportCSV, csvCell, loadJournal, saveJournal, STORAGE_KEY, resultIssues } from '../web/core.js';

const record = () => makeRecord({ provider:'aniliberty', stage:'E1', watchScope:'full', title:'Тест, «кино»\nстрока', type:'tv', id:'9789' }, { country:'RU', network:'home', device:'iphone-safari' }, '2026-10-17T00:00:00Z', 'fixture');
// A synthetic protocol only for filter tests, NOT a claimed provider contract.
const parseFixture = data => Object.keys(data).every(key => ['type','currentTime','duration'].includes(key)) ? data : null;
const source = {};
const context = { expectedOrigin:'https://player.example', expectedSource:source, parse:parseFixture };
const event = data => ({ origin:'https://player.example', source, data });

test('postMessage: valid documented-parser output is projected to safe scalar fields', () => {
  assert.deepEqual(acceptPostMessage(event({ type:'playing', currentTime:1, duration:100 }), context), { type:'playing', currentTime:1, duration:100 });
});
test('postMessage: strict origin, scheme, port and source identity', () => {
  for (const origin of ['null','http://player.example','https://player.example.evil','https://player.example:444','https://other.example']) assert.equal(acceptPostMessage({ ...event({type:'play'}), origin }, context), null);
  assert.equal(acceptPostMessage({ ...event({type:'play'}), source:{} }, context), null);
  assert.equal(acceptPostMessage(event({type:'play'}), { ...context, expectedOrigin:'*' }), null);
  assert.equal(acceptPostMessage(event({type:'play'}), { ...context, expectedSource:null }), null);
});
test('postMessage: unknown provider contract rejects even correctly sourced messages', () => {
  assert.equal(acceptPostMessage(event({type:'playing'}), { ...context, parse:null }), null);
});
test('postMessage: malformed payloads, extra fields, strings and nonfinite time are rejected', () => {
  for (const payload of [null, [], '{"type":"play"}', {type:'unknown'}, {type:'play',url:'https://private.example'}, {type:'play',currentTime:-1}, {type:'play',duration:Infinity}, {type:'play',currentTime:'1'}, {type:'timeupdate',currentTime:20,duration:1}, {type:'play',payload:'x'.repeat(5000)}]) assert.equal(acceptPostMessage(event(payload), context), null);
  const circular={type:'play'}; circular.self=circular; assert.equal(acceptPostMessage(event(circular), context), null);
  assert.equal(acceptPostMessage(event({type:'play'}), { ...context, parse:()=>{throw new Error();} }), null);
});
test('new records keep every manual check and ad observation NOT_RUN', () => {
  const r=record(); assert.equal(r.status,'NOT_RUN');
  assert.ok([...Object.values(r.checks),...Object.values(r.ads),r.tracking].every(value=>value==='NOT_RUN'));
  appendEvent(r,{type:'playing',channel:'native'}); assert.equal(r.checks.videoStarted,'NOT_RUN'); assert.equal(r.checks.fullNoAds,'NOT_RUN');
});
test('event log excludes payloads, URLs and secrets; buffer has explicit loss counter', () => {
  const r=record(); appendEvent(r,{type:'play',origin:'https://cdn.example',currentTime:1.2345,duration:NaN,url:'https://cdn.example/?token=SECRET',payload:'SECRET'});
  assert.equal(r.events[0].currentTime,1.235); assert.ok(!JSON.stringify(r.events).includes('SECRET'));
  for(let i=0;i<500;i++) appendEvent(r,{type:'timeupdate'});
  assert.equal(r.events.length,400); assert.equal(r.droppedEvents,101);
});
test('JSON export round trips Cyrillic, quotes, newlines, observations and events', () => {
  const r=record(); r.ads.midRoll='OBSERVED'; r.tracking='INCONCLUSIVE'; appendEvent(r,{type:'seeked',currentTime:10});
  const data=JSON.parse(exportJSON([r],'2026-10-17T01:00:00Z'));
  assert.equal(data.schemaVersion,2); assert.equal(data.assessmentVersion,2); assert.deepEqual(data.records.map(({assessment,evidenceLevel,...raw})=>raw),[r]); assert.equal(data.exportedAt,'2026-10-17T01:00:00Z');
});
function parseCSV(text) {
  const rows=[]; let row=[], value='', quoted=false;
  for(let i=1;i<text.length;i++) { const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){value+='"';i++;} else quoted=!quoted; }
    else if(!quoted && c===','){row.push(value);value='';}
    else if(!quoted && c==='\r' && text[i+1]==='\n'){row.push(value);rows.push(row);row=[];value='';i++;}
    else value+=c;
  } return rows;
}
test('CSV RFC4180 round trip includes nested context, events, BOM and all observations', () => {
  const r=record(); r.details.notes='Строка 1\nСтрока "2", 3'; r.details.voice='Русский'; appendEvent(r,{type:'pause'});
  const csv=exportCSV([r]); assert.equal(csv[0],'\uFEFF'); const [headers,row]=parseCSV(csv); const out=Object.fromEntries(headers.map((key,i)=>[key,row[i]]));
  assert.equal(out.notes,r.details.notes); assert.deepEqual(JSON.parse(out.config),r.config); assert.deepEqual(JSON.parse(out.events),r.events); assert.equal(out['ad.preRoll'],'NOT_RUN'); assert.equal(out.tracking,'NOT_RUN');
});
test('CSV spreadsheet formula injection is neutralized without changing JSON', () => {
  for(const value of ['=HYPERLINK("bad")','+cmd','-cmd','@SUM(1)','  =2+2','\t=2+2','\rcmd']) assert.ok(csvCell(value).startsWith('"\''));
  const r=record(); r.details.notes='=1+1'; assert.equal(JSON.parse(exportJSON([r])).records[0].details.notes,'=1+1');
});
test('persistent journal round trip and quota failure preserve in-memory records', () => {
  const data=new Map(); const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const records=[record()]; assert.equal(saveJournal(storage,records),null); assert.deepEqual(loadJournal(storage).records.map(({assessment,...raw})=>raw),records);
  const failing={setItem:()=>{throw new Error('QuotaExceededError');}};
  assert.match(saveJournal(failing,records),/экспортируйте JSON/); assert.equal(JSON.parse(exportJSON(records)).records.length,1);
});
test('corrupt, unknown-version and invalid-observation storage is recoverable and not rewritten', () => {
  for(const raw of ['{broken',JSON.stringify({schemaVersion:99,records:[]}),JSON.stringify({schemaVersion:1,records:[{...record(),checks:{}}]})]) {
    let writes=0; const result=loadJournal({getItem:()=>raw,setItem:()=>writes++}); assert.ok(result.error); assert.equal(result.raw,raw); assert.equal(writes,0);
  }
  assert.ok(loadJournal(undefined).error);
});
test('fullNoAds cannot be consistent with ads, unknown observations or missing end', () => {
  const r=record(); r.checks.fullNoAds='PASS'; assert.ok(resultIssues(r).length);
  r.checks.ended='PASS'; r.endedAt='2026-10-17T01:00:00Z'; for(const key of ['pageOpened','exactTitle','videoStarted'])r.checks[key]='PASS'; for(const key of Object.keys(r.ads))r.ads[key]='NOT_OBSERVED'; assert.deepEqual(resultIssues(r),[]);
  r.ads.overlay='OBSERVED'; assert.ok(resultIssues(r).length);
});
test('E1 PASS requires measured time, exact title, 5 minutes, seek, language and real network', () => {
  const r=record(); r.status='PASS'; assert.ok(resultIssues(r).length);
  for(const key of ['pageOpened','exactTitle','videoStarted','fiveMinutes','seek50'])r.checks[key]='PASS';
  r.details.startSeconds='29'; r.details.seekRecoverySeconds='9'; r.details.voice='Русский, студия указана'; assert.deepEqual(resultIssues(r),[]);
  r.details.startSeconds='31'; assert.ok(resultIssues(r).length); r.details.startSeconds=''; assert.ok(resultIssues(r).length);
});
test('short probe cannot claim full ad-free playback and blocked contracts cannot pass', () => {
  const r=record(); r.config.watchScope='smoke'; r.checks.fullNoAds='PASS'; r.checks.ended='PASS'; for(const key of Object.keys(r.ads))r.ads[key]='NOT_OBSERVED';
  assert.ok(resultIssues(r).some(text=>text.includes('режима полного просмотра')));
  r.status='PASS'; r.technical.blocked='unconfirmed-contract'; assert.ok(resultIssues(r).some(text=>text.includes('Неподтверждённый контракт')));
});
