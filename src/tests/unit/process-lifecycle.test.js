import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createShutdown, installProcessHandlers, processCounters } from '../../utils/process-lifecycle.js';

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

test('uncaught exceptions shut down non-zero; unhandled rejections are counted, not fatal (yet)', () => {
  const proc = new EventEmitter();
  const shutdowns = [];
  const captured = [];
  installProcessHandlers({
    proc,
    logger: quietLogger,
    shutdown: (reason, code) => shutdowns.push([reason, code]),
    captureException: (error) => captured.push(error),
  });
  const before = processCounters().unhandledRejections;
  const boom = new Error('boom');
  proc.emit('unhandledRejection', 'nope');
  assert.deepEqual(shutdowns, [], 'a stray rejection does not take the API down');
  assert.equal(processCounters().unhandledRejections, before + 1);
  proc.emit('uncaughtException', boom);
  proc.emit('SIGTERM');
  proc.emit('SIGTERM');
  assert.deepEqual(shutdowns, [['uncaughtException', 1], ['SIGTERM', 0], ['SIGTERM', 0]]);
  assert.deepEqual(captured, ['nope', boom]);

  const fatalProc = new EventEmitter();
  const fatal = [];
  installProcessHandlers({ proc: fatalProc, logger: quietLogger, shutdown: (reason, code) => fatal.push([reason, code]), fatalUnhandledRejection: true });
  fatalProc.emit('unhandledRejection', new Error('x'));
  assert.deepEqual(fatal, [['unhandledRejection', 1]]);
});

test('a fatal error during a graceful drain still exits non-zero, once', async () => {
  const exits = [];
  let release;
  const shutdown = createShutdown({
    logger: quietLogger,
    steps: [['workers', () => new Promise((resolve) => { release = resolve; })]],
    exit: (code) => exits.push(code),
  });
  const first = shutdown('SIGTERM', 0);
  assert.equal(shutdown('uncaughtException', 1), first);
  release();
  await first;
  assert.deepEqual(exits, [1]);
});

test('a second SIGTERM joins the drain instead of killing the process mid-drain', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-'));
  const script = path.join(dir, 'drain.mjs');
  const marker = path.join(dir, 'drained');
  fs.writeFileSync(script, `
    import fs from 'node:fs';
    import { createShutdown, installProcessHandlers } from ${JSON.stringify(lifecycleUrl)};
    const logger = { info() {}, error() {}, fatal() {} };
    setInterval(() => {}, 1000);
    const shutdown = createShutdown({ logger, timeoutMs: 5000, steps: [['drain', async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      fs.writeFileSync(${JSON.stringify(marker)}, 'ok');
    }]] });
    installProcessHandlers({ shutdown, logger });
    process.send?.('ready');
    setTimeout(() => { process.kill(process.pid, 'SIGTERM'); setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50); }, 20);
  `);
  const result = spawnSync(process.execPath, [script], { timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ok', 'drain completed before exit');
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
  const worker = fs.readFileSync(new URL('../../jobs/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /createShutdown\(/);
  assert.match(worker, /installProcessHandlers\(/);
  assert.doesNotMatch(worker, /process\.on\('SIG/);
});

test('the approval HITL chain returns its inner promise so its .catch covers it', () => {
  const bot = fs.readFileSync(new URL('../../routes/bot.routes.js', import.meta.url), 'utf8');
  const start = bot.indexOf("import('../utils/hitl-email.service.js').then(async ({ sendApprovalHITLEmail, resolveHitlApprover })");
  assert.ok(start >= 0, 'approval HITL chain found');
  const chain = bot.slice(start, start + 900);
  // An async callback: every await inside rejects the chained promise.
  assert.match(chain, /=> \{[\s\S]*?await fastify\.prisma\.notification\.create\(/);
  assert.match(chain, /await sendApprovalHITLEmail\(/);
  assert.match(chain, /\}\)\.catch\(err =>/);
});
