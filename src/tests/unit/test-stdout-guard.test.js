// scripts/run-node-tests.mjs preloads scripts/test-stdout-guard.mjs so test
// children never write plain text onto the stdout pipe that carries the
// runner's serialized report frames (the cause of intermittent
// "Unable to deserialize cloned data" failures in the heavy suites).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const guardUrl = pathToFileURL(path.join(root, 'scripts', 'test-stdout-guard.mjs')).href;

function runWithGuard(testContext) {
  const env = { ...process.env };
  if (testContext) env.NODE_TEST_CONTEXT = testContext;
  else delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--import', guardUrl, '-e', 'console.log("progress line"); console.info("info line")'], { env, encoding: 'utf8' });
}

describe('test stdout guard', () => {
  it('routes console output from test-runner children to stderr', () => {
    const result = runWithGuard('child-v8');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /progress line\ninfo line/);
  });

  it('leaves console output alone outside the test runner', () => {
    const result = runWithGuard(null);
    assert.equal(result.stdout, 'progress line\ninfo line\n');
  });

  it('is preloaded by the backend test command', () => {
    const runner = fs.readFileSync(path.join(root, 'scripts', 'run-node-tests.mjs'), 'utf8');
    assert.match(runner, /'--import', stdoutGuard, '--test'/);
  });
});
