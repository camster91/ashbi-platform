import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createShutdown, installProcessHandlers } from '../../utils/process-lifecycle.js';

const quietLogger = { info() {}, error() {}, fatal() {} };
const lifecycleUrl = pathToFileURL(fileURLToPath(new URL('../../utils/process-lifecycle.js', import.meta.url))).href;

test('shutdown runs every step once, flushes telemetry, and exits with the requested code', async () => {
  const calls = [];
  const exits = [];
  const shutdown = createShutdown({
    logger: quietLogger,
    steps: [
      ['http', () => calls.push('http')],
      ['queues', async () => { calls.push('queues'); }],
      ['database', () => calls.push('database')],
    ],
    flush: () => calls.push('flush'),
    exit: (code) => exits.push(code),
  });
  const first = shutdown('SIGTERM', 0);
  const second = shutdown('SIGINT', 0);
  assert.equal(first, second, 'shutdown is idempotent');
  await first;
  assert.deepEqual(calls, ['http', 'queues', 'database', 'flush']);
  assert.deepEqual(exits, [0]);
});

test('a failing step does not stop the rest and forces a non-zero exit', async () => {
  const calls = [];
  const exits = [];
  const shutdown = createShutdown({
    logger: quietLogger,
    steps: [
      ['http', () => { throw new Error('close failed'); }],
      ['queues', () => calls.push('queues')],
    ],
    exit: (code) => exits.push(code),
  });
  await shutdown('SIGTERM', 0);
  assert.deepEqual(calls, ['queues']);
  assert.deepEqual(exits, [1]);
});

test('a wedged step is abandoned at the drain deadline with a non-zero exit', async () => {
  const exits = [];
  let fire;
  const shutdown = createShutdown({
    logger: quietLogger,
    steps: [['queues', () => new Promise(() => {})]],
    exit: (code) => exits.push(code),
    setTimer: (callback) => { fire = callback; return { unref() {} }; },
  });
  void shutdown('SIGTERM', 0);
  assert.deepEqual(exits, []);
  fire();
  assert.deepEqual(exits, [1]);
});

test('fatal process errors are logged, reported, and trigger a non-zero shutdown', () => {
  const proc = new EventEmitter();
  const shutdowns = [];
  const captured = [];
  installProcessHandlers({
    proc,
    logger: quietLogger,
    shutdown: (reason, code) => shutdowns.push([reason, code]),
    captureException: (error) => captured.push(error),
  });
  const boom = new Error('boom');
  proc.emit('uncaughtException', boom);
  proc.emit('unhandledRejection', 'nope');
  proc.emit('SIGTERM');
  assert.deepEqual(shutdowns, [['uncaughtException', 1], ['unhandledRejection', 1], ['SIGTERM', 0]]);
  assert.deepEqual(captured, [boom, 'nope']);
});

test('a crashed process with an open handle and a hung close still exits non-zero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-'));
  const script = path.join(dir, 'crash.mjs');
  fs.writeFileSync(script, `
    import { createShutdown, installProcessHandlers } from ${JSON.stringify(lifecycleUrl)};
    const logger = { info() {}, error() {}, fatal() {} };
    setInterval(() => {}, 1000); // open handle, like an idle Redis socket
    const shutdown = createShutdown({ logger, timeoutMs: 300, steps: [['queues', () => new Promise(() => {})]] });
    installProcessHandlers({ shutdown, logger });
    setTimeout(() => { throw new Error('crash'); }, 10);
  `);
  const started = Date.now();
  const result = spawnSync(process.execPath, [script], { timeout: 10_000 });
  assert.equal(result.status, 1, result.stderr.toString());
  assert.ok(Date.now() - started < 5_000, 'exit was forced by the drain deadline');
});

test('the API entry point closes queue infrastructure and flushes Sentry on shutdown', () => {
  const server = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  assert.match(server, /closeQueueInfrastructure\(\)/);
  assert.match(server, /Sentry\.flush\(/);
  assert.match(server, /installProcessHandlers\(/);
  assert.doesNotMatch(server, /process\.exitCode\s*=/);
});
