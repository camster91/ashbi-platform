import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import ClaudeProvider from '../../ai/providers/claude.js';

test('durable Claude request disables SDK retries after ambiguous upstream response', async () => {
  let attempts = 0;
  const provider = new ClaudeProvider();
  provider.client = new Anthropic({ apiKey: 'synthetic-unit-test', fetch: async () => {
    attempts++;
    return new Response(JSON.stringify({ error: { type: 'api_error', message: 'Synthetic upstream failure' } }),
      { status: 503, headers: { 'content-type': 'application/json' } });
  } });
  await assert.rejects(provider.chat({ system: 'test', prompt: 'test', singleAttempt: true }));
  assert.equal(attempts, 1);
});

test('single-attempt request uses bounded timeout without changing other callers defaults', async () => {
  const provider = new ClaudeProvider();
  const calls = [];
  provider.client = { messages: { create: async (body, options) => {
    calls.push({ body, options }); return { content: [{ text: 'Synthetic answer' }] };
  } } };
  assert.equal(await provider.chat({ system: 'test', prompt: 'test', singleAttempt: true }), 'Synthetic answer');
  assert.deepEqual(calls[0].options, { maxRetries: 0, timeout: 90_000 });
  await provider.chat({ system: 'test', prompt: 'test' });
  assert.equal(calls[1].options, undefined);
});
