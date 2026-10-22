import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitize, accept, progress, savedPosition, safeDiagnostic} from '../web/collector.mjs';
import {extractEmbed, getFreshEmbed} from '../web/lift-api.mjs';
import {append, makeRun, MAX_EVENTS, readJournal} from '../web/journal.mjs';
import {redactLegacy} from '../web/legacy.mjs';

test('only expected source and exact HTTPS origin are accepted', () => {
  const source = {}, e = {source, origin: 'https://embed.liftw.ws'};
  assert.ok(accept(e, source, e.origin));
  for (const candidate of ['https://embed.liftw.ws.evil.test', 'null', '', 'http://embed.liftw.ws']) assert.ok(!accept({...e, origin: candidate}, source, e.origin));
  assert.ok(!accept(e, {}, e.origin)); assert.ok(!accept(e, null, e.origin));
});
test('collector retains only documented fixed fields and bounded numeric progress', () => {
  assert.deepEqual(sanitize({event: 'viewProgress', time: 12, duration: 800, id: 'PRIVATE_FIXTURE', nested: {token:'PRIVATE_FIXTURE'}, url:'//private.test/?s=PRIVATE_FIXTURE'}), {event: 'viewProgress', time: 12, duration: 800});
  for (const data of [null, [], 'viewProgress', {event: 'pause'}, {event:'viewProgress', time:'12', duration:50}, {event:'viewProgress', time:Infinity, duration:50}, {event:'viewProgress', time:-1, duration:50}, {event:'viewProgress', time:60, duration:50}, {event:'viewProgress', time:0, duration:1e9}]) assert.equal(sanitize(data), null);
  assert.deepEqual(sanitize('pong'), {event:'pong'});
  assert.deepEqual(sanitize({event:'endedSoon', time:9}), {event:'endedSoon'});
  assert.notDeepEqual(sanitize({event:'endedSoon'}), sanitize({event:'ended'}));
  assert.equal(progress({event:'viewProgress', time:5, duration:0}), null);
  assert.equal(savedPosition({time:'5', duration:50, utc:new Date().toISOString()}), null);
});
test('native URL is validated but never rewritten', () => {
  const url = 'https://embed.liftw.ws/embed/movie/3637?fixture=PRIVATE_FIXTURE&order=2%20x';
  const data = {id:3637, origin_name:'Sintel', year:2010, iframe_uri:url};
  assert.equal(extractEmbed(data), url);
  for (const iframe_uri of ['https://other.test/embed/movie/3637', 'javascript:alert(1)', 'https://embed.liftw.ws/embed/movie/9', 'https://user:pass@embed.liftw.ws/embed/movie/3637']) assert.throws(() => extractEmbed({...data, iframe_uri}));
  assert.throws(() => extractEmbed({...data, id:9}));
});
test('browser fetch uses public CORS without credentials or storage; provider errors are safe', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, 'https://api.liftw.ws/info/3637'); assert.equal(opts.cache, 'no-store'); assert.equal(opts.credentials, 'omit'); assert.equal(opts.mode, 'cors');
      return new Response(JSON.stringify({error:'Region US https://private.test/?t=PRIVATE_FIXTURE'}), {status:403});
    };
    await assert.rejects(getFreshEmbed(), e => e.code === 'api_http_error' && e.details.reason === 'Region US [URL скрыт]' && !JSON.stringify(e.details).includes('PRIVATE_FIXTURE'));
    globalThis.fetch = async () => { throw new TypeError('URL PRIVATE_FIXTURE'); };
    await assert.rejects(getFreshEmbed(), e => e.code === 'api_network_or_cors' && !e.message.includes('PRIVATE_FIXTURE'));
  } finally { globalThis.fetch = original; }
});
test('bounded journal has explicit dropped count; no completion score is generated', () => {
  const run = makeRun('safari', {version:'unit'});
  for (let i=0; i<MAX_EVENTS+9; i++) append(run, {utc:new Date().toISOString(), kind:'synthetic_unit', i});
  assert.equal(run.events.length, MAX_EVENTS); assert.equal(run.droppedEvents, 9);
  assert.ok(!Object.hasOwn(run, 'coverage') && !Object.hasOwn(run, 'watched'));
  assert.throws(() => readJournal({getItem:()=>'{corrupt'}));
});
test('manual errors and old backups redact signed URLs and credential fields', () => {
  const result = redactLegacy({records:[{url:'//private.test/?t=PRIVATE_FIXTURE',token:'PRIVATE_FIXTURE', note:'https://private.test/path?s=PRIVATE_FIXTURE'}], runs:[{queue:[{status:'paused'}]}]});
  assert.ok(!JSON.stringify(result).includes('PRIVATE_FIXTURE'));
  assert.equal(result.runs[0].queue[0].status, 'paused');
  assert.ok(!safeDiagnostic('отказ //private.test/?t=PRIVATE_FIXTURE').includes('PRIVATE_FIXTURE'));
});
