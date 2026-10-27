import test from 'node:test';
import { execFileSync } from 'node:child_process';
test('Groq functional evaluation controls, fake transport only', () => {
  execFileSync('python3', ['-m','unittest','discover','-s','tests','-p','groq_functional_eval_test.py'], {stdio:'pipe'});
});
