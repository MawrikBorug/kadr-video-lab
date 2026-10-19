import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('physical protocol contains the whole representative sample with no fabricated results',async()=>{
  const data=JSON.parse(await readFile(new URL('../protocol/blank-results.json',import.meta.url),'utf8'));
  assert.equal(data.cases.length,220); assert.equal(new Set(data.cases.map(c=>c.caseId)).size,220);
  assert.ok(data.cases.every(c=>c.status==='NOT_RUN'&&c.actualEnvironment===null&&Object.values(c.measurements).every(v=>v===null)));
  assert.equal(new Set(data.cases.filter(c=>c.stage==='E1').map(c=>c.sample.key)).size,12);
  const samples=JSON.parse(await readFile(new URL('../web/data/samples.json',import.meta.url),'utf8'));
  assert.equal(samples.length,14);for(const [category,count] of [['ru-film',5],['foreign-film',3],['series',3],['anime',3]])assert.equal(samples.filter(s=>s.category===category).length,count);
});
