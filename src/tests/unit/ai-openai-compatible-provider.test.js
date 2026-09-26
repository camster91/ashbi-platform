// OpenAI-compatible BYOK provider adapter (#413, docs/ai-byok.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from 'node:util';

import OpenAICompatibleProvider, { classifyProviderStatus, normalizeBaseUrl } from '../../ai/providers/openai-compatible.js';
import { AiProviderError } from '../../ai/errors.js';

const KEY = 'sk-test-secret-key-0123456789';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

function provider(fetchImpl, extra = {}) {
  return new OpenAICompatibleProvider({ baseUrl: 'https://llm.example.com/v1/', apiKey: KEY, model: 'model-a', fetchImpl, ...extra });
}

test('normalizes the base URL so /v1 is not doubled', () => {
  assert.equal(normalizeBaseUrl('https://llm.example.com/v1/'), 'https://llm.example.com');
  assert.equal(normalizeBaseUrl('https://llm.example.com/proxy/'), 'https://llm.example.com/proxy');
});

test('chat posts one chat completion and returns the content string, like the platform providers', async () => {
  const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, {
    model: 'model-a',
    choices: [{ message: { role: 'assistant', content: 'Hello there' } }],
    usage: { prompt_tokens: 12, completion_tokens: 3 },
  }));
  const result = await provider(fetchImpl).chat({ system: 'Be brief', prompt: 'Hi', temperature: 0.1, maxTokens: 50 });

  assert.equal(result, 'Hello there');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(calls[0].init.signal, 'every request carries an abort signal');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.messages, [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hi' }]);
  assert.equal(body.model, 'model-a');
  assert.equal(body.max_tokens, 50);
  assert.equal(body.temperature, 0.1);
});

test('complete returns token usage for metering', async () => {
  const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
    model: 'model-a-2026',
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  }));
  const result = await provider(fetchImpl).complete({ prompt: 'x', messages: [{ role: 'assistant', content: 'earlier' }] });
  assert.deepEqual(result.usage, { promptTokens: 100, completionTokens: 20, estimated: false });
  assert.equal(result.model, 'model-a-2026');
});

test('chatJSON parses fenced JSON and asks for JSON only', async () => {
  const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }));
  assert.deepEqual(await provider(fetchImpl).chatJSON({ system: 'S', prompt: 'P' }), { a: 1 });
  assert.match(JSON.parse(calls[0].init.body).messages[0].content, /valid JSON only/);
});

test('a slow provider times out with a typed error and is not retried', async () => {
  const { calls, fetchImpl } = fakeFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
  }));
  await assert.rejects(provider(fetchImpl, { timeoutMs: 20 }).chat({ prompt: 'x' }), (err) => {
    assert.ok(err instanceof AiProviderError);
    assert.equal(err.type, 'timeout');
    assert.equal(err.code, 'AI_PROVIDER_TIMEOUT');
    return true;
  });
  assert.equal(calls.length, 1, 'no automatic retry');
});

for (const [status, body, type] of [
  [401, { error: { message: `Incorrect API key provided: ${KEY}` } }, 'auth'],
  [403, {}, 'auth'],
  [402, {}, 'quota'],
  [429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }, 'quota'],
  [429, { error: { code: 'rate_limit_exceeded' } }, 'rate_limit'],
  [404, { error: { message: 'model not found' } }, 'invalid_request'],
  [500, {}, 'upstream'],
  [503, null, 'upstream'],
]) {
  test(`HTTP ${status} maps to ${type} without leaking the key or provider text`, async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(status, body));
    await assert.rejects(provider(fetchImpl).chat({ prompt: 'x' }), (err) => {
      assert.ok(err instanceof AiProviderError);
      assert.equal(err.type, type);
      assert.equal(err.upstreamStatus, status);
      assert.doesNotMatch(`${err.message} ${err.stack} ${JSON.stringify(err)}`, /sk-test-secret|Incorrect API key/);
      return true;
    });
    assert.equal(calls.length, 1, 'no automatic retry');
  });
}

test('usage is estimated (about 4 characters per token) when the provider omits it', async () => {
  const { fetchImpl } = fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: 'x'.repeat(9) } }] }));
  const result = await provider(fetchImpl).complete({ system: 's'.repeat(7), prompt: 'p'.repeat(8) });
  // "sssssss\npppppppp" = 16 chars -> 4 tokens; 9 chars -> 3 tokens.
  assert.deepEqual(result.usage, { promptTokens: 4, completionTokens: 3, estimated: true });
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`a ${status} redirect is never followed and fails as upstream`, async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      ok: false, status, headers: new Map([['location', 'http://169.254.169.254/latest/meta-data/']]), json: async () => ({}),
    }));
    await assert.rejects(provider(fetchImpl).chat({ prompt: 'x' }), (err) => err instanceof AiProviderError && err.type === 'upstream' && err.upstreamStatus === status);
    assert.equal(calls.length, 1, 'the Location is not requested');
    assert.equal(calls[0].init.redirect, 'manual', 'fetch is told not to follow redirects');
  });
}

test('an opaque redirect (browser-style manual mode) fails as upstream', async () => {
  const { fetchImpl } = fakeFetch(() => ({ ok: false, status: 0, type: 'opaqueredirect', json: async () => ({}) }));
  await assert.rejects(provider(fetchImpl).chat({ prompt: 'x' }), (err) => err instanceof AiProviderError && err.type === 'upstream');
});

test('a network failure maps to upstream', async () => {
  const { fetchImpl } = fakeFetch(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(provider(fetchImpl).chat({ prompt: 'x' }), (err) => err instanceof AiProviderError && err.type === 'upstream');
});

test('a response without content is invalid_response', async () => {
  const { fetchImpl } = fakeFetch(() => jsonResponse(200, { choices: [] }));
  await assert.rejects(provider(fetchImpl).chat({ prompt: 'x' }), (err) => err instanceof AiProviderError && err.type === 'invalid_response');
});

test('listModels reads /v1/models', async () => {
  const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, { data: [{ id: 'model-a' }, { id: 'model-b' }, {}] }));
  assert.deepEqual(await provider(fetchImpl).listModels(), ['model-a', 'model-b']);
  assert.equal(calls[0].url, 'https://llm.example.com/v1/models');
  assert.equal(calls[0].init.method, 'GET');
});

test('the key is not enumerable, serialized or inspected', () => {
  const p = provider(async () => jsonResponse(200, {}));
  assert.doesNotMatch(JSON.stringify(p), /sk-test-secret/);
  assert.doesNotMatch(inspect(p, { depth: 5 }), /sk-test-secret/);
  assert.equal(Object.keys(p).includes('apiKey'), false);
});

test('status classification', () => {
  assert.equal(classifyProviderStatus(408), 'timeout');
  assert.equal(classifyProviderStatus(504), 'timeout');
  assert.equal(classifyProviderStatus(422), 'invalid_request');
});
