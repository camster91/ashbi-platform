import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleGenerativeAI } from '@google/generative-ai';
import GeminiProvider from '../../ai/providers/gemini.js';
import { createAiGovernance } from '../../ai/governance.js';
import { createFakeAiDb } from '../helpers/fake-ai-db.js';

function provider() {
  const instance = new GeminiProvider();
  // Actual installed SDK, synthetic key and a stubbed fetch: no provider I/O.
  instance.client = new GoogleGenerativeAI('synthetic-unit-test-key');
  instance.isConfigured = () => true;
  return instance;
}
test('actual Gemini SDK is never invoked with a pre-aborted caller signal', async t => {
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalls++; throw Error('Unexpected synthetic fetch'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider().chat({ prompt: 'Synthetic question', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fetchCalls, 0);
});
test('deadline during actual governance tenant routing prevents subsequent Gemini dispatch', async t => {
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalls++; throw Error('Unexpected synthetic fetch'); });
  const db = createFakeAiDb({ organizations: [{ id: 'org-a' }] });
  let entered;
  let release;
  const routing = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const readOrganization = db.organization.findUnique.bind(db.organization);
  db.organization.findUnique = async args => { entered(); await held; return readOrganization(args); };
  const instance = provider();
  const governance = createAiGovernance({ prisma: db, getContext: () => ({ organizationId: 'org-a', feature: 'client_agent_run' }),
    platformProvider: () => instance });
  const controller = new AbortController();
  const pending = governance.chat({ prompt: 'Synthetic question', singleAttempt: true, signal: controller.signal });
  await routing;
  controller.abort(); release();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(fetchCalls, 0);
});
test('actual SDK installs its future-abort listener before its first asynchronous request gap', async t => {
  const controller = new AbortController();
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    fetchCalls++;
    assert.equal(options.signal.aborted, true, 'SDK bridged the abort before fetch can send');
    throw new DOMException('Synthetic cancellation', 'AbortError');
  });
  const pending = provider().chat({ prompt: 'Synthetic question', signal: controller.signal });
  queueMicrotask(() => controller.abort());
  await assert.rejects(pending, /abort/i);
  assert.equal(fetchCalls, 1);
});
