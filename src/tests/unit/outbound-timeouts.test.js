import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { OUTBOUND_TIMEOUT_MS, ollamaChatTimeoutMs, outboundSignal } from '../../utils/outbound-timeouts.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Outbound calls that do not (yet) pass a signal, with the reason. Prefer
 * `signal: outboundSignal(kind)`.
 */
const ALLOWED_UNBOUNDED_FETCHES = {
  'ai/providers/openai-compatible.js': 'defines fetchImpl; every call passes its own AbortController signal',
  'routes/ash-chat.routes.js': 'follow-up: Ash chat provider calls (owned by the chat work in flight)',
};

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/** Each `fetch(` / `fetchImpl(` call's argument text (balanced parentheses). */
function fetchCalls(source) {
  const calls = [];
  const pattern = /(?<![\w.])(?:globalThis\.)?(?:fetch|fetchImpl)\(/g;
  for (const match of source.matchAll(pattern)) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    if (source.slice(lineStart, match.index).trim().startsWith('//')) continue;
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') { depth -= 1; if (depth === 0) break; }
    }
    calls.push({ line: source.slice(0, match.index).split('\n').length, args: source.slice(match.index, end + 1) });
  }
  return calls;
}

test('every outbound fetch in src carries a timeout signal', () => {
  const unbounded = [];
  for (const file of sourceFiles(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join('/');
    if (Object.hasOwn(ALLOWED_UNBOUNDED_FETCHES, relative)) continue;
    for (const call of fetchCalls(fs.readFileSync(file, 'utf8'))) {
      if (!/\bsignal\b/.test(call.args)) unbounded.push(`${relative}:${call.line}`);
    }
  }
  assert.deepEqual(unbounded, [], 'add `signal: outboundSignal(kind)` to these fetch calls');
});

test('timeout budgets are bounded and signals abort', async () => {
  for (const [kind, ms] of Object.entries(OUTBOUND_TIMEOUT_MS)) {
    assert.ok(ms > 0 && ms <= 120_000, kind);
    assert.ok(outboundSignal(kind) instanceof AbortSignal);
  }
  assert.throws(() => outboundSignal('nope'), /Unknown outbound timeout/);
  assert.equal(ollamaChatTimeoutMs(undefined), OUTBOUND_TIMEOUT_MS.aiChat);
  assert.equal(ollamaChatTimeoutMs('300000'), 300_000);
  assert.equal(ollamaChatTimeoutMs('5'), 10_000);
  assert.equal(ollamaChatTimeoutMs('99999999'), 600_000);
  assert.ok(OUTBOUND_TIMEOUT_MS.upload >= 60_000, 'PDF uploads get a longer budget');
});

test('a hung provider is aborted instead of hanging the caller', async () => {
  const { default: OllamaProvider } = await import('../../ai/providers/ollama.js');
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  let seenSignal;
  globalThis.fetch = (_url, init) => {
    seenSignal = init.signal;
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
  };
  AbortSignal.timeout = () => originalTimeout.call(AbortSignal, 20);
  // AbortSignal.timeout timers are unref'd; keep the test's event loop alive.
  const keepAlive = setTimeout(() => {}, 5_000);
  try {
    const provider = new OllamaProvider();
    const started = Date.now();
    await assert.rejects(provider.chat({ prompt: 'hi' }), (error) => error.name === 'TimeoutError');
    assert.ok(seenSignal instanceof AbortSignal);
    assert.ok(Date.now() - started < 2_000);
  } finally {
    clearTimeout(keepAlive);
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});
