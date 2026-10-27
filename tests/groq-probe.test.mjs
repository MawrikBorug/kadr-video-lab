import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('Groq probe safety suite uses only a fake transport', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'groq_probe_test.py'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
    env: {PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1'},
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
