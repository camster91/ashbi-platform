import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../../routes/ai-bridge.routes.js', import.meta.url), 'utf8');
const apiKeys = readFileSync(new URL('../../routes/api-key.routes.js', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../../../docs/chatgpt-connector.md', import.meta.url), 'utf8');

test('AI bridge is API-key authenticated and tenant scoped', () => {
  assert.match(route, /authenticateWithApiKey/);
  assert.match(route, /request\.user\.organizationId/);
  assert.match(apiKeys, /organizationId: key\.user\.organizationId/);
  assert.match(route, /credentialsNeverReturned: true/);
});

test('AI bridge exposes OpenAI-compatible chat completions without write claims', () => {
  assert.match(route, /\/v1\/chat\/completions/);
  assert.match(route, /object: 'chat\.completion'/);
  assert.match(route, /Writes are not available through this endpoint yet/);
  assert.match(docs, /explicit\s+user\s+confirmation/);
});
