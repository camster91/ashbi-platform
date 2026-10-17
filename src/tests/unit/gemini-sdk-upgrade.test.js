import assert from 'node:assert/strict';
import test from 'node:test';
import GeminiProvider from '../../ai/providers/gemini.js';

test('Gemini uses the maintained SDK request shape and disables automatic extra calls', async () => {
  const provider = new GeminiProvider('synthetic-model');
  let actual;
  provider.client = { models: { generateContent: async input => { actual = input; return { text: 'Synthetic response' }; } } };
  const controller = new AbortController();
  assert.equal(await provider.chat({ system: 'Synthetic system', prompt: 'Synthetic prompt', temperature: 0.2, maxTokens: 8, signal: controller.signal }), 'Synthetic response');
  assert.equal(actual.model, 'synthetic-model');
  assert.equal(actual.contents, 'Synthetic prompt');
  assert.equal(actual.config.systemInstruction, 'Synthetic system');
  assert.equal(actual.config.abortSignal, controller.signal);
  assert.equal(actual.config.maxOutputTokens, 8);
  assert.equal(actual.config.automaticContinuation, false);
  assert.deepEqual(actual.config.automaticFunctionCalling, { disable: true });
});
test('pre-aborted Gemini request never reaches the SDK dispatch', async () => {
  const provider = new GeminiProvider();
  provider.client = { models: { generateContent: () => { throw new Error('Must not dispatch'); } } };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider.chat({ prompt: 'Synthetic', signal: controller.signal }), { name: 'AbortError' });
});

test('actual GenAI SDK does not retry a synthetic provider error', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: 503, message: 'Synthetic unavailable', status: 'UNAVAILABLE' } }), { status: 503, headers: { 'content-type': 'application/json' } });
  });
  const provider = new GeminiProvider('synthetic-model');
  await assert.rejects(provider.chat({ prompt: 'Synthetic' }), /Synthetic unavailable/);
  assert.equal(calls, 1);
});

test('a blocked or missing-text Gemini response remains a failure for governance', async () => {
  const provider = new GeminiProvider();
  provider.client = { models: { generateContent: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) } };
  await assert.rejects(provider.chat({ prompt: 'Synthetic' }), /no text response/);
});
