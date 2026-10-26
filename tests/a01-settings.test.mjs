import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSetting,safeValue} from '../diagnostics/a01/lift-settings-probe.mjs';
test('A01 settings export parser only retains bounded discovered settings fields',()=>{
 assert.deepEqual(parseSetting({event:'setting',key:'speed',value:1.5,url:'https://example.test/?secret=x'}),{event:'setting',key:'speed',value:1.5});
 assert.deepEqual(parseSetting({event:'setting ls',key:'quality',ls:[480,720]}),{event:'setting ls',key:'quality',ls:[480,720]});
 for(const d of [{event:'setting',key:'pause',value:1},{event:'ended',key:'speed',value:1},{event:'setting',key:'sound',value:'https://example.test/?key=secret'},{event:'setting ls',key:'speed',ls:Array(101).fill(1)}])assert.equal(parseSetting(d),null);
 assert.equal(safeValue(Infinity),false);
});
