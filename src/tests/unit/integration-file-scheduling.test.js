import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { testArguments } from '../../../scripts/run-node-tests.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
test('only integration paths select one-file scheduling; every target and stdout guard remains', () => {
  const integration = path.join(root, 'src/tests/integration/example.database.test.js');
  const unit = path.join(root, 'src/tests/unit/example.test.js');
  const lookalike = path.join(root, 'src/tests/integration-other/example.test.js');
  const serial = testArguments([unit, integration], root);
  assert.equal(serial.filter(value => value === '--test-concurrency=1').length, 1);
  assert.deepEqual(serial.slice(-2), [path.relative(root, unit), path.relative(root, integration)]);
  assert.deepEqual(serial.slice(0, 3), ['--import', new URL('../../../scripts/test-stdout-guard.mjs', import.meta.url).href, '--test']);
  assert.ok(!testArguments([unit], root).includes('--test-concurrency=1'));
  assert.ok(!testArguments([lookalike], root).includes('--test-concurrency=1'));
  assert.ok(testArguments([integration], path.dirname(root)).includes('--test-concurrency=1'), 'safe scheduling does not depend on caller cwd');
});

test('actual runner preserves discovery, internal Promise.all races, and nonzero failures', t => {
  // Node resolves entry modules through symlinks; keep fixture argv paths and
  // import.meta.url consistent on macOS, where the temp directory uses /var.
  const fixture = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashbi-integration-scheduling-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture, 'scripts'));
  fs.mkdirSync(path.join(fixture, 'src/tests/integration'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
  for (const file of ['run-node-tests.mjs', 'test-stdout-guard.mjs']) fs.copyFileSync(path.join(root, 'scripts', file), path.join(fixture, 'scripts', file));
  const proof = path.join(fixture, 'execution.jsonl');
  const file = (name, extension = 'js') => path.join(fixture, 'src/tests/integration', `${name}.test.${extension}`);
  const source = name => `import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('${name}',async()=>{
 const proof=${JSON.stringify(proof)}; fs.appendFileSync(proof,JSON.stringify({file:'${name}',event:'start'})+'\\n');
 let arrivals=0,release;const gate=new Promise(resolve=>release=resolve);
 await Promise.all([0,1].map(async()=>{if(++arrivals===2)release();await gate;}));assert.equal(arrivals,2);
 fs.appendFileSync(proof,JSON.stringify({file:'${name}',event:'end'})+'\\n');});`;
  fs.writeFileSync(file('one'), source('one'));
  fs.writeFileSync(file('two', 'mjs'), source('two'));
  fs.writeFileSync(path.join(fixture, 'src/tests/integration/ignored.spec.js'), "throw Error('unsupported spec extension executed')");
  fs.writeFileSync(path.join(fixture, 'src/tests/integration/ignored.test.cjs'), "throw Error('unsupported cjs extension executed')");
  // The fixture is a standalone CLI, not a child using Node's serialized test
  // reporter protocol inherited from this outer unit test process.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = targets => spawnSync(process.execPath, [path.join(fixture, 'scripts/run-node-tests.mjs'), ...targets], { cwd: fixture, env, encoding: 'utf8', timeout: 15_000 });
  const success = run(['src/tests/integration']);
  assert.equal(success.status, 0, success.stderr + success.stdout);
  assert.deepEqual(fs.readFileSync(proof, 'utf8').trim().split('\n').map(JSON.parse), [
    { file: 'one', event: 'start' }, { file: 'one', event: 'end' }, { file: 'two', event: 'start' }, { file: 'two', event: 'end' },
  ]);
  for (const extension of ['js', 'mjs']) {
    fs.writeFileSync(file('failure', extension), "import test from 'node:test';test('must fail',()=>{throw Error('synthetic failure marker')});");
    const failure = run([file('failure', extension)]);
    assert.notEqual(failure.status, 0);
    assert.match(failure.stdout + failure.stderr, /synthetic failure marker/);
  }
  const missing = run(['src/tests/not-present']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Test path does not exist/);
});
