import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateEmbedding } from '../../services/embedding.service.js';
import { AiDisabledError } from '../../ai/errors.js';
import { requestStorage } from '../../utils/request-context.js';
import { createFakeAiDb, installFakeGovernance } from '../helpers/fake-ai-db.js';

// Embeddings consult the AI kill switches (#413); use an in-memory database.
const db = createFakeAiDb({ organizations: [{ id: 'org-on' }, { id: 'org-off', aiDisabled: true }] });
let restoreGovernance;
before(async () => { restoreGovernance = await installFakeGovernance(db); });
after(() => restoreGovernance());

test('generateEmbedding honours the organization and platform kill switches before sending text', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not be called'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    requestStorage.run({ organizationId: 'org-off' }, () => generateEmbedding('private text')),
    (err) => err instanceof AiDisabledError && err.scope === 'organization',
  );
  db.platformSetting.rows.push({ id: 'platform', aiDisabled: true });
  t.after(() => { db.platformSetting.rows.length = 0; });
  const fresh = await installFakeGovernance(db);
  t.after(fresh);
  await assert.rejects(
    requestStorage.run({ organizationId: 'org-on' }, () => generateEmbedding('private text')),
    (err) => err instanceof AiDisabledError && err.scope === 'platform',
  );
  assert.equal(calls, 0);
});

test('generateEmbedding uses Ollama current embed contract', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ embeddings: [[0.25, -0.5, 0.75]] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const embedding = await generateEmbedding('Agency knowledge');

  assert.match(request.url, /\/api\/embed$/);
  assert.deepEqual(JSON.parse(request.options.body), {
    model: 'nomic-embed-text',
    input: 'Agency knowledge',
  });
  assert.deepEqual(embedding, [0.25, -0.5, 0.75]);
});

test('generateEmbedding rejects a successful response without a vector', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ embeddings: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    generateEmbedding('Agency knowledge'),
    /Ollama embedding response did not include a vector/,
  );
});

test('generateEmbedding authenticates cloud Ollama requests when a key is configured', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OLLAMA_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = originalApiKey;
  });
  process.env.OLLAMA_API_KEY = 'test-ollama-key';

  let authorization;
  globalThis.fetch = async (_url, options) => {
    authorization = options.headers.Authorization;
    return new Response(JSON.stringify({ embeddings: [[0.5]] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await generateEmbedding('Agency knowledge');

  assert.equal(authorization, 'Bearer test-ollama-key');
});
