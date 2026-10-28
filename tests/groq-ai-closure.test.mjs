import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('AI closure controls use fake inference only',()=>{
 execFileSync('python3',['-m','unittest','discover','-s','tests','-p','groq_ai_closure_test.py'],{stdio:'pipe'});
 execFileSync('python3',['-m','unittest','discover','-s','tests','-p','groq_source_acquisition_test.py'],{stdio:'pipe'});
});
